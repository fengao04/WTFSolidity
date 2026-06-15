import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, ContractFactory } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { readFileSync } from 'fs';
import path from 'path';

const solc = require('solc');

interface CompiledContract {
    abi: any[];
    evm: {
        bytecode: {
            object: string;
        };
    };
}

interface CompilerOutput {
    contracts: Record<string, Record<string, CompiledContract>>;
    errors?: Array<{
        formattedMessage: string;
        severity: string;
    }>;
}

const gasHeavyReceiverSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasHeavyReceiver {
    uint256 public received;

    event Received(uint256 amount);

    receive() external payable {
        received += msg.value;
        emit Received(msg.value);
    }
}
`;

let compilerOutput: CompilerOutput | undefined;

function compileContracts(): CompilerOutput {
    if (compilerOutput) {
        return compilerOutput;
    }

    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': {
                content: readFileSync(path.join(__dirname, '..', '33_Airdrop', 'Airdrop.sol'), 'utf8'),
            },
            '33_Airdrop/IERC20.sol': {
                content: readFileSync(path.join(__dirname, '..', '33_Airdrop', 'IERC20.sol'), 'utf8'),
            },
            'GasHeavyReceiver.sol': {
                content: gasHeavyReceiverSource,
            },
        },
        settings: {
            evmVersion: 'paris',
            optimizer: {
                enabled: true,
                runs: 200,
            },
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input))) as CompilerOutput;
    const errors = output.errors?.filter((error) => error.severity === 'error') || [];
    if (errors.length > 0) {
        throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
    }

    compilerOutput = output;
    return output;
}

async function deployCompiledContract(
    signer: SignerWithAddress,
    sourceName: string,
    contractName: string,
    ...args: Array<any>
): Promise<Contract> {
    const contract = compileContracts().contracts[sourceName]?.[contractName];
    if (!contract) {
        throw new Error(`Missing compiled contract ${sourceName}:${contractName}`);
    }

    const factory = new ContractFactory(contract.abi, `0x${contract.evm.bytecode.object}`, signer);
    const deployed = await factory.deploy(...args);
    await deployed.deployed();
    return deployed;
}

describe('33 Airdrop Test', () => {
    const unit = ethers.constants.WeiPerEther;

    let operator: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let airdrop: Contract;
    let erc20: Contract;

    beforeEach('deploy contracts', async () => {
        [operator, alice, bob] = await ethers.getSigners();
        airdrop = await deployCompiledContract(operator, '33_Airdrop/Airdrop.sol', 'Airdrop');
        erc20 = await deployCompiledContract(operator, '33_Airdrop/Airdrop.sol', 'ERC20', 'MyToken', 'MTK');
    });

    it('transfers ERC20 tokens when allowance exactly equals the airdrop total', async () => {
        const aliceAmount = unit.mul(2);
        const bobAmount = unit.mul(3);
        const totalAmount = aliceAmount.add(bobAmount);

        await erc20.mint(totalAmount);
        await erc20.approve(airdrop.address, totalAmount);

        await airdrop.multiTransferToken(erc20.address, [alice.address, bob.address], [aliceAmount, bobAmount]);

        expect(await erc20.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await erc20.balanceOf(bob.address)).to.equal(bobAmount);
        expect(await erc20.allowance(operator.address, airdrop.address)).to.equal(0);
    });

    it('transfers ETH to contract recipients that need more than transfer gas stipend', async () => {
        const receiver = await deployCompiledContract(operator, 'GasHeavyReceiver.sol', 'GasHeavyReceiver');
        const receiverAmount = ethers.utils.parseEther('0.2');
        const bobAmount = ethers.utils.parseEther('0.3');

        await airdrop.multiTransferETH(
            [receiver.address, bob.address],
            [receiverAmount, bobAmount],
            { value: receiverAmount.add(bobAmount) }
        );

        expect(await receiver.received()).to.equal(receiverAmount);
        expect(await ethers.provider.getBalance(airdrop.address)).to.equal(0);
    });
});

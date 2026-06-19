import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, ContractFactory } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const solc = require('solc');

type CompiledContract = {
    abi: any[];
    evm: {
        bytecode: {
            object: string;
        };
    };
};

function compileContracts(): Record<string, CompiledContract> {
    const root = path.join(__dirname, '..');
    const sources = {
        '33_Airdrop/Airdrop.sol': {
            content: fs.readFileSync(path.join(root, '33_Airdrop', 'Airdrop.sol'), 'utf8'),
        },
        '33_Airdrop/IERC20.sol': {
            content: fs.readFileSync(path.join(root, '33_Airdrop', 'IERC20.sol'), 'utf8'),
        },
        'test/GasHungryReceiver.sol': {
            content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasHungryReceiver {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}
`,
        },
    };

    const input = {
        language: 'Solidity',
        sources,
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

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter((error: { severity: string }) => error.severity === 'error');
    expect(errors, JSON.stringify(output.errors || [], null, 2)).to.be.empty;

    return {
        Airdrop: output.contracts['33_Airdrop/Airdrop.sol'].Airdrop,
        ERC20: output.contracts['33_Airdrop/Airdrop.sol'].ERC20,
        GasHungryReceiver: output.contracts['test/GasHungryReceiver.sol'].GasHungryReceiver,
    };
}

describe('33 Airdrop Test', () => {
    const unit = ethers.constants.WeiPerEther;
    let operator: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let contracts: Record<string, CompiledContract>;

    before(async () => {
        [operator, alice, bob] = await ethers.getSigners();
        contracts = compileContracts();
    });

    async function deploy(name: string, ...args: any[]): Promise<Contract> {
        const compiled = contracts[name];
        const factory = new ContractFactory(compiled.abi, compiled.evm.bytecode.object, operator);
        const contract = await factory.deploy(...args);
        await contract.deployTransaction.wait(1);
        return contract;
    }

    it('transfers ERC20 tokens with exact allowance', async () => {
        const airdrop = await deploy('Airdrop');
        const token = await deploy('ERC20', 'MyToken', 'MTK');
        const amounts = [unit.mul(100), unit.mul(200)];
        const totalAmount = amounts[0].add(amounts[1]);

        await (await token.mint(totalAmount)).wait(1);
        await (await token.approve(airdrop.address, totalAmount)).wait(1);

        await (await airdrop.multiTransferToken(token.address, [alice.address, bob.address], amounts)).wait(1);

        expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
        expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
        expect(await token.allowance(operator.address, airdrop.address)).to.equal(0);
    });

    it('transfers ETH to contract recipients that need more than transfer gas', async () => {
        const airdrop = await deploy('Airdrop');
        const receiver = await deploy('GasHungryReceiver');
        const ethAmount = unit.div(10);

        await (
            await airdrop.multiTransferETH([receiver.address], [ethAmount], {
                value: ethAmount,
            })
        ).wait(1);

        expect(await receiver.received()).to.equal(ethAmount);
        expect(await ethers.provider.getBalance(receiver.address)).to.equal(ethAmount);
    });
});

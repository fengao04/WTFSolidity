import { expect } from 'chai';
import { Contract } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';
import fs from 'fs';
import path from 'path';

const solc = require('solc');

type CompiledContract = {
    abi: any[];
    evm: {
        bytecode: {
            object: string;
        };
    };
};

function getCompiledContract(sourceName: string, contractName: string): CompiledContract {
    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': {
                content: fs.readFileSync(path.join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8'),
            },
            '33_Airdrop/IERC20.sol': {
                content: fs.readFileSync(path.join(__dirname, '../33_Airdrop/IERC20.sol'), 'utf8'),
            },
            'test/GasHeavyReceiver.sol': {
                content: `
                    // SPDX-License-Identifier: MIT
                    pragma solidity ^0.8.4;

                    contract GasHeavyReceiver {
                        uint256 public received;

                        receive() external payable {
                            received += msg.value;
                        }
                    }
                `,
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
                    '*': ['abi', 'evm.bytecode.object'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter((error: any) => error.severity === 'error');
    expect(errors.map((error: any) => error.formattedMessage)).to.deep.equal([]);

    return output.contracts[sourceName][contractName];
}

async function deployCompiled(contract: CompiledContract, ...args: any[]): Promise<Contract> {
    const [deployer] = await ethers.getSigners();
    const factory = new ethers.ContractFactory(
        contract.abi,
        `0x${contract.evm.bytecode.object}`,
        deployer
    );
    const deployed = await factory.deploy(...args);
    await deployed.deployTransaction.wait(1);
    return deployed;
}

describe('33 Airdrop Test', () => {
    const unit = ethers.constants.WeiPerEther;
    let airdrop: Contract;
    let erc20: Contract;
    let gasHeavyReceiver: Contract;

    beforeEach(async () => {
        airdrop = await deployCompiled(getCompiledContract('33_Airdrop/Airdrop.sol', 'Airdrop'));
        erc20 = await deployCompiled(getCompiledContract('33_Airdrop/Airdrop.sol', 'ERC20'), 'MyToken', 'MTK');
        gasHeavyReceiver = await deployCompiled(getCompiledContract('test/GasHeavyReceiver.sol', 'GasHeavyReceiver'));
    });

    it('transfers tokens when allowance exactly matches the airdrop total', async () => {
        const [, alice, bob] = await ethers.getSigners();
        const aliceAmount = unit;
        const bobAmount = unit.mul(2);
        const totalAmount = aliceAmount.add(bobAmount);

        await erc20.mint(totalAmount);
        await erc20.approve(airdrop.address, totalAmount);
        await airdrop.multiTransferToken(
            erc20.address,
            [alice.address, bob.address],
            [aliceAmount, bobAmount]
        );

        expect(await erc20.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await erc20.balanceOf(bob.address)).to.equal(bobAmount);
    });

    it('transfers ETH to contract recipients that need more than transfer gas', async () => {
        const [, alice] = await ethers.getSigners();
        const contractAmount = unit;
        const aliceAmount = unit.div(2);

        await airdrop.multiTransferETH(
            [gasHeavyReceiver.address, alice.address],
            [contractAmount, aliceAmount],
            { value: contractAmount.add(aliceAmount) }
        );

        expect(await gasHeavyReceiver.received()).to.equal(contractAmount);
    });
});

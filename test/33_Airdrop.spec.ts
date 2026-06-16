import { expect } from 'chai';
import { ContractFactory } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const solc = require('solc');

function compileLesson33(contractName: string): { abi: any; bytecode: string } {
    const root = path.join(__dirname, '..');
    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': {
                content: fs.readFileSync(path.join(root, '33_Airdrop', 'Airdrop.sol'), 'utf8'),
            },
            '33_Airdrop/IERC20.sol': {
                content: fs.readFileSync(path.join(root, '33_Airdrop', 'IERC20.sol'), 'utf8'),
            },
            'GasHungryReceiver.sol': {
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
        },
        settings: {
            evmVersion: 'paris',
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode.object'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = output.errors?.filter((error: any) => error.severity === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).to.be.undefined;

    const sourceName = contractName === 'GasHungryReceiver' ? 'GasHungryReceiver.sol' : '33_Airdrop/Airdrop.sol';
    const contract = output.contracts[sourceName][contractName];
    return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
    };
}

describe('33 Airdrop Test', () => {
    it('airdrops ERC20 tokens with exact approval', async () => {
        const [operator, alice, bob] = await ethers.getSigners();
        const unit = ethers.constants.WeiPerEther;
        const erc20Artifact = compileLesson33('ERC20');
        const airdropArtifact = compileLesson33('Airdrop');
        const erc20 = await new ContractFactory(erc20Artifact.abi, erc20Artifact.bytecode, operator).deploy('MyToken', 'MTK');
        await erc20.deployed();
        const airdrop = await new ContractFactory(airdropArtifact.abi, airdropArtifact.bytecode, operator).deploy();
        await airdrop.deployed();

        const aliceAmount = unit.mul(3);
        const bobAmount = unit.mul(7);
        const amountSum = aliceAmount.add(bobAmount);

        await (await erc20.mint(amountSum)).wait();
        await (await erc20.approve(airdrop.address, amountSum)).wait();
        await (await airdrop.multiTransferToken(erc20.address, [alice.address, bob.address], [aliceAmount, bobAmount])).wait();

        expect(await erc20.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await erc20.balanceOf(bob.address)).to.equal(bobAmount);
        expect(await erc20.allowance(operator.address, airdrop.address)).to.equal(0);
    });

    it('airdrops ETH to contract recipients that require more than transfer gas', async () => {
        const [operator, alice] = await ethers.getSigners();
        const unit = ethers.constants.WeiPerEther;
        const airdropArtifact = compileLesson33('Airdrop');
        const receiverArtifact = compileLesson33('GasHungryReceiver');
        const airdrop = await new ContractFactory(airdropArtifact.abi, airdropArtifact.bytecode, operator).deploy();
        await airdrop.deployed();
        const receiver = await new ContractFactory(receiverArtifact.abi, receiverArtifact.bytecode, operator).deploy();
        await receiver.deployed();

        const receiverAmount = unit;
        const aliceAmount = unit.mul(2);

        await (await airdrop.multiTransferETH(
            [receiver.address, alice.address],
            [receiverAmount, aliceAmount],
            { value: receiverAmount.add(aliceAmount) }
        )).wait();

        expect(await receiver.received()).to.equal(receiverAmount);
        expect(await ethers.provider.getBalance(airdrop.address)).to.equal(0);
    });
});

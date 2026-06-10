import { ContractFactory } from 'ethers';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const solc = require('solc');

function compileLesson33Contract(contractName: string, sourceName = '33_Airdrop/Airdrop.sol') {
    const sources = {
        '33_Airdrop/Airdrop.sol': {
            content: fs.readFileSync(path.join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8'),
        },
        '33_Airdrop/IERC20.sol': {
            content: fs.readFileSync(path.join(__dirname, '../33_Airdrop/IERC20.sol'), 'utf8'),
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
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode.object'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = output.errors?.filter((error: { severity: string }) => error.severity === 'error') ?? [];
    expect(errors, JSON.stringify(errors, null, 2)).to.deep.equal([]);

    const contract = output.contracts[sourceName][contractName];
    return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
    };
}

describe('33 Airdrop Test', () => {
    it('allows ERC20 airdrops with an exact allowance', async () => {
        const [operator, alice, bob] = await ethers.getSigners();
        const erc20Artifact = compileLesson33Contract('ERC20');
        const airdropArtifact = compileLesson33Contract('Airdrop');
        const erc20Factory = new ContractFactory(erc20Artifact.abi, erc20Artifact.bytecode, operator);
        const airdropFactory = new ContractFactory(airdropArtifact.abi, airdropArtifact.bytecode, operator);
        const erc20 = await erc20Factory.deploy('MyToken', 'MTK');
        const airdrop = await airdropFactory.deploy();
        await erc20.deployed();
        await airdrop.deployed();

        const aliceAmount = ethers.utils.parseEther('1');
        const bobAmount = ethers.utils.parseEther('2');
        const exactAirdropSum = aliceAmount.add(bobAmount);

        await (await erc20.mint(exactAirdropSum)).wait();
        await (await erc20.approve(airdrop.address, exactAirdropSum)).wait();

        await (await airdrop.multiTransferToken(
            erc20.address,
            [alice.address, bob.address],
            [aliceAmount, bobAmount],
        )).wait();

        expect(await erc20.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await erc20.balanceOf(bob.address)).to.equal(bobAmount);
        expect(await erc20.allowance(operator.address, airdrop.address)).to.equal(0);
    });

    it('allows ETH airdrops to contract recipients that need more than 2300 gas', async () => {
        const [operator] = await ethers.getSigners();
        const airdropArtifact = compileLesson33Contract('Airdrop');
        const receiverArtifact = compileLesson33Contract('GasHungryReceiver', 'test/GasHungryReceiver.sol');
        const airdropFactory = new ContractFactory(airdropArtifact.abi, airdropArtifact.bytecode, operator);
        const receiverFactory = new ContractFactory(receiverArtifact.abi, receiverArtifact.bytecode, operator);
        const airdrop = await airdropFactory.deploy();
        const receiver = await receiverFactory.deploy();
        await airdrop.deployed();
        await receiver.deployed();

        const amount = ethers.utils.parseEther('1');

        await (await airdrop.multiTransferETH(
            [receiver.address],
            [amount],
            { value: amount },
        )).wait();

        expect(await receiver.received()).to.equal(amount);
        expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount);
    });
});

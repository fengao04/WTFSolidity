import { expect } from 'chai';
// @ts-ignore
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const solc = require('solc');

const receiverSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasHungryReceiver {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}
`;

function compileLesson33() {
    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': {
                content: fs.readFileSync(path.join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8'),
            },
            '33_Airdrop/IERC20.sol': {
                content: fs.readFileSync(path.join(__dirname, '../33_Airdrop/IERC20.sol'), 'utf8'),
            },
            'test/GasHungryReceiver.sol': {
                content: receiverSource,
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
    const errors = (output.errors || []).filter((error: any) => error.severity === 'error');
    if (errors.length > 0) {
        throw new Error(errors.map((error: any) => error.formattedMessage).join('\n'));
    }

    return output.contracts;
}

describe('33 Airdrop Test', () => {
    let contracts: any;
    let operator: any;
    let alice: any;
    let bob: any;

    before('compile and load signers', async () => {
        contracts = compileLesson33();
        [operator, alice, bob] = await ethers.getSigners();
    });

    async function deploy(sourceName: string, contractName: string, ...args: any[]) {
        const artifact = contracts[sourceName][contractName];
        const factory = new ethers.ContractFactory(
            artifact.abi,
            `0x${artifact.evm.bytecode.object}`,
            operator
        );
        const contract = await factory.deploy(...args);
        await contract.deployed();
        return contract;
    }

    it('allows an ERC20 airdrop with an exact allowance', async () => {
        const airdrop = await deploy('33_Airdrop/Airdrop.sol', 'Airdrop');
        const token = await deploy('33_Airdrop/Airdrop.sol', 'ERC20', 'MyToken', 'MTK');
        const aliceAmount = ethers.utils.parseEther('100');
        const bobAmount = ethers.utils.parseEther('200');
        const totalAmount = aliceAmount.add(bobAmount);

        await token.mint(totalAmount);
        await token.approve(airdrop.address, totalAmount);

        await airdrop.multiTransferToken(
            token.address,
            [alice.address, bob.address],
            [aliceAmount, bobAmount]
        );

        expect(await token.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await token.balanceOf(bob.address)).to.equal(bobAmount);
        expect(await token.allowance(operator.address, airdrop.address)).to.equal(0);
    });

    it('sends ETH to contract recipients that need more than the transfer stipend', async () => {
        const airdrop = await deploy('33_Airdrop/Airdrop.sol', 'Airdrop');
        const receiver = await deploy('test/GasHungryReceiver.sol', 'GasHungryReceiver');
        const receiverAmount = ethers.utils.parseEther('1');
        const bobAmount = ethers.utils.parseEther('2');
        const bobBalanceBefore = await ethers.provider.getBalance(bob.address);

        await airdrop.multiTransferETH(
            [receiver.address, bob.address],
            [receiverAmount, bobAmount],
            { value: receiverAmount.add(bobAmount) }
        );

        expect(await receiver.received()).to.equal(receiverAmount);
        expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBalanceBefore.add(bobAmount));
    });
});

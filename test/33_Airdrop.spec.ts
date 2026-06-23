import { expect } from 'chai';
import { BigNumber, Contract, ContractFactory } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-ignore
import { ethers } from 'hardhat';

const solc = require('solc');

type CompiledContract = {
    abi: any[];
    bytecode: string;
};

const gasHungryReceiverSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasHungryReceiver {
    uint256 public receivedCount;

    receive() external payable {
        receivedCount = receivedCount + 1;
    }
}
`;

function compileLesson33Contracts(): Record<string, CompiledContract> {
    const sources = {
        '33_Airdrop/Airdrop.sol': {
            content: readFileSync(join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8'),
        },
        '33_Airdrop/IERC20.sol': {
            content: readFileSync(join(__dirname, '../33_Airdrop/IERC20.sol'), 'utf8'),
        },
        'test/GasHungryReceiver.sol': {
            content: gasHungryReceiverSource,
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
                    '*': ['abi', 'evm.bytecode.object'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter((error: any) => error.severity === 'error');
    expect(errors.map((error: any) => error.formattedMessage).join('\n')).to.equal('');

    return {
        Airdrop: contractFromOutput(output, '33_Airdrop/Airdrop.sol', 'Airdrop'),
        ERC20: contractFromOutput(output, '33_Airdrop/Airdrop.sol', 'ERC20'),
        GasHungryReceiver: contractFromOutput(output, 'test/GasHungryReceiver.sol', 'GasHungryReceiver'),
    };
}

function contractFromOutput(output: any, sourceName: string, contractName: string): CompiledContract {
    const contract = output.contracts[sourceName][contractName];
    return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
    };
}

async function deploy(contract: CompiledContract, ...args: any[]): Promise<Contract> {
    const [deployer] = await ethers.getSigners();
    const factory = new ContractFactory(contract.abi, contract.bytecode, deployer);
    const deployed = await factory.deploy(...args);
    await deployed.deployed();
    return deployed;
}

describe('33 Airdrop Regression Test', () => {
    let compiled: Record<string, CompiledContract>;

    before('compile lesson 33 contracts', () => {
        compiled = compileLesson33Contracts();
    });

    it('allows ERC20 airdrops when allowance exactly equals the transfer total', async () => {
        const [, alice, bob] = await ethers.getSigners();
        const token = await deploy(compiled.ERC20, 'MyToken', 'MTK');
        const airdrop = await deploy(compiled.Airdrop);
        const amounts = [BigNumber.from(100), BigNumber.from(200)];
        const total = amounts.reduce((sum, amount) => sum.add(amount), BigNumber.from(0));

        await (await token.mint(total)).wait();
        await (await token.approve(airdrop.address, total)).wait();
        await (await airdrop.multiTransferToken(token.address, [alice.address, bob.address], amounts)).wait();

        expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
        expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
    });

    it('can airdrop ETH to contract recipients that need more than the transfer stipend', async () => {
        const [, bob] = await ethers.getSigners();
        const airdrop = await deploy(compiled.Airdrop);
        const receiver = await deploy(compiled.GasHungryReceiver);
        const receiverAmount = ethers.utils.parseEther('0.01');
        const bobAmount = ethers.utils.parseEther('0.02');
        const bobBalanceBefore = await ethers.provider.getBalance(bob.address);

        await (
            await airdrop.multiTransferETH([receiver.address, bob.address], [receiverAmount, bobAmount], {
                value: receiverAmount.add(bobAmount),
            })
        ).wait();

        expect(await receiver.receivedCount()).to.equal(1);
        expect(await ethers.provider.getBalance(receiver.address)).to.equal(receiverAmount);
        expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBalanceBefore.add(bobAmount));
    });
});

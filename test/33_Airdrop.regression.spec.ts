import { expect } from 'chai';
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

function compileLesson33(): Record<string, CompiledContract> {
    const airdropPath = path.join(__dirname, '..', '33_Airdrop', 'Airdrop.sol');
    const ierc20Path = path.join(__dirname, '..', '33_Airdrop', 'IERC20.sol');

    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': {
                content: fs.readFileSync(airdropPath, 'utf8'),
            },
            '33_Airdrop/IERC20.sol': {
                content: fs.readFileSync(ierc20Path, 'utf8'),
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
                    '*': ['abi', 'evm.bytecode'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter((error: { severity: string }) => error.severity === 'error');
    expect(errors, JSON.stringify(output.errors, null, 2)).to.be.empty;

    return {
        Airdrop: output.contracts['33_Airdrop/Airdrop.sol'].Airdrop,
        ERC20: output.contracts['33_Airdrop/Airdrop.sol'].ERC20,
        GasHungryReceiver: output.contracts['GasHungryReceiver.sol'].GasHungryReceiver,
    };
}

describe('33 Airdrop regressions', () => {
    const compiled = compileLesson33();

    async function deploy(contract: CompiledContract, ...args: any[]) {
        const [deployer] = await ethers.getSigners();
        const factory = new ethers.ContractFactory(contract.abi, contract.evm.bytecode.object, deployer);
        const deployed = await factory.deploy(...args);
        await deployed.deployed();
        return deployed;
    }

    it('allows ERC20 airdrops when allowance exactly equals the total amount', async () => {
        const [, alice, bob] = await ethers.getSigners();
        const airdrop = await deploy(compiled.Airdrop);
        const token = await deploy(compiled.ERC20, 'MyToken', 'MTK');
        const aliceAmount = ethers.utils.parseEther('1');
        const bobAmount = ethers.utils.parseEther('2');
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
        expect(await token.allowance((await ethers.getSigners())[0].address, airdrop.address)).to.equal(0);
    });

    it('sends ETH to contract recipients whose receive logic needs more than transfer gas', async () => {
        const [, bob] = await ethers.getSigners();
        const airdrop = await deploy(compiled.Airdrop);
        const receiver = await deploy(compiled.GasHungryReceiver);
        const receiverAmount = ethers.utils.parseEther('0.01');
        const bobAmount = ethers.utils.parseEther('0.02');
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

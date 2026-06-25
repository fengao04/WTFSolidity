import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
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

function compileLesson33(): Record<string, CompiledContract> {
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
    const errors = (output.errors || []).filter((error: any) => error.severity === 'error');
    expect(errors.map((error: any) => error.formattedMessage).join('\n')).to.equal('');

    return {
        Airdrop: output.contracts['33_Airdrop/Airdrop.sol'].Airdrop,
        ERC20: output.contracts['33_Airdrop/Airdrop.sol'].ERC20,
        GasHungryReceiver: output.contracts['test/GasHungryReceiver.sol'].GasHungryReceiver,
    };
}

async function deployCompiled(compiled: CompiledContract, ...args: any[]): Promise<Contract> {
    const [deployer] = await ethers.getSigners();
    const factory = new ethers.ContractFactory(
        compiled.abi,
        `0x${compiled.evm.bytecode.object}`,
        deployer,
    );
    const contract = await factory.deploy(...args);
    await contract.deployTransaction.wait(1);
    return contract;
}

describe('33 Airdrop Test', () => {
    const compiled = compileLesson33();

    it('transfers ERC20 tokens when allowance exactly equals the total amount', async () => {
        const [, alice, bob] = await ethers.getSigners();
        const token = await deployCompiled(compiled.ERC20, 'MyToken', 'MTK');
        const airdrop = await deployCompiled(compiled.Airdrop);

        await token.mint(300);
        await token.approve(airdrop.address, 300);

        await airdrop.multiTransferToken(
            token.address,
            [alice.address, bob.address],
            [100, 200],
        );

        expect(await token.balanceOf(alice.address)).to.equal(100);
        expect(await token.balanceOf(bob.address)).to.equal(200);
    });

    it('transfers ETH to contract recipients that need more than the transfer gas stipend', async () => {
        const [, bob] = await ethers.getSigners();
        const airdrop = await deployCompiled(compiled.Airdrop);
        const receiver = await deployCompiled(compiled.GasHungryReceiver);
        const bobBalanceBefore = await ethers.provider.getBalance(bob.address);

        await airdrop.multiTransferETH(
            [receiver.address, bob.address],
            [1, 2],
            { value: 3 },
        );

        expect(await receiver.received()).to.equal(1);
        expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBalanceBefore.add(2));
    });
});

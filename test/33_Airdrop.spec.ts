import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, ContractFactory } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
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
    expect(errors.map((error: { formattedMessage: string }) => error.formattedMessage)).to.deep.equal([]);

    return {
        Airdrop: output.contracts['33_Airdrop/Airdrop.sol'].Airdrop,
        ERC20: output.contracts['33_Airdrop/Airdrop.sol'].ERC20,
        GasHungryReceiver: output.contracts['test/GasHungryReceiver.sol'].GasHungryReceiver,
    };
}

async function deployCompiled(
    signer: SignerWithAddress,
    compiled: CompiledContract,
    ...args: any[]
): Promise<Contract> {
    const factory = new ContractFactory(compiled.abi, `0x${compiled.evm.bytecode.object}`, signer);
    const contract = await factory.deploy(...args);
    await contract.deployed();
    return contract;
}

describe('33 Airdrop Test', () => {
    const compiled = compileLesson33();
    const unit = ethers.constants.WeiPerEther;
    let operator: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;

    before(async () => {
        [operator, alice, bob] = await ethers.getSigners();
    });

    it('allows ERC20 airdrops with an exact allowance', async () => {
        const airdrop = await deployCompiled(operator, compiled.Airdrop);
        const erc20 = await deployCompiled(operator, compiled.ERC20, 'MyToken', 'MTK');
        const amounts = [unit, unit.mul(2)];
        const totalAmount = amounts[0].add(amounts[1]);

        await (await erc20.mint(totalAmount)).wait();
        await (await erc20.approve(airdrop.address, totalAmount)).wait();
        await (await airdrop.multiTransferToken(erc20.address, [alice.address, bob.address], amounts)).wait();

        expect(await erc20.balanceOf(alice.address)).to.equal(amounts[0]);
        expect(await erc20.balanceOf(bob.address)).to.equal(amounts[1]);
        expect(await erc20.allowance(operator.address, airdrop.address)).to.equal(0);
    });

    it('uses call so ETH airdrops can pay contract recipients', async () => {
        const airdrop = await deployCompiled(operator, compiled.Airdrop);
        const receiver = await deployCompiled(operator, compiled.GasHungryReceiver);
        const amounts = [unit, unit.mul(2)];
        const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);

        await (
            await airdrop.multiTransferETH([receiver.address, alice.address], amounts, {
                value: amounts[0].add(amounts[1]),
            })
        ).wait();

        expect(await receiver.received()).to.equal(amounts[0]);
        expect(await ethers.provider.getBalance(receiver.address)).to.equal(amounts[0]);
        expect(await ethers.provider.getBalance(alice.address)).to.equal(aliceBalanceBefore.add(amounts[1]));
    });
});

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { Contract, ContractFactory } from 'ethers';
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

type CompiledArtifacts = Record<string, Record<string, CompiledContract>>;

function compileAirdropContracts(): CompiledArtifacts {
    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': {
                content: fs.readFileSync(path.join(__dirname, '..', '33_Airdrop', 'Airdrop.sol'), 'utf8'),
            },
            '33_Airdrop/IERC20.sol': {
                content: fs.readFileSync(path.join(__dirname, '..', '33_Airdrop', 'IERC20.sol'), 'utf8'),
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
    const errors = (output.errors || []).filter((error: { severity: string }) => error.severity === 'error');
    expect(errors.map((error: { formattedMessage: string }) => error.formattedMessage)).to.deep.equal([]);
    return output.contracts;
}

function factoryFor(
    compiled: CompiledArtifacts,
    sourceName: string,
    contractName: string,
    signer: SignerWithAddress
): ContractFactory {
    const contract = compiled[sourceName][contractName];
    return new ethers.ContractFactory(contract.abi, `0x${contract.evm.bytecode.object}`, signer);
}

describe('33 Airdrop Test', () => {
    const compiled = compileAirdropContracts();
    let operator: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let airdrop: Contract;
    let erc20: Contract;

    beforeEach(async () => {
        [operator, alice, bob] = await ethers.getSigners();

        airdrop = await factoryFor(compiled, '33_Airdrop/Airdrop.sol', 'Airdrop', operator).deploy();
        await airdrop.deployed();

        erc20 = await factoryFor(compiled, '33_Airdrop/Airdrop.sol', 'ERC20', operator).deploy('MyToken', 'MTK');
        await erc20.deployed();
    });

    it('airdrops tokens when allowance exactly matches the total amount', async () => {
        const aliceAmount = ethers.utils.parseEther('1');
        const bobAmount = ethers.utils.parseEther('2');
        const totalAmount = aliceAmount.add(bobAmount);

        await (await erc20.mint(totalAmount)).wait();
        await (await erc20.approve(airdrop.address, totalAmount)).wait();

        await (
            await airdrop.multiTransferToken(
                erc20.address,
                [alice.address, bob.address],
                [aliceAmount, bobAmount]
            )
        ).wait();

        expect(await erc20.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await erc20.balanceOf(bob.address)).to.equal(bobAmount);
        expect(await erc20.allowance(operator.address, airdrop.address)).to.equal(0);
    });

    it('airdrops ETH to contract recipients that need more than the transfer gas stipend', async () => {
        const receiver = await factoryFor(compiled, 'test/GasHeavyReceiver.sol', 'GasHeavyReceiver', operator).deploy();
        await receiver.deployed();

        const amount = ethers.utils.parseEther('1');
        await (await airdrop.multiTransferETH([receiver.address], [amount], { value: amount })).wait();

        expect(await receiver.received()).to.equal(amount);
        expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount);
    });
});

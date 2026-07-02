import { expect } from 'chai';
import { ContractFactory } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const solc = require('solc');

function compileContracts() {
    const sources = {
        '33_Airdrop/Airdrop.sol': {
            content: fs.readFileSync(path.join(__dirname, '..', '33_Airdrop', 'Airdrop.sol'), 'utf8'),
        },
        '33_Airdrop/IERC20.sol': {
            content: fs.readFileSync(path.join(__dirname, '..', '33_Airdrop', 'IERC20.sol'), 'utf8'),
        },
        'GasHeavyReceiver.sol': {
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
    const errors = (output.errors || []).filter((error: { severity: string }) => error.severity === 'error');
    expect(errors.map((error: { formattedMessage: string }) => error.formattedMessage)).to.deep.equal([]);

    return output.contracts;
}

describe('33 Airdrop regressions', () => {
    let contracts: any;

    before(() => {
        contracts = compileContracts();
    });

    async function deploy(sourceName: string, contractName: string, ...args: any[]) {
        const [deployer] = await ethers.getSigners();
        const artifact = contracts[sourceName][contractName];
        const factory = new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, deployer);
        const contract = await factory.deploy(...args);
        await contract.deployed();
        return contract;
    }

    it('allows ERC20 airdrops when allowance exactly matches the transfer total', async () => {
        const [operator, alice, bob] = await ethers.getSigners();
        const token = await deploy('33_Airdrop/Airdrop.sol', 'ERC20', 'MyToken', 'MTK');
        const airdrop = await deploy('33_Airdrop/Airdrop.sol', 'Airdrop');
        const amounts = [ethers.BigNumber.from(100), ethers.BigNumber.from(200)];

        await (await token.mint(300)).wait();
        await (await token.approve(airdrop.address, 300)).wait();
        await (await airdrop.multiTransferToken(token.address, [alice.address, bob.address], amounts)).wait();

        expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
        expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
        expect(await token.balanceOf(operator.address)).to.equal(0);
    });

    it('sends ETH to recipients whose receive hook needs more than the transfer stipend', async () => {
        const airdrop = await deploy('33_Airdrop/Airdrop.sol', 'Airdrop');
        const receiver = await deploy('GasHeavyReceiver.sol', 'GasHeavyReceiver');
        const amount = ethers.utils.parseEther('1');
        const balanceBefore = await ethers.provider.getBalance(receiver.address);

        await (await airdrop.multiTransferETH([receiver.address], [amount], { value: amount })).wait();

        expect(await ethers.provider.getBalance(receiver.address)).to.equal(balanceBefore.add(amount));
        expect(await receiver.received()).to.equal(amount);
    });
});

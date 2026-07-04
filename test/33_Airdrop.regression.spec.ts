import { expect } from 'chai';
import { Contract } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const solc = require('solc');

const repoRoot = path.join(__dirname, '..');

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

interface CompiledContract {
    abi: any[];
    evm: {
        bytecode: {
            object: string;
        };
    };
}

function readSource(filePath: string) {
    return {
        content: fs.readFileSync(path.join(repoRoot, filePath), 'utf8'),
    };
}

function compileContracts() {
    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': readSource('33_Airdrop/Airdrop.sol'),
            '33_Airdrop/IERC20.sol': readSource('33_Airdrop/IERC20.sol'),
            'GasHungryReceiver.sol': {
                content: receiverSource,
            },
        },
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            evmVersion: 'paris',
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode.object'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = output.errors || [];
    const fatalErrors = errors.filter((error: any) => error.severity === 'error');

    if (fatalErrors.length > 0) {
        throw new Error(fatalErrors.map((error: any) => error.formattedMessage).join('\n'));
    }

    return output.contracts;
}

describe('33 Airdrop regressions', () => {
    const contracts = compileContracts();

    async function deploy(filePath: string, contractName: string, ...args: any[]): Promise<Contract> {
        const [deployer] = await ethers.getSigners();
        const artifact = contracts[filePath][contractName] as CompiledContract;
        const factory = new ethers.ContractFactory(
            artifact.abi,
            `0x${artifact.evm.bytecode.object}`,
            deployer
        );
        const contract = await factory.deploy(...args);
        await contract.deployTransaction.wait(1);
        return contract;
    }

    it('allows ERC20 airdrops when allowance exactly matches the transfer total', async () => {
        const [, alice, bob] = await ethers.getSigners();
        const airdrop = await deploy('33_Airdrop/Airdrop.sol', 'Airdrop');
        const token = await deploy('33_Airdrop/Airdrop.sol', 'ERC20', 'MyToken', 'MTK');

        await (await token.mint(100)).wait();
        await (await token.approve(airdrop.address, 100)).wait();
        await (await airdrop.multiTransferToken(token.address, [alice.address, bob.address], [60, 40])).wait();

        expect(await token.balanceOf(alice.address)).to.equal(60);
        expect(await token.balanceOf(bob.address)).to.equal(40);
        expect(await token.allowance((await ethers.getSigners())[0].address, airdrop.address)).to.equal(0);
    });

    it('sends ETH to contract recipients that need more than the transfer stipend', async () => {
        const airdrop = await deploy('33_Airdrop/Airdrop.sol', 'Airdrop');
        const receiver = await deploy('GasHungryReceiver.sol', 'GasHungryReceiver');

        await (await airdrop.multiTransferETH([receiver.address], [1], { value: 1 })).wait();

        expect(await receiver.received()).to.equal(1);
        expect(await ethers.provider.getBalance(receiver.address)).to.equal(1);
    });
});

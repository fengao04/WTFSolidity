import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import { Contract } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';

const solc = require('solc');

type CompiledContract = {
    abi: any[];
    bytecode: string;
};

function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function compileContracts(sources: Record<string, string>): Record<string, CompiledContract> {
    const inputSources: Record<string, { content: string }> = {};
    for (const [sourcePath, content] of Object.entries(sources)) {
        inputSources[sourcePath] = { content };
    }

    const input = {
        language: 'Solidity',
        sources: inputSources,
        settings: {
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
    expect(
        errors.map((error: any) => error.formattedMessage).join('\n'),
        'Solidity compilation errors'
    ).to.equal('');

    const compiled: Record<string, CompiledContract> = {};
    for (const [sourcePath, contracts] of Object.entries<any>(output.contracts)) {
        for (const [contractName, artifact] of Object.entries<any>(contracts)) {
            compiled[`${sourcePath}:${contractName}`] = {
                abi: artifact.abi,
                bytecode: `0x${artifact.evm.bytecode.object}`,
            };
        }
    }
    return compiled;
}

async function deploy(compiled: CompiledContract, ...args: any[]): Promise<Contract> {
    const [deployer] = await ethers.getSigners();
    const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, deployer);
    const contract = await factory.deploy(...args);
    await contract.deployed();
    return contract;
}

describe('Recent critical regression fixes', () => {
    it('allows ERC20 airdrops when the approved allowance exactly matches the batch total', async () => {
        const [owner, alice, bob] = await ethers.getSigners();
        const compiled = compileContracts({
            '33_Airdrop/Airdrop.sol': readSource('33_Airdrop/Airdrop.sol'),
            '33_Airdrop/IERC20.sol': readSource('33_Airdrop/IERC20.sol'),
        });
        const token = await deploy(compiled['33_Airdrop/Airdrop.sol:ERC20'], 'MyToken', 'MTK');
        const airdrop = await deploy(compiled['33_Airdrop/Airdrop.sol:Airdrop']);

        await (await token.mint(300)).wait();
        await (await token.approve(airdrop.address, 300)).wait();
        await (await airdrop.multiTransferToken(token.address, [alice.address, bob.address], [100, 200])).wait();

        expect((await token.balanceOf(alice.address)).toString()).to.equal('100');
        expect((await token.balanceOf(bob.address)).toString()).to.equal('200');
        expect((await token.allowance(owner.address, airdrop.address)).toString()).to.equal('0');
    });

    it('returns delegatecall data and bubbles implementation reverts through the upgrade proxy', async () => {
        const testLogicSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract TestLogic {
    address public implementation;
    address public admin;
    string public words;

    function answer() public pure returns (uint256) {
        return 42;
    }

    function fail() public {
        revert("boom");
    }

    function setWords(string memory value) public {
        words = value;
    }
}
`;
        const compiled = compileContracts({
            '47_Upgrade/Upgrade.sol': readSource('47_Upgrade/Upgrade.sol'),
            'test/TestLogic.sol': testLogicSource,
        });
        const logic = await deploy(compiled['test/TestLogic.sol:TestLogic']);
        const proxy = await deploy(compiled['47_Upgrade/Upgrade.sol:SimpleUpgrade'], logic.address);
        const [owner] = await ethers.getSigners();
        const proxyAsLogic = new ethers.Contract(proxy.address, compiled['test/TestLogic.sol:TestLogic'].abi, owner);

        expect((await proxyAsLogic.answer()).toString()).to.equal('42');
        await expect(proxyAsLogic.fail()).to.be.revertedWith('boom');

        await (await proxyAsLogic.setWords('delegated')).wait();
        expect(await proxy.words()).to.equal('delegated');
    });
});

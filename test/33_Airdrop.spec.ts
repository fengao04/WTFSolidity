import { expect } from 'chai';
import { Contract, ContractFactory } from 'ethers';
// @ts-ignore
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

const receiverSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasHungryReceiver {
    uint256 public total;

    receive() external payable {
        total += msg.value;
    }
}
`;

function source(relativePath: string): string {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function compileContracts(): Record<string, CompiledContract> {
    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': {
                content: source('33_Airdrop/Airdrop.sol'),
            },
            '33_Airdrop/IERC20.sol': {
                content: source('33_Airdrop/IERC20.sol'),
            },
            'test/GasHungryReceiver.sol': {
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
    const errors = (output.errors || []).filter((error: { severity: string }) => error.severity === 'error');
    expect(errors.map((error: { formattedMessage: string }) => error.formattedMessage).join('\n')).to.equal('');

    return {
        Airdrop: output.contracts['33_Airdrop/Airdrop.sol'].Airdrop,
        ERC20: output.contracts['33_Airdrop/Airdrop.sol'].ERC20,
        GasHungryReceiver: output.contracts['test/GasHungryReceiver.sol'].GasHungryReceiver,
    };
}

async function deploy(contract: CompiledContract, ...args: any[]): Promise<Contract> {
    const [deployer] = await ethers.getSigners();
    const factory = new ContractFactory(contract.abi, `0x${contract.evm.bytecode.object}`, deployer);
    const deployed = await factory.deploy(...args);
    await deployed.deployTransaction.wait(1);
    return deployed;
}

describe('33 Airdrop Test', () => {
    const compiled = compileContracts();
    const tokenAmount = 300;
    let airdrop: Contract;
    let token: Contract;
    let alice: any;
    let bob: any;

    beforeEach(async () => {
        [, alice, bob] = await ethers.getSigners();
        airdrop = await deploy(compiled.Airdrop);
        token = await deploy(compiled.ERC20, 'MyToken', 'MTK');
        await (await token.mint(tokenAmount)).wait(1);
    });

    it('transfers ERC20 tokens when allowance exactly equals the airdrop total', async () => {
        await (await token.approve(airdrop.address, tokenAmount)).wait(1);

        await expect(
            airdrop.multiTransferToken(token.address, [alice.address, bob.address], [100, 200])
        ).to.not.be.reverted;

        expect(await token.balanceOf(alice.address)).to.equal(ethers.BigNumber.from(100));
        expect(await token.balanceOf(bob.address)).to.equal(ethers.BigNumber.from(200));
        expect(await token.allowance((await ethers.getSigners())[0].address, airdrop.address)).to.equal(0);
    });

    it('transfers ETH to contract recipients that need more than the transfer gas stipend', async () => {
        const receiver = await deploy(compiled.GasHungryReceiver);
        const amount = ethers.utils.parseEther('1');

        await expect(airdrop.multiTransferETH([receiver.address], [amount], { value: amount })).to.not.be.reverted;

        expect(await receiver.total()).to.equal(amount);
    });
});

import { expect } from 'chai';
import { BigNumber, Contract, ContractFactory } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore
import { ethers } from 'hardhat';

// solc is used here so lesson 33 can be tested without changing Hardhat's
// project-wide source path, which currently only compiles lesson 31.
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

type CompiledAirdropContracts = {
    Airdrop: CompiledContract;
    ERC20: CompiledContract;
    GasHungryRecipient: CompiledContract;
};

function compileAirdropContracts(): CompiledAirdropContracts {
    const root = path.resolve(__dirname, '..');
    const input = {
        language: 'Solidity',
        sources: {
            '33_Airdrop/Airdrop.sol': {
                content: fs.readFileSync(path.join(root, '33_Airdrop', 'Airdrop.sol'), 'utf8'),
            },
            '33_Airdrop/IERC20.sol': {
                content: fs.readFileSync(path.join(root, '33_Airdrop', 'IERC20.sol'), 'utf8'),
            },
            'test/GasHungryRecipient.sol': {
                content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasHungryRecipient {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}
`,
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
        GasHungryRecipient: output.contracts['test/GasHungryRecipient.sol'].GasHungryRecipient,
    };
}

describe('33 Airdrop', () => {
    let compiled: CompiledAirdropContracts;
    let operator: any;
    let alice: any;
    let bob: any;

    before(() => {
        compiled = compileAirdropContracts();
    });

    beforeEach(async () => {
        [operator, alice, bob] = await ethers.getSigners();
    });

    async function deploy(compiledContract: CompiledContract, ...args: any[]): Promise<Contract> {
        const factory = new ContractFactory(
            compiledContract.abi,
            `0x${compiledContract.evm.bytecode.object}`,
            operator
        );
        const contract = await factory.deploy(...args);
        await contract.deployTransaction.wait(1);
        return contract;
    }

    it('allows an ERC20 airdrop when allowance exactly equals the transfer total', async () => {
        const airdrop = await deploy(compiled.Airdrop);
        const token = await deploy(compiled.ERC20, 'MyToken', 'MTK');
        const amounts = [ethers.utils.parseEther('100'), ethers.utils.parseEther('200')];
        const amountSum = amounts.reduce(
            (sum: BigNumber, amount: BigNumber) => sum.add(amount),
            ethers.constants.Zero
        );

        await (await token.mint(amountSum)).wait();
        await (await token.approve(airdrop.address, amountSum)).wait();

        await (await airdrop.multiTransferToken(token.address, [alice.address, bob.address], amounts)).wait();

        expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
        expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
        expect(await token.allowance(operator.address, airdrop.address)).to.equal(0);
    });

    it('sends ETH to contract recipients that need more than transfer gas stipend', async () => {
        const airdrop = await deploy(compiled.Airdrop);
        const gasHungryRecipient = await deploy(compiled.GasHungryRecipient);
        const contractAmount = ethers.utils.parseEther('0.03');
        const bobAmount = ethers.utils.parseEther('0.02');
        const amountSum = contractAmount.add(bobAmount);

        await (
            await airdrop.multiTransferETH(
                [gasHungryRecipient.address, bob.address],
                [contractAmount, bobAmount],
                { value: amountSum }
            )
        ).wait();

        expect(await gasHungryRecipient.received()).to.equal(contractAmount);
        expect(await ethers.provider.getBalance(gasHungryRecipient.address)).to.equal(contractAmount);
    });
});

import { expect } from 'chai';
import { BigNumber, ContractFactory } from 'ethers';
import fs from 'fs';
import { ethers } from 'hardhat';
import path from 'path';

// @ts-ignore solc does not ship TypeScript declarations in this project.
import solc from 'solc';

interface CompiledContract {
    abi: any[];
    evm: {
        bytecode: {
            object: string;
        };
    };
}

function compileAirdropContracts() {
    const repoRoot = path.resolve(__dirname, '..');
    const airdropPath = '33_Airdrop/Airdrop.sol';
    const ierc20Path = '33_Airdrop/IERC20.sol';
    const input = {
        language: 'Solidity',
        sources: {
            [airdropPath]: {
                content: fs.readFileSync(path.join(repoRoot, airdropPath), 'utf8'),
            },
            [ierc20Path]: {
                content: fs.readFileSync(path.join(repoRoot, ierc20Path), 'utf8'),
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
    const errors = (output.errors || []).filter((error: any) => error.severity === 'error');
    if (errors.length > 0) {
        throw new Error(errors.map((error: any) => error.formattedMessage).join('\n'));
    }

    const contracts = output.contracts[airdropPath];
    return {
        airdrop: contracts.Airdrop as CompiledContract,
        erc20: contracts.ERC20 as CompiledContract,
    };
}

describe('33 Airdrop Test', () => {
    it('airdrops ERC20 tokens when allowance exactly equals total amount', async () => {
        const [operator, alice, bob] = await ethers.getSigners();
        const compiled = compileAirdropContracts();
        const erc20Factory = new ContractFactory(
            compiled.erc20.abi,
            `0x${compiled.erc20.evm.bytecode.object}`,
            operator
        );
        const airdropFactory = new ContractFactory(
            compiled.airdrop.abi,
            `0x${compiled.airdrop.evm.bytecode.object}`,
            operator
        );

        const token = await erc20Factory.deploy('MyToken', 'MTK');
        await token.deployed();
        const airdrop = await airdropFactory.deploy();
        await airdrop.deployed();

        const aliceAmount = BigNumber.from(100);
        const bobAmount = BigNumber.from(200);
        const totalAmount = aliceAmount.add(bobAmount);

        await (await token.mint(totalAmount)).wait();
        await (await token.approve(airdrop.address, totalAmount)).wait();

        await (await airdrop.multiTransferToken(
            token.address,
            [alice.address, bob.address],
            [aliceAmount, bobAmount]
        )).wait();

        expect(await token.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await token.balanceOf(bob.address)).to.equal(bobAmount);
        expect(await token.allowance(operator.address, airdrop.address)).to.equal(0);
    });
});

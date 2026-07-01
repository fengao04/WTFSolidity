import { expect } from 'chai';
import { BigNumber, ContractFactory } from 'ethers';
import * as fs from 'fs';
import { ethers } from 'hardhat';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const solc = require('solc');

const root = path.join(__dirname, '..');
const sources = {
    '33_Airdrop/Airdrop.sol': {
        content: fs.readFileSync(path.join(root, '33_Airdrop', 'Airdrop.sol'), 'utf8'),
    },
    '33_Airdrop/IERC20.sol': {
        content: fs.readFileSync(path.join(root, '33_Airdrop', 'IERC20.sol'), 'utf8'),
    },
    'test/GasReceiver.sol': {
        content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasReceiver {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}
`,
    },
};

function compile(contractFile: string, contractName: string) {
    const input = {
        language: 'Solidity',
        sources,
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
    const errors = output.errors?.filter((error: { severity: string }) => error.severity === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).to.be.undefined;

    const contract = output.contracts[contractFile][contractName];
    return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
    };
}

async function deploy(contractFile: string, contractName: string, args: unknown[] = []) {
    const [deployer] = await ethers.getSigners();
    const artifact = compile(contractFile, contractName);
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const contract = await factory.deploy(...args);
    await contract.deployed();
    return contract;
}

describe('33 Airdrop regressions', () => {
    it('allows ERC20 airdrops with an allowance exactly equal to the transfer total', async () => {
        const [owner, alice, bob] = await ethers.getSigners();
        const airdrop = await deploy('33_Airdrop/Airdrop.sol', 'Airdrop');
        const erc20 = await deploy('33_Airdrop/Airdrop.sol', 'ERC20', ['MyToken', 'MTK']);
        const amounts = [BigNumber.from(100), BigNumber.from(200)];
        const total = amounts[0].add(amounts[1]);

        await erc20.mint(total);
        await erc20.approve(airdrop.address, total);
        await airdrop.multiTransferToken(erc20.address, [alice.address, bob.address], amounts);

        expect(await erc20.balanceOf(alice.address)).to.equal(amounts[0]);
        expect(await erc20.balanceOf(bob.address)).to.equal(amounts[1]);
        expect(await erc20.allowance(owner.address, airdrop.address)).to.equal(0);
    });

    it('sends ETH airdrops to contract recipients that need more than the transfer stipend', async () => {
        const [, alice] = await ethers.getSigners();
        const airdrop = await deploy('33_Airdrop/Airdrop.sol', 'Airdrop');
        const receiver = await deploy('test/GasReceiver.sol', 'GasReceiver');
        const amounts = [ethers.utils.parseEther('0.1'), ethers.utils.parseEther('0.2')];
        const total = amounts[0].add(amounts[1]);

        await airdrop.multiTransferETH([receiver.address, alice.address], amounts, { value: total });

        expect(await receiver.received()).to.equal(amounts[0]);
        expect(await ethers.provider.getBalance(airdrop.address)).to.equal(0);
    });
});

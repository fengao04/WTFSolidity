import { expect } from 'chai';
import { ethers } from 'hardhat';
import { ContractFactory } from 'ethers';

const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compileAirdropContracts() {
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
        },
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
    if (errors.length > 0) {
        throw new Error(errors.map((error: { formattedMessage: string }) => error.formattedMessage).join('\n'));
    }

    return output.contracts['33_Airdrop/Airdrop.sol'];
}

describe('33 Airdrop Test', () => {
    it('allows ERC20 airdrops with exact approval', async () => {
        const [operator, alice, bob] = await ethers.getSigners();
        const contracts = compileAirdropContracts();

        const tokenFactory = new ContractFactory(
            contracts.ERC20.abi,
            contracts.ERC20.evm.bytecode.object,
            operator
        );
        const airdropFactory = new ContractFactory(
            contracts.Airdrop.abi,
            contracts.Airdrop.evm.bytecode.object,
            operator
        );

        const token = await tokenFactory.deploy('MyToken', 'MTK');
        await token.deployed();
        const airdrop = await airdropFactory.deploy();
        await airdrop.deployed();

        const aliceAmount = ethers.utils.parseEther('1');
        const bobAmount = ethers.utils.parseEther('2');
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

// @ts-ignore
import { ethers } from 'hardhat';
import { expect } from 'chai';

const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compileAirdropContracts() {
    const sources = {
        '33_Airdrop/Airdrop.sol': {
            content: fs.readFileSync(path.join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8'),
        },
        '33_Airdrop/IERC20.sol': {
            content: fs.readFileSync(path.join(__dirname, '../33_Airdrop/IERC20.sol'), 'utf8'),
        },
    };

    const input = {
        language: 'Solidity',
        sources,
        settings: {
            evmVersion: 'london',
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode.object'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter((error: any) => error.severity === 'error');
    expect(errors.map((error: any) => error.formattedMessage).join('\n')).to.equal('');

    return output.contracts['33_Airdrop/Airdrop.sol'];
}

describe('33 Airdrop Test', () => {
    it('allows an ERC20 airdrop when allowance equals the total amount', async () => {
        const [operator, alice, bob] = await ethers.getSigners();
        const compiledContracts = compileAirdropContracts();

        const ERC20Factory = new ethers.ContractFactory(
            compiledContracts.ERC20.abi,
            `0x${compiledContracts.ERC20.evm.bytecode.object}`,
            operator
        );
        const AirdropFactory = new ethers.ContractFactory(
            compiledContracts.Airdrop.abi,
            `0x${compiledContracts.Airdrop.evm.bytecode.object}`,
            operator
        );

        const token = await ERC20Factory.deploy('MyToken', 'MTK');
        await token.deployed();
        const airdrop = await AirdropFactory.deploy();
        await airdrop.deployed();

        const aliceAmount = ethers.BigNumber.from(100);
        const bobAmount = ethers.BigNumber.from(200);
        const totalAmount = aliceAmount.add(bobAmount);

        await (await token.mint(totalAmount)).wait();
        await (await token.approve(airdrop.address, totalAmount)).wait();

        await expect(
            airdrop.multiTransferToken(token.address, [alice.address, bob.address], [aliceAmount, bobAmount])
        ).to.not.be.reverted;

        expect(await token.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await token.balanceOf(bob.address)).to.equal(bobAmount);
        expect(await token.allowance(operator.address, airdrop.address)).to.equal(0);
    });
});

import path from 'path';
import { deployContract, waitTx } from './helper';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre from 'hardhat';
// @ts-ignore
import { ethers } from 'hardhat';
import { expect } from 'chai';

describe('33 Airdrop Test', () => {
    let operator: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let erc20: any;
    let airdrop: any;

    beforeEach('beforeEach', async () => {
        [operator, alice, bob] = await ethers.getSigners();
        hre.config.paths.sources = path.join(process.cwd(), '33_Airdrop');
        await hre.run('compile');
        erc20 = await deployContract(operator, '33_Airdrop/Airdrop.sol:ERC20', 'MyToken', 'MyToken');
        airdrop = await deployContract(operator, '33_Airdrop/Airdrop.sol:Airdrop');
    });

    it('allows token airdrops with an exact allowance', async () => {
        const aliceAmount = 100;
        const bobAmount = 200;
        const totalAmount = aliceAmount + bobAmount;

        await waitTx(erc20.mint(totalAmount));
        await waitTx(erc20.approve(airdrop.address, totalAmount));

        await waitTx(
            airdrop.multiTransferToken(
                erc20.address,
                [alice.address, bob.address],
                [aliceAmount, bobAmount]
            )
        );

        expect(await erc20.balanceOf(alice.address)).to.equal(aliceAmount);
        expect(await erc20.balanceOf(bob.address)).to.equal(bobAmount);
        expect(await erc20.allowance(operator.address, airdrop.address)).to.equal(0);
    });
});

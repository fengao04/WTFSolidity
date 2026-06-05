import { expect } from 'chai';
import { execFileSync } from 'child_process';
import { Contract } from 'ethers';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
// @ts-ignore
import { ethers } from 'hardhat';

type CompiledContract = {
    abi: Array<any>;
    bytecode: string;
};

function compileAirdropContracts(): Record<'Airdrop' | 'ERC20', CompiledContract> {
    const projectRoot = path.resolve(__dirname, '..');
    const outputDir = mkdtempSync(path.join(tmpdir(), 'wtf-airdrop-solc-'));

    try {
        execFileSync(
            'npx',
            [
                '--yes',
                'solc@0.8.30',
                '--base-path',
                '.',
                '--abi',
                '--bin',
                '33_Airdrop/Airdrop.sol',
                '-o',
                outputDir,
            ],
            {
                cwd: projectRoot,
                stdio: 'pipe',
            },
        );

        const readContract = (contractName: 'Airdrop' | 'ERC20'): CompiledContract => ({
            abi: JSON.parse(readFileSync(path.join(outputDir, `33_Airdrop_Airdrop_sol_${contractName}.abi`), 'utf8')),
            bytecode: `0x${readFileSync(path.join(outputDir, `33_Airdrop_Airdrop_sol_${contractName}.bin`), 'utf8').trim()}`,
        });

        return {
            Airdrop: readContract('Airdrop'),
            ERC20: readContract('ERC20'),
        };
    } finally {
        rmSync(outputDir, { recursive: true, force: true });
    }
}

describe('33 Airdrop Test', () => {
    const unit = ethers.constants.WeiPerEther;
    let compiled: Record<'Airdrop' | 'ERC20', CompiledContract>;

    before('compile lesson 33 contracts', () => {
        compiled = compileAirdropContracts();
    });

    async function deployAirdropFixture() {
        const [operator, alice, bob] = await ethers.getSigners();
        const tokenFactory = new ethers.ContractFactory(compiled.ERC20.abi, compiled.ERC20.bytecode, operator);
        const airdropFactory = new ethers.ContractFactory(compiled.Airdrop.abi, compiled.Airdrop.bytecode, operator);

        const token: Contract = await tokenFactory.deploy('MyToken', 'MTK');
        const airdrop: Contract = await airdropFactory.deploy();
        await token.deployed();
        await airdrop.deployed();

        return { operator, alice, bob, token, airdrop };
    }

    it('transfers tokens when allowance exactly equals the airdrop total', async () => {
        const { alice, bob, token, airdrop } = await deployAirdropFixture();
        const amounts = [unit.mul(2), unit.mul(3)];
        const totalAmount = amounts[0].add(amounts[1]);

        await token.mint(totalAmount);
        await token.approve(airdrop.address, totalAmount);

        await airdrop.multiTransferToken(token.address, [alice.address, bob.address], amounts);

        expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
        expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
        expect(await token.allowance(await token.signer.getAddress(), airdrop.address)).to.equal(0);
    });

    it('reverts before transferring when allowance is below the airdrop total', async () => {
        const { alice, bob, token, airdrop } = await deployAirdropFixture();
        const amounts = [unit.mul(2), unit.mul(3)];
        const totalAmount = amounts[0].add(amounts[1]);

        await token.mint(totalAmount);
        await token.approve(airdrop.address, totalAmount.sub(1));

        await expect(airdrop.multiTransferToken(token.address, [alice.address, bob.address], amounts)).to.be.revertedWith(
            'Need Approve ERC20 token',
        );
        expect(await token.balanceOf(alice.address)).to.equal(0);
        expect(await token.balanceOf(bob.address)).to.equal(0);
    });
});

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Contract, ContractFactory } from 'ethers';
// @ts-ignore
import { ethers } from 'hardhat';
import { expect } from 'chai';

type SolcArtifact = {
    abi: Array<any>;
    bytecode: string;
};

function compileUpgradeContracts(): Record<string, SolcArtifact> {
    const outputDir = mkdtempSync(join(tmpdir(), 'wtf-upgrade-'));
    try {
        execFileSync(
            'npx',
            [
                '--yes',
                'solc@0.8.4',
                '--base-path',
                '.',
                '--bin',
                '--abi',
                '47_Upgrade/Upgrade.sol',
                '-o',
                outputDir,
            ],
            { cwd: process.cwd(), stdio: 'pipe' },
        );

        const readArtifact = (contractName: string): SolcArtifact => ({
            abi: JSON.parse(
                readFileSync(join(outputDir, `47_Upgrade_Upgrade_sol_${contractName}.abi`), 'utf8'),
            ),
            bytecode: `0x${readFileSync(
                join(outputDir, `47_Upgrade_Upgrade_sol_${contractName}.bin`),
                'utf8',
            )}`,
        });

        return {
            Logic1: readArtifact('Logic1'),
            Logic2: readArtifact('Logic2'),
            SimpleUpgrade: readArtifact('SimpleUpgrade'),
        };
    } finally {
        rmSync(outputDir, { recursive: true, force: true });
    }
}

describe('47 Upgrade Test', () => {
    let artifacts: Record<string, SolcArtifact>;

    before('compile contracts', () => {
        artifacts = compileUpgradeContracts();
    });

    async function deployContract(name: string, ...args: Array<any>): Promise<Contract> {
        const [operator] = await ethers.getSigners();
        const factory = new ContractFactory(artifacts[name].abi, artifacts[name].bytecode, operator);
        const contract = await factory.deploy(...args);
        await contract.deployTransaction.wait(1);
        return contract;
    }

    it('delegates calls before and after upgrading implementation', async () => {
        const logic1 = await deployContract('Logic1');
        const logic2 = await deployContract('Logic2');
        const proxy = await deployContract('SimpleUpgrade', logic1.address);
        const proxiedLogic1 = new Contract(proxy.address, artifacts.Logic1.abi, proxy.signer);
        const proxiedLogic2 = new Contract(proxy.address, artifacts.Logic2.abi, proxy.signer);

        await (await proxiedLogic1.foo()).wait(1);
        expect(await proxy.words()).to.equal('old');

        await (await proxy.upgrade(logic2.address)).wait(1);
        await (await proxiedLogic2.foo()).wait(1);
        expect(await proxy.words()).to.equal('new');
    });

    it('bubbles failed delegated calls', async () => {
        const [operator] = await ethers.getSigners();
        const logic1 = await deployContract('Logic1');
        const proxy = await deployContract('SimpleUpgrade', logic1.address);

        await expect(
            operator.sendTransaction({
                to: proxy.address,
                data: '0xdeadbeef',
            }),
        ).to.be.reverted;
    });
});

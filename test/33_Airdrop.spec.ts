import { expect } from 'chai';
import { BigNumber, ContractFactory } from 'ethers';
import { readFileSync } from 'fs';
// @ts-ignore
import { ethers } from 'hardhat';

const solc = require('solc');

type CompiledContract = {
  abi: any[];
  evm: {
    bytecode: {
      object: string;
    };
  };
};

function compileAirdropContract(contractName: string): CompiledContract {
  const input = {
    language: 'Solidity',
    sources: {
      '33_Airdrop/Airdrop.sol': {
        content: readFileSync('33_Airdrop/Airdrop.sol', 'utf8'),
      },
      '33_Airdrop/IERC20.sol': {
        content: readFileSync('33_Airdrop/IERC20.sol', 'utf8'),
      },
    },
    settings: {
      evmVersion: 'paris',
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((error: any) => error.severity === 'error');
  expect(errors.map((error: any) => error.formattedMessage).join('\n')).to.equal('');

  return output.contracts['33_Airdrop/Airdrop.sol'][contractName];
}

async function deployCompiled(contractName: string, ...args: any[]) {
  const [deployer] = await ethers.getSigners();
  const compiled = compileAirdropContract(contractName);
  const factory = new ContractFactory(compiled.abi, compiled.evm.bytecode.object, deployer);
  const contract = await factory.deploy(...args);
  await contract.deployed();
  return contract;
}

describe('33 Airdrop Test', () => {
  it('multiTransferToken accepts an allowance equal to the total airdrop amount', async () => {
    const [owner, alice, bob] = await ethers.getSigners();
    const airdrop = await deployCompiled('Airdrop');
    const token = await deployCompiled('ERC20', 'MyToken', 'MTK');

    const aliceAmount = BigNumber.from(100);
    const bobAmount = BigNumber.from(200);
    const totalAmount = aliceAmount.add(bobAmount);

    await (await token.mint(totalAmount)).wait();
    await (await token.approve(airdrop.address, totalAmount)).wait();

    await (
      await airdrop.multiTransferToken(
        token.address,
        [alice.address, bob.address],
        [aliceAmount, bobAmount]
      )
    ).wait();

    expect(await token.balanceOf(owner.address)).to.equal(0);
    expect(await token.balanceOf(alice.address)).to.equal(aliceAmount);
    expect(await token.balanceOf(bob.address)).to.equal(bobAmount);
    expect(await token.allowance(owner.address, airdrop.address)).to.equal(0);
  });
});

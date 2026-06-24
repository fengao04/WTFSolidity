import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";
// @ts-ignore
import { ethers } from "hardhat";

const solc = require("solc");

const receiverSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasHeavyReceiver {
    uint256 public totalReceived;

    receive() external payable {
        totalReceived += msg.value;
    }
}
`;

type CompiledContract = {
  abi: any[];
  evm: {
    bytecode: {
      object: string;
    };
  };
};

function compileContracts(): Record<string, CompiledContract> {
  const input = {
    language: "Solidity",
    sources: {
      "33_Airdrop/Airdrop.sol": {
        content: readFileSync(
          join(__dirname, "../33_Airdrop/Airdrop.sol"),
          "utf8"
        ),
      },
      "33_Airdrop/IERC20.sol": {
        content: readFileSync(
          join(__dirname, "../33_Airdrop/IERC20.sol"),
          "utf8"
        ),
      },
      "test/GasHeavyReceiver.sol": {
        content: receiverSource,
      },
    },
    settings: {
      evmVersion: "paris",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(
    (error: { severity: string }) => error.severity === "error"
  );
  expect(
    errors.map((error: { formattedMessage: string }) => error.formattedMessage)
  ).to.deep.equal([]);

  return {
    Airdrop: output.contracts["33_Airdrop/Airdrop.sol"].Airdrop,
    ERC20: output.contracts["33_Airdrop/Airdrop.sol"].ERC20,
    GasHeavyReceiver:
      output.contracts["test/GasHeavyReceiver.sol"].GasHeavyReceiver,
  };
}

describe("33 Airdrop regressions", () => {
  const unit = ethers.constants.WeiPerEther;
  let contracts: Record<string, CompiledContract>;

  before(() => {
    contracts = compileContracts();
  });

  async function deploy(
    contractName: string,
    ...args: any[]
  ): Promise<Contract> {
    const [deployer] = await ethers.getSigners();
    const compiled = contracts[contractName];
    const factory = new ContractFactory(
      compiled.abi,
      `0x${compiled.evm.bytecode.object}`,
      deployer
    );
    const contract = await factory.deploy(...args);
    await contract.deployed();
    return contract;
  }

  it("allows ERC20 airdrops with an exact approval", async () => {
    const [deployer, alice, bob] = await ethers.getSigners();
    const token = await deploy("ERC20", "MyToken", "MTK");
    const airdrop = await deploy("Airdrop");
    const amounts = [unit, unit.mul(2)];
    const totalAmount = amounts[0].add(amounts[1]);

    await token.mint(totalAmount);
    await token.approve(airdrop.address, totalAmount);
    await airdrop.multiTransferToken(
      token.address,
      [alice.address, bob.address],
      amounts
    );

    expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
    expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
    expect(await token.allowance(deployer.address, airdrop.address)).to.equal(
      0
    );
  });

  it("sends ETH to recipients that need more than the transfer gas stipend", async () => {
    const [, alice] = await ethers.getSigners();
    const airdrop = await deploy("Airdrop");
    const receiver = await deploy("GasHeavyReceiver");
    const contractAmount = unit;
    const aliceAmount = unit.mul(2);
    const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);

    await airdrop.multiTransferETH(
      [receiver.address, alice.address],
      [contractAmount, aliceAmount],
      { value: contractAmount.add(aliceAmount) }
    );

    expect(await receiver.totalReceived()).to.equal(contractAmount);
    expect(await ethers.provider.getBalance(alice.address)).to.equal(
      aliceBalanceBefore.add(aliceAmount)
    );
    expect(await ethers.provider.getBalance(airdrop.address)).to.equal(0);
  });
});

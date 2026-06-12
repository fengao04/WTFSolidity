import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const solc = require("solc");

type CompiledContract = {
  abi: any;
  evm: {
    bytecode: {
      object: string;
    };
  };
};

const AIRDROP_SOURCE = "33_Airdrop/Airdrop.sol";
const IERC20_SOURCE = "33_Airdrop/IERC20.sol";
const RECEIVER_SOURCE = "GasHungryReceiver.sol";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function compileLesson33(): Record<string, Record<string, CompiledContract>> {
  const input = {
    language: "Solidity",
    sources: {
      [AIRDROP_SOURCE]: {
        content: readSource(AIRDROP_SOURCE),
      },
      [IERC20_SOURCE]: {
        content: readSource(IERC20_SOURCE),
      },
      [RECEIVER_SOURCE]: {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

contract GasHungryReceiver {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}
`,
      },
    },
    settings: {
      evmVersion: "paris",
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors =
    output.errors?.filter(
      (error: { severity: string }) => error.severity === "error"
    ) || [];
  expect(
    errors,
    output.errors
      ?.map((error: { formattedMessage: string }) => error.formattedMessage)
      .join("\n")
  ).to.be.empty;

  return output.contracts;
}

describe("33 Airdrop regressions", () => {
  const contracts = compileLesson33();

  async function deployContract(
    source: string,
    name: string,
    args: any[] = []
  ): Promise<Contract> {
    const [deployer] = await ethers.getSigners();
    const compiled = contracts[source][name];
    const factory = new ContractFactory(
      compiled.abi,
      `0x${compiled.evm.bytecode.object}`,
      deployer
    );
    const contract = await factory.deploy(...args);
    await contract.deployTransaction.wait(1);
    return contract;
  }

  it("allows ERC20 airdrops when allowance exactly matches the total amount", async () => {
    const [owner, alice, bob] = await ethers.getSigners();
    const airdrop = await deployContract(AIRDROP_SOURCE, "Airdrop");
    const token = await deployContract(AIRDROP_SOURCE, "ERC20", [
      "MyToken",
      "MTK",
    ]);
    const aliceAmount = BigNumber.from(100);
    const bobAmount = BigNumber.from(200);
    const totalAmount = aliceAmount.add(bobAmount);

    await (await token.mint(totalAmount)).wait(1);
    await (await token.approve(airdrop.address, totalAmount)).wait(1);
    await (
      await airdrop.multiTransferToken(
        token.address,
        [alice.address, bob.address],
        [aliceAmount, bobAmount]
      )
    ).wait(1);

    expect(await token.balanceOf(alice.address)).to.equal(aliceAmount);
    expect(await token.balanceOf(bob.address)).to.equal(bobAmount);
    expect(await token.allowance(owner.address, airdrop.address)).to.equal(0);
  });

  it("sends ETH to contract recipients that need more than the transfer stipend", async () => {
    const [, , bob] = await ethers.getSigners();
    const airdrop = await deployContract(AIRDROP_SOURCE, "Airdrop");
    const receiver = await deployContract(RECEIVER_SOURCE, "GasHungryReceiver");
    const amount = ethers.utils.parseEther("1");
    const bobBalanceBefore = await ethers.provider.getBalance(bob.address);

    await (
      await airdrop.multiTransferETH(
        [receiver.address, bob.address],
        [amount, amount],
        {
          value: amount.mul(2),
        }
      )
    ).wait(1);

    expect(await receiver.received()).to.equal(amount);
    expect(await ethers.provider.getBalance(bob.address)).to.equal(
      bobBalanceBefore.add(amount)
    );
  });
});

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { expect } = require("chai");
const { ethers } = require("hardhat");

function compileAirdropContracts(extraSources = {}) {
  const sources = {
    "33_Airdrop/Airdrop.sol": {
      content: fs.readFileSync(path.join(__dirname, "../33_Airdrop/Airdrop.sol"), "utf8"),
    },
    "33_Airdrop/IERC20.sol": {
      content: fs.readFileSync(path.join(__dirname, "../33_Airdrop/IERC20.sol"), "utf8"),
    },
    ...extraSources,
  };
  const input = {
    language: "Solidity",
    sources,
    settings: {
      evmVersion: "paris",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((error) => error.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.formattedMessage).join("\n"));
  }
  return output.contracts;
}

async function deploy(compiledContract, signer, ...args) {
  const factory = new ethers.ContractFactory(
    compiledContract.abi,
    compiledContract.evm.bytecode.object,
    signer
  );
  const contract = await factory.deploy(...args);
  await contract.deployed();
  return contract;
}

describe("33 Airdrop regressions", () => {
  let deployer;
  let alice;
  let bob;
  let contracts;

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    contracts = compileAirdropContracts({
      "test/GasHungryReceiver.sol": {
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
    });
  });

  it("accepts an allowance exactly equal to the token airdrop total", async () => {
    const token = await deploy(contracts["33_Airdrop/Airdrop.sol"].ERC20, deployer, "Token", "TKN");
    const airdrop = await deploy(contracts["33_Airdrop/Airdrop.sol"].Airdrop, deployer);

    await token.mint(3);
    await token.approve(airdrop.address, 3);

    await expect(
      airdrop.multiTransferToken(token.address, [alice.address, bob.address], [1, 2])
    ).to.not.be.reverted;

    expect(await token.balanceOf(alice.address)).to.equal(1);
    expect(await token.balanceOf(bob.address)).to.equal(2);
  });

  it("sends ETH to contract recipients that need more than transfer's gas stipend", async () => {
    const airdrop = await deploy(contracts["33_Airdrop/Airdrop.sol"].Airdrop, deployer);
    const receiver = await deploy(contracts["test/GasHungryReceiver.sol"].GasHungryReceiver, deployer);
    const receiverAmount = ethers.utils.parseEther("0.1");
    const bobAmount = ethers.utils.parseEther("0.2");

    await expect(
      airdrop.multiTransferETH([receiver.address, bob.address], [receiverAmount, bobAmount], {
        value: receiverAmount.add(bobAmount),
      })
    ).to.not.be.reverted;

    expect(await receiver.received()).to.equal(receiverAmount);
    expect(await ethers.provider.getBalance(receiver.address)).to.equal(receiverAmount);
  });
});

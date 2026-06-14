const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { expect } = require("chai");
const { ethers } = require("hardhat");

function compileUpgradeContracts(extraSources = {}) {
  const sources = {
    "47_Upgrade/Upgrade.sol": {
      content: fs.readFileSync(path.join(__dirname, "../47_Upgrade/Upgrade.sol"), "utf8"),
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

describe("47 Upgrade regressions", () => {
  let deployer;
  let contracts;

  before(async () => {
    [deployer] = await ethers.getSigners();
    contracts = compileUpgradeContracts({
      "test/RevertingLogic.sol": {
        content: `
          // SPDX-License-Identifier: MIT
          pragma solidity ^0.8.4;

          contract RevertingLogic {
              address public implementation;
              address public admin;
              string public words;

              function answer() external pure returns (uint256) {
                  return 42;
              }

              function explode() external pure {
                  revert("boom");
              }
          }
        `,
      },
    });
  });

  it("bubbles delegatecall return data and reverts through the proxy fallback", async () => {
    const logic = await deploy(contracts["test/RevertingLogic.sol"].RevertingLogic, deployer);
    const proxy = await deploy(contracts["47_Upgrade/Upgrade.sol"].SimpleUpgrade, deployer, logic.address);
    const proxiedLogic = new ethers.Contract(proxy.address, contracts["test/RevertingLogic.sol"].RevertingLogic.abi, deployer);

    expect(await proxiedLogic.answer()).to.equal(42);
    await expect(proxiedLogic.explode()).to.be.revertedWith("boom");
  });
});

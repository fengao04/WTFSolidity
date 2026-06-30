import * as fs from "fs";
import * as path from "path";
import { ethers } from "hardhat";
import { expect } from "chai";

const solc = require("solc");

type CompiledContract = {
  abi: any[];
  bytecode: string;
};

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function compileContracts(
  sources: Record<string, string>,
  contractRefs: string[]
): Record<string, CompiledContract> {
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      Object.entries(sources).map(([sourceName, content]) => [
        sourceName,
        { content },
      ])
    ),
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(
    (error: any) => error.severity === "error"
  );
  if (errors.length > 0) {
    throw new Error(
      errors.map((error: any) => error.formattedMessage).join("\n")
    );
  }

  return Object.fromEntries(
    contractRefs.map((contractRef) => {
      const [sourceName, contractName] = contractRef.split(":");
      const contract = output.contracts[sourceName][contractName];
      return [
        contractName,
        {
          abi: contract.abi,
          bytecode: `0x${contract.evm.bytecode.object}`,
        },
      ];
    })
  );
}

describe("critical lesson regressions", () => {
  let airdropContracts: Record<string, CompiledContract>;
  let upgradeContracts: Record<string, CompiledContract>;

  before(() => {
    airdropContracts = compileContracts(
      {
        "33_Airdrop/Airdrop.sol": readSource("33_Airdrop/Airdrop.sol"),
        "33_Airdrop/IERC20.sol": readSource("33_Airdrop/IERC20.sol"),
        "test/GasHungryReceiver.sol": `
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
      [
        "33_Airdrop/Airdrop.sol:Airdrop",
        "33_Airdrop/Airdrop.sol:ERC20",
        "test/GasHungryReceiver.sol:GasHungryReceiver",
      ]
    );

    upgradeContracts = compileContracts(
      {
        "47_Upgrade/Upgrade.sol": readSource("47_Upgrade/Upgrade.sol"),
        "test/UpgradeTestLogic.sol": `
                    // SPDX-License-Identifier: MIT
                    pragma solidity ^0.8.4;

                    contract UpgradeTestLogic {
                        address public implementation;
                        address public admin;
                        string public words;

                        function answer() external pure returns (uint256) {
                            return 42;
                        }

                        function fail() external pure {
                            revert("logic failed");
                        }
                    }
                `,
      },
      [
        "47_Upgrade/Upgrade.sol:SimpleUpgrade",
        "test/UpgradeTestLogic.sol:UpgradeTestLogic",
      ]
    );
  });

  async function deploy(contract: CompiledContract, ...args: any[]) {
    const [deployer] = await ethers.getSigners();
    const factory = new ethers.ContractFactory(
      contract.abi,
      contract.bytecode,
      deployer
    );
    const deployed = await factory.deploy(...args);
    await deployed.deployed();
    return deployed;
  }

  it("allows ERC20 airdrops with an exact allowance", async () => {
    const [, alice, bob] = await ethers.getSigners();
    const airdrop = await deploy(airdropContracts.Airdrop);
    const token = await deploy(airdropContracts.ERC20, "WTF Token", "WTF");
    const amounts = [
      ethers.utils.parseEther("1"),
      ethers.utils.parseEther("2"),
    ];
    const amountSum = amounts[0].add(amounts[1]);

    await (await token.mint(amountSum)).wait();
    await (await token.approve(airdrop.address, amountSum)).wait();
    await (
      await airdrop.multiTransferToken(
        token.address,
        [alice.address, bob.address],
        amounts
      )
    ).wait();

    expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
    expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
    expect(
      await token.allowance(
        (
          await ethers.getSigners()
        )[0].address,
        airdrop.address
      )
    ).to.equal(0);
  });

  it("can airdrop ETH to contracts that need more than the transfer stipend", async () => {
    const [, alice] = await ethers.getSigners();
    const airdrop = await deploy(airdropContracts.Airdrop);
    const receiver = await deploy(airdropContracts.GasHungryReceiver);
    const amount = ethers.utils.parseEther("0.01");
    const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);

    await (
      await airdrop.multiTransferETH(
        [receiver.address, alice.address],
        [amount, amount],
        { value: amount.mul(2) }
      )
    ).wait();

    expect(await receiver.received()).to.equal(amount);
    expect(await ethers.provider.getBalance(alice.address)).to.equal(
      aliceBalanceBefore.add(amount)
    );
  });

  it("bubbles delegatecall return data and reverts through the upgrade proxy", async () => {
    const [deployer] = await ethers.getSigners();
    const logic = await deploy(upgradeContracts.UpgradeTestLogic);
    const proxy = await deploy(upgradeContracts.SimpleUpgrade, logic.address);
    const proxiedLogic = new ethers.Contract(
      proxy.address,
      upgradeContracts.UpgradeTestLogic.abi,
      deployer
    );

    expect(await proxiedLogic.callStatic.answer()).to.equal(42);
    await expect(proxiedLogic.fail()).to.be.revertedWith("logic failed");
  });
});

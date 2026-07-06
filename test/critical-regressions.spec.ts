import fs from "fs";
import path from "path";
import { Contract, ContractFactory } from "ethers";
// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "chai";
import solc from "solc";

type CompiledContract = {
  abi: any[];
  bytecode: string;
};

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function compileContract(
  sources: Record<string, string>,
  sourceName: string,
  contractName: string
): CompiledContract {
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      Object.entries(sources).map(([name, content]) => [name, { content }])
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
  expect(
    errors.map((error: any) => error.formattedMessage),
    "solc compilation errors"
  ).to.be.empty;

  const contract = output.contracts[sourceName][contractName];
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

async function deploy(
  compiled: CompiledContract,
  ...args: any[]
): Promise<Contract> {
  const [deployer] = await ethers.getSigners();
  const factory = new ContractFactory(
    compiled.abi,
    compiled.bytecode,
    deployer
  );
  const contract = await factory.deploy(...args);
  await contract.deployed();
  return contract;
}

describe("critical regression coverage", () => {
  const airdropSources = {
    "33_Airdrop/Airdrop.sol": readSource("33_Airdrop/Airdrop.sol"),
    "33_Airdrop/IERC20.sol": readSource("33_Airdrop/IERC20.sol"),
  };

  it("allows ERC20 airdrops with an exact allowance", async () => {
    const [, alice, bob] = await ethers.getSigners();
    const token = await deploy(
      compileContract(airdropSources, "33_Airdrop/Airdrop.sol", "ERC20"),
      "MyToken",
      "MTK"
    );
    const airdrop = await deploy(
      compileContract(airdropSources, "33_Airdrop/Airdrop.sol", "Airdrop")
    );

    const amounts = [
      ethers.utils.parseEther("100"),
      ethers.utils.parseEther("200"),
    ];
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
    expect(
      await token.allowance(
        (
          await ethers.getSigners()
        )[0].address,
        airdrop.address
      )
    ).to.equal(0);
  });

  it("uses call for ETH airdrops so contract recipients are payable", async () => {
    const receiverSource = `
            // SPDX-License-Identifier: MIT
            pragma solidity ^0.8.4;

            contract GasHungryReceiver {
                uint256 public received;

                receive() external payable {
                    received += msg.value;
                }
            }
        `;
    const airdrop = await deploy(
      compileContract(airdropSources, "33_Airdrop/Airdrop.sol", "Airdrop")
    );
    const receiverCompiled = compileContract(
      { "GasHungryReceiver.sol": receiverSource },
      "GasHungryReceiver.sol",
      "GasHungryReceiver"
    );
    const firstReceiver = await deploy(receiverCompiled);
    const secondReceiver = await deploy(receiverCompiled);

    const amounts = [
      ethers.utils.parseEther("0.1"),
      ethers.utils.parseEther("0.2"),
    ];
    await airdrop.multiTransferETH(
      [firstReceiver.address, secondReceiver.address],
      amounts,
      { value: amounts[0].add(amounts[1]) }
    );

    expect(await firstReceiver.received()).to.equal(amounts[0]);
    expect(await secondReceiver.received()).to.equal(amounts[1]);
  });

  it("bubbles delegatecall returns and reverts from the upgrade implementation", async () => {
    const upgradeSources = {
      "47_Upgrade/Upgrade.sol": readSource("47_Upgrade/Upgrade.sol"),
      "ProxyTestLogic.sol": `
                // SPDX-License-Identifier: MIT
                pragma solidity ^0.8.4;

                contract ProxyTestLogic {
                    address public implementation;
                    address public admin;
                    string public words;

                    function setWords(string calldata newWords) external {
                        words = newWords;
                    }

                    function getWords() external view returns (string memory) {
                        return words;
                    }

                    function fail() external pure {
                        revert("logic failed");
                    }
                }
            `,
    };
    const logic = await deploy(
      compileContract(upgradeSources, "ProxyTestLogic.sol", "ProxyTestLogic")
    );
    const proxy = await deploy(
      compileContract(
        upgradeSources,
        "47_Upgrade/Upgrade.sol",
        "SimpleUpgrade"
      ),
      logic.address
    );
    const proxyAsLogic = new Contract(
      proxy.address,
      compileContract(
        upgradeSources,
        "ProxyTestLogic.sol",
        "ProxyTestLogic"
      ).abi,
      (await ethers.getSigners())[0]
    );

    await proxyAsLogic.setWords("delegated");

    expect(await proxy.words()).to.equal("delegated");
    expect(await proxyAsLogic.getWords()).to.equal("delegated");
    await expect(proxyAsLogic.fail()).to.be.revertedWith("logic failed");
  });
});

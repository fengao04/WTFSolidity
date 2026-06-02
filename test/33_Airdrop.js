const path = require("path");
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

async function compileAirdropLesson() {
  const previousSources = hre.config.paths.sources;
  hre.config.paths.sources = path.join(__dirname, "../33_Airdrop");

  try {
    await hre.run("compile", { force: true, quiet: true });
  } finally {
    hre.config.paths.sources = previousSources;
  }
}

describe("Airdrop", function () {
  before(async function () {
    await compileAirdropLesson();
  });

  it("allows an ERC20 airdrop when allowance exactly equals the transfer total", async function () {
    const [sender, alice, bob] = await ethers.getSigners();
    const amounts = [ethers.utils.parseEther("1"), ethers.utils.parseEther("2")];
    const totalAmount = amounts.reduce(
      (sum, amount) => sum.add(amount),
      ethers.constants.Zero
    );

    const Token = await ethers.getContractFactory("ERC20");
    const token = await Token.deploy("Test Token", "TEST");
    await token.deployed();

    const Airdrop = await ethers.getContractFactory("Airdrop");
    const airdrop = await Airdrop.deploy();
    await airdrop.deployed();

    await token.mint(totalAmount);
    await token.approve(airdrop.address, totalAmount);

    await airdrop.multiTransferToken(
      token.address,
      [alice.address, bob.address],
      amounts
    );

    expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
    expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
    expect(await token.balanceOf(sender.address)).to.equal(0);
    expect(await token.allowance(sender.address, airdrop.address)).to.equal(0);
  });
});

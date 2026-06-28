import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Contract, ContractFactory, Signer } from 'ethers';
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

function compileContracts(sources: Record<string, string>) {
    const input = {
        language: 'Solidity',
        sources: Object.fromEntries(
            Object.entries(sources).map(([name, content]) => [name, { content }])
        ),
        settings: {
            evmVersion: 'paris',
            optimizer: {
                enabled: true,
                runs: 200,
            },
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode.object'],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter((error: any) => error.severity === 'error');
    expect(errors, JSON.stringify(errors, null, 2)).to.have.length(0);

    return output.contracts as Record<string, Record<string, CompiledContract>>;
}

function factoryFor(
    contracts: Record<string, Record<string, CompiledContract>>,
    sourceName: string,
    contractName: string,
    signer: Signer
): ContractFactory {
    const contract = contracts[sourceName][contractName];
    return new ethers.ContractFactory(contract.abi, contract.evm.bytecode.object, signer);
}

describe('critical regression coverage', () => {
    let operator: Signer;
    let alice: Signer;
    let bob: Signer;

    before(async () => {
        [operator, alice, bob] = await ethers.getSigners();
    });

    describe('33_Airdrop', () => {
        let airdropFactory: ContractFactory;
        let tokenFactory: ContractFactory;
        let receiverFactory: ContractFactory;

        before(() => {
            const contracts = compileContracts({
                '33_Airdrop/IERC20.sol': readFileSync('33_Airdrop/IERC20.sol', 'utf8'),
                '33_Airdrop/Airdrop.sol': readFileSync('33_Airdrop/Airdrop.sol', 'utf8'),
                'test/GreedyReceiver.sol': `
                    // SPDX-License-Identifier: MIT
                    pragma solidity ^0.8.4;

                    contract GreedyReceiver {
                        uint256 public received;

                        receive() external payable {
                            received += msg.value;
                        }
                    }
                `,
            });

            airdropFactory = factoryFor(contracts, '33_Airdrop/Airdrop.sol', 'Airdrop', operator);
            tokenFactory = factoryFor(contracts, '33_Airdrop/Airdrop.sol', 'ERC20', operator);
            receiverFactory = factoryFor(contracts, 'test/GreedyReceiver.sol', 'GreedyReceiver', operator);
        });

        it('allows ERC20 airdrops with an allowance exactly equal to the transfer sum', async () => {
            const airdrop = await airdropFactory.deploy();
            const token = await tokenFactory.deploy('WTF', 'WTF');
            const firstAmount = ethers.utils.parseEther('1');
            const secondAmount = ethers.utils.parseEther('2');
            const totalAmount = firstAmount.add(secondAmount);

            await token.mint(totalAmount);
            await token.approve(airdrop.address, totalAmount);
            await airdrop.multiTransferToken(
                token.address,
                [await alice.getAddress(), await bob.getAddress()],
                [firstAmount, secondAmount]
            );

            expect(await token.balanceOf(await alice.getAddress())).to.equal(firstAmount);
            expect(await token.balanceOf(await bob.getAddress())).to.equal(secondAmount);
            expect(await token.allowance(await operator.getAddress(), airdrop.address)).to.equal(0);
        });

        it('sends ETH to recipients that need more than the transfer gas stipend', async () => {
            const airdrop = await airdropFactory.deploy();
            const receiver = await receiverFactory.deploy();
            const amount = ethers.utils.parseEther('0.01');

            await airdrop.multiTransferETH(
                [receiver.address, await alice.getAddress()],
                [amount, amount],
                { value: amount.mul(2) }
            );

            expect(await receiver.received()).to.equal(amount);
            expect(await ethers.provider.getBalance(receiver.address)).to.equal(amount);
        });
    });

    describe('47_Upgrade', () => {
        let simpleUpgradeFactory: ContractFactory;
        let logic1Factory: ContractFactory;
        let revertingLogicFactory: ContractFactory;
        let returnLogicFactory: ContractFactory;

        before(() => {
            const contracts = compileContracts({
                '47_Upgrade/Upgrade.sol': readFileSync('47_Upgrade/Upgrade.sol', 'utf8'),
                'test/ProxyTestLogic.sol': `
                    // SPDX-License-Identifier: MIT
                    pragma solidity ^0.8.4;

                    contract RevertingLogic {
                        address public implementation;
                        address public admin;
                        string public words;

                        function foo() public pure {
                            revert("logic failed");
                        }
                    }

                    contract ReturnLogic {
                        address public implementation;
                        address public admin;
                        string public words;

                        function answer() public pure returns (uint256) {
                            return 42;
                        }
                    }
                `,
            });

            simpleUpgradeFactory = factoryFor(contracts, '47_Upgrade/Upgrade.sol', 'SimpleUpgrade', operator);
            logic1Factory = factoryFor(contracts, '47_Upgrade/Upgrade.sol', 'Logic1', operator);
            revertingLogicFactory = factoryFor(contracts, 'test/ProxyTestLogic.sol', 'RevertingLogic', operator);
            returnLogicFactory = factoryFor(contracts, 'test/ProxyTestLogic.sol', 'ReturnLogic', operator);
        });

        async function deployProxyWith(implementation: Contract) {
            return simpleUpgradeFactory.deploy(implementation.address);
        }

        it('bubbles delegatecall reverts to the caller', async () => {
            const logic1 = await logic1Factory.deploy();
            const revertingLogic = await revertingLogicFactory.deploy();
            const proxy = await deployProxyWith(logic1);
            await proxy.upgrade(revertingLogic.address);

            await expect(
                operator.sendTransaction({
                    to: proxy.address,
                    data: revertingLogic.interface.getSighash('foo'),
                })
            ).to.be.revertedWith('logic failed');
        });

        it('returns delegatecall return data to the caller', async () => {
            const returnLogic = await returnLogicFactory.deploy();
            const proxy = await deployProxyWith(returnLogic);
            const data = returnLogic.interface.getSighash('answer');

            const result = await ethers.provider.call({ to: proxy.address, data });

            expect(returnLogic.interface.decodeFunctionResult('answer', result)[0]).to.equal(42);
        });
    });
});

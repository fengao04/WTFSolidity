import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('critical regression checks', () => {
    const root = join(__dirname, '..');

    it('allows an ERC20 airdrop with exactly the approved total amount', () => {
        const source = readFileSync(join(root, '33_Airdrop', 'Airdrop.sol'), 'utf8');

        expect(source).to.include('token.allowance(msg.sender, address(this)) >= _amountSum');
        expect(source).to.not.include('token.allowance(msg.sender, address(this)) > _amountSum');
    });

    it('bubbles delegatecall return data and reverts from the upgrade proxy fallback', () => {
        const source = readFileSync(join(root, '47_Upgrade', 'Upgrade.sol'), 'utf8');
        const fallbackBody = source.slice(
            source.indexOf('fallback() external payable'),
            source.indexOf('// 升级函数')
        );

        expect(fallbackBody).to.include('delegatecall(gas(), sload(0), 0, calldatasize(), 0, 0)');
        expect(fallbackBody).to.include('returndatacopy(0, 0, returndatasize())');
        expect(fallbackBody).to.include('revert(0, returndatasize())');
        expect(fallbackBody).to.include('return(0, returndatasize())');
    });
});

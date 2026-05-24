import { expect } from 'chai';
import { readFileSync } from 'fs';
import path from 'path';

describe('33 Airdrop source regressions', () => {
    const source = readFileSync(path.join(__dirname, '..', '33_Airdrop', 'Airdrop.sol'), 'utf8');

    it('allows exact ERC20 approval for the total airdrop amount', () => {
        expect(source).to.include('token.allowance(msg.sender, address(this)) >= _amountSum');
        expect(source).to.not.include('token.allowance(msg.sender, address(this)) > _amountSum');
    });

    it('does not use the 2300 gas stipend transfer for ETH airdrops', () => {
        expect(source).to.include('.call{value: _amounts[i]}("")');
        expect(source).to.not.include('.transfer(_amounts[i])');
    });
});

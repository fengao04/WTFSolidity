import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('33 Airdrop regression', () => {
    const source = readFileSync(join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8');

    it('allows exact ERC20 allowance for token airdrops', () => {
        const compactSource = source.replace(/\s+/g, ' ');

        expect(compactSource).to.include(
            'require(token.allowance(msg.sender, address(this)) >= _amountSum, "Need Approve ERC20 token");'
        );
        expect(compactSource).not.to.include('token.allowance(msg.sender, address(this)) > _amountSum');
    });
});

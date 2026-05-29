import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('33 Airdrop source regression', () => {
    it('accepts exact ERC20 allowance for multiTransferToken', () => {
        const source = readFileSync(join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8');

        expect(source).to.include('token.allowance(msg.sender, address(this)) >= _amountSum');
        expect(source).not.to.include('token.allowance(msg.sender, address(this)) > _amountSum');
    });
});

import fs from 'fs';
import path from 'path';
import { expect } from 'chai';

describe('33 Airdrop source regression', () => {
    it('allows exact ERC20 allowance for multiTransferToken', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', '33_Airdrop', 'Airdrop.sol'), 'utf8');

        expect(source).to.include('token.allowance(msg.sender, address(this)) >= _amountSum');
        expect(source).not.to.include('token.allowance(msg.sender, address(this)) > _amountSum');
    });
});

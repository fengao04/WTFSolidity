import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

describe('33 Airdrop source regression checks', () => {
    const source = fs.readFileSync(path.join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8');

    it('allows an ERC20 allowance equal to the full airdrop amount', () => {
        expect(source).to.include('token.allowance(msg.sender, address(this)) >= _amountSum');
        expect(source).to.not.include('token.allowance(msg.sender, address(this)) > _amountSum');
    });

    it('uses call for ETH airdrops so contract recipients get more than the transfer stipend', () => {
        expect(source).to.include('_addresses[i].call{value: _amounts[i]}("");');
        expect(source).to.not.include('_addresses[i].transfer(_amounts[i]);');
    });
});

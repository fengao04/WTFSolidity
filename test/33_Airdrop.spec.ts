import { expect } from 'chai';
import { readFileSync } from 'fs';
import path from 'path';

describe('33 Airdrop source regression', () => {
    it('allows exact ERC20 allowance for token airdrops', () => {
        const source = readFileSync(path.join(__dirname, '..', '33_Airdrop', 'Airdrop.sol'), 'utf8');

        expect(source).to.match(
            /allowance\(msg\.sender,\s*address\(this\)\)\s*>=\s*_amountSum/
        );
        expect(source).not.to.match(
            /allowance\(msg\.sender,\s*address\(this\)\)\s*>\s*_amountSum/
        );
    });
});

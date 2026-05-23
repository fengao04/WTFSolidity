import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

describe('33 Airdrop source regression', () => {
    it('allows ERC20 airdrops with exact token allowance', () => {
        const source = fs.readFileSync(path.join(__dirname, '../33_Airdrop/Airdrop.sol'), 'utf8');

        expect(source).to.match(
            /token\.allowance\(msg\.sender,\s*address\(this\)\)\s*>=\s*_amountSum/
        );
    });
});

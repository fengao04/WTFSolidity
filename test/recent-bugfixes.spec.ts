import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(__dirname, '..');

function readSource(relativePath: string) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('recent critical bug fixes', () => {
    it('allows ERC20 airdrops approved for exactly the transfer total', () => {
        const source = readSource('33_Airdrop/Airdrop.sol');

        expect(source).to.include(
            'require(token.allowance(msg.sender, address(this)) >= _amountSum'
        );
        expect(source).to.not.include(
            'require(token.allowance(msg.sender, address(this)) > _amountSum'
        );
    });

    it('bubbles SimpleUpgrade delegatecall failures and return data', () => {
        const source = readSource('47_Upgrade/Upgrade.sol');

        expect(source).to.include('fallback() external payable {\n        _delegate();\n    }');
        expect(source).to.include('let result := delegatecall');
        expect(source).to.include('revert(0, returndatasize())');
        expect(source).to.include('return(0, returndatasize())');
        expect(source).to.include('require(_implementation.code.length > 0, "Invalid implementation")');
        expect(source).to.include('require(newImplementation.code.length > 0, "Invalid implementation")');
    });
});

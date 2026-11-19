const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

test('Solidity subscription contract compiles with solc 0.8.24', () => {
  const source = fs.readFileSync(path.join(__dirname, '../contracts/BirdSubscription.sol'), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'BirdSubscription.sol': { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } }
  })));
  assert.equal((output.errors || []).filter(e => e.severity === 'error').length, 0);
  const artifact = output.contracts['BirdSubscription.sol'].BirdSubscription;
  assert.ok(artifact.abi.some(x => x.name === 'subscribe'));
  assert.ok(artifact.abi.some(x => x.name === 'isActive'));
  assert.ok(artifact.evm.bytecode.object.length > 100);
});

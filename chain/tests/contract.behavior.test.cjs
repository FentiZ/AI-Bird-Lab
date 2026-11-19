const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const hre = require('hardhat');
const { ethers } = require('ethers');

const source = fs.readFileSync(path.join(__dirname, '../contracts/BirdSubscription.sol'), 'utf8');
const compilation = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources: { 'BirdSubscription.sol': { content: source } },
  settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } }
})));
const errors = (compilation.errors || []).filter(e => e.severity === 'error');
if (errors.length) throw Error(errors.map(e => e.formattedMessage).join('\n'));
const artifact = compilation.contracts['BirdSubscription.sol'].BirdSubscription;
const price = ethers.parseEther('0.001');

async function deploy() {
  const provider = new ethers.BrowserProvider(hre.network.provider);
  const owner = await provider.getSigner(0);
  const subscriber = await provider.getSigner(1);
  const outsider = await provider.getSigner(2);
  const contract = await new ethers.ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, owner).deploy(price);
  await contract.waitForDeployment();
  return { provider, owner, subscriber, outsider, contract };
}

test('Solidity: price, permissions, subscription and renewal', async t => {
  await t.test('requires positive subscription price', async () => {
    const provider = new ethers.BrowserProvider(hre.network.provider);
    const signer = await provider.getSigner(0);
    const factory = new ethers.ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, signer);
    await assert.rejects(() => factory.deploy(0));
  });

  await t.test('subscription starts inactive and rejects wrong payment', async () => {
    const { contract, subscriber } = await deploy();
    assert.equal(await contract.isActive(await subscriber.getAddress()), false);
    await assert.rejects(() => contract.connect(subscriber).subscribe({ value: price - 1n }));
  });

  await t.test('payment activates 30 days and renewal extends expiry', async () => {
    const { contract, subscriber } = await deploy();
    const address = await subscriber.getAddress();
    await (await contract.connect(subscriber).subscribe({ value: price })).wait();
    assert.equal(await contract.isActive(address), true);
    const first = await contract.expiresAt(address);
    assert.equal(first > 0n, true);
    await (await contract.connect(subscriber).subscribe({ value: price })).wait();
    assert.equal(await contract.expiresAt(address), first + 30n * 24n * 60n * 60n);
  });

  await t.test('only owner can withdraw subscription funds', async () => {
    const { contract, subscriber, outsider, owner, provider } = await deploy();
    await (await contract.connect(subscriber).subscribe({ value: price })).wait();
    assert.equal(await provider.getBalance(await contract.getAddress()), price);
    await assert.rejects(() => contract.connect(outsider).withdraw());
    await (await contract.connect(owner).withdraw()).wait();
    assert.equal(await provider.getBalance(await contract.getAddress()), 0n);
  });
});

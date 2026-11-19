const assert = require('node:assert/strict');
const hre = require('hardhat');
const { ethers } = require('ethers');

const PRICE = ethers.parseEther('0.001');
const DURATION = 30n * 24n * 60n * 60n;

async function deploy(price = PRICE) {
  const artifact = await hre.artifacts.readArtifact('BirdSubscription');
  const provider = new ethers.BrowserProvider(hre.network.provider);
  const owner = await provider.getSigner(0);
  const alice = await provider.getSigner(1);
  const bob = await provider.getSigner(2);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner);
  const contract = await factory.deploy(price);
  await contract.waitForDeployment();
  return { contract, provider, owner, alice, bob };
}

describe('BirdSubscription Solidity coverage (local in-memory Hardhat)', function () {
  it('sets deployer as owner, correct price and 30-day duration', async function () {
    const { contract, owner, alice } = await deploy();
    assert.equal(await contract.owner(), await owner.getAddress());
    assert.equal(await contract.price(), PRICE);
    assert.equal(await contract.DURATION(), DURATION);
    assert.equal(await contract.isActive(await alice.getAddress()), false);
    assert.equal(await contract.expiresAt(await alice.getAddress()), 0n);
  });

  it('rejects deploying a zero-cost subscription', async function () {
    const artifact = await hre.artifacts.readArtifact('BirdSubscription');
    const provider = new ethers.BrowserProvider(hre.network.provider);
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(0));
    await assert.rejects(() => factory.deploy(0));
  });

  it('rejects underpayment and overpayment; subscription remains inactive', async function () {
    const { contract, alice } = await deploy();
    await assert.rejects(() => contract.connect(alice).subscribe({ value: PRICE - 1n }));
    await assert.rejects(() => contract.connect(alice).subscribe({ value: PRICE + 1n }));
    assert.equal(await contract.expiresAt(await alice.getAddress()), 0n);
  });

  it('accepts exact amount, emits event, and activates only sender', async function () {
    const { contract, alice, bob } = await deploy();
    const tx = await contract.connect(alice).subscribe({ value: PRICE });
    const receipt = await tx.wait();
    assert.equal(await contract.isActive(await alice.getAddress()), true);
    assert.equal(await contract.isActive(await bob.getAddress()), false);
    assert.equal(await contract.expiresAt(await alice.getAddress()) > 0n, true);
    assert.equal(await contract.runner.provider.getBalance(await contract.getAddress()), PRICE);
    const events = receipt.logs.map(log => { try { return contract.interface.parseLog(log); } catch { return null; } }).filter(Boolean);
    assert.equal(events[0].name, 'Subscribed');
    assert.equal(events[0].args[0].toLowerCase(), (await alice.getAddress()).toLowerCase());
    assert.equal(events[0].args[1], await contract.expiresAt(await alice.getAddress()));
  });

  it('extends from existing expiry when renewed early', async function () {
    const { contract, alice } = await deploy();
    await (await contract.connect(alice).subscribe({ value: PRICE })).wait();
    const firstExpiry = await contract.expiresAt(await alice.getAddress());
    await (await contract.connect(alice).subscribe({ value: PRICE })).wait();
    assert.equal(await contract.expiresAt(await alice.getAddress()), firstExpiry + DURATION);
  });

  it('renews from current block time after old subscription expired', async function () {
    const { contract, alice } = await deploy();
    await (await contract.connect(alice).subscribe({ value: PRICE })).wait();
    const first = await contract.expiresAt(await alice.getAddress());
    await hre.network.provider.send('evm_increaseTime', [Number(DURATION + 500n)]);
    await hre.network.provider.send('evm_mine');
    assert.equal(await contract.isActive(await alice.getAddress()), false);
    const tx = await contract.connect(alice).subscribe({ value: PRICE });
    const receipt = await tx.wait();
    const block = await hre.network.provider.send('eth_getBlockByNumber', ['0x' + receipt.blockNumber.toString(16), false]);
    assert.equal(await contract.expiresAt(await alice.getAddress()), BigInt(block.timestamp) + DURATION);
    assert.equal(await contract.expiresAt(await alice.getAddress()) > first, true);
  });

  it('only the owner may withdraw accumulated subscription payments', async function () {
    const { contract, alice, bob, owner, provider } = await deploy();
    await (await contract.connect(alice).subscribe({ value: PRICE })).wait();
    await (await contract.connect(bob).subscribe({ value: PRICE })).wait();
    assert.equal(await provider.getBalance(await contract.getAddress()), PRICE * 2n);
    await assert.rejects(() => contract.connect(alice).withdraw());
    assert.equal(await provider.getBalance(await contract.getAddress()), PRICE * 2n);
    await (await contract.connect(owner).withdraw()).wait();
    assert.equal(await provider.getBalance(await contract.getAddress()), 0n);
    // Empty contract balance can still be withdrawn by the owner.
    await (await contract.connect(owner).withdraw()).wait();
  });
});

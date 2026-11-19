const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const { createApp } = require('../server.cjs');

async function withServer(options, check) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('gateway health and blockchain contract metadata', async () => {
  await withServer({ readContract: () => ({ chainId: 31337, address: '0x1234' }) }, async base => {
    assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
    assert.equal((await (await fetch(base + '/info')).json()).chainId, 31337);
  });
});

test('missing deployed contract returns 503', async () => {
  await withServer({ readContract: () => { throw Error('not deployed'); } }, async base => {
    assert.equal((await fetch(base + '/info')).status, 503);
  });
});

test('valid signed challenge logs in only once', async () => {
  const wallet = ethers.Wallet.createRandom();
  await withServer({}, async base => {
    const challenge = await (await fetch(base + '/challenge')).json();
    const signature = await wallet.signMessage(challenge.message);
    const response = await post(base + '/verify', { nonce: challenge.nonce, signature });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).wallet, wallet.address.toLowerCase());
    assert.equal((await post(base + '/verify', { nonce: challenge.nonce, signature })).status, 401);
  });
});

test('incorrect signature does not work, even if retried', async () => {
  await withServer({}, async base => {
    const challenge = await (await fetch(base + '/challenge')).json();
    assert.equal((await post(base + '/verify', { nonce: challenge.nonce, signature: 'bad' })).status, 401);
    const signature = await ethers.Wallet.createRandom().signMessage(challenge.message);
    assert.equal((await post(base + '/verify', { nonce: challenge.nonce, signature })).status, 401);
  });
});

test('challenges expire after five minutes', async () => {
  let clock = 1000;
  await withServer({ now: () => clock }, async base => {
    const challenge = await (await fetch(base + '/challenge')).json();
    clock += 5 * 60 * 1000 + 1;
    const signature = await ethers.Wallet.createRandom().signMessage(challenge.message);
    assert.equal((await post(base + '/verify', { nonce: challenge.nonce, signature })).status, 401);
  });
});

test('subscription status validates wallet and uses blockchain result', async () => {
  const address = ethers.Wallet.createRandom().address;
  await withServer({ getStatus: async () => ({ active: true, expiresAt: 123456 }) }, async base => {
    assert.equal((await fetch(base + '/active/not-a-wallet')).status, 400);
    const response = await fetch(base + '/active/' + address);
    const status = await response.json();
    assert.equal(status.wallet, address.toLowerCase());
    assert.equal(status.active, true);
    assert.equal(status.expiresAt, 123456);
  });
});

test('blockchain error is returned as 503', async () => {
  const address = ethers.Wallet.createRandom().address;
  await withServer({ getStatus: async () => { throw Error('rpc down'); } }, async base => {
    assert.equal((await fetch(base + '/active/' + address)).status, 503);
  });
});

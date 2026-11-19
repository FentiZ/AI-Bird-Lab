const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Wallet } = require('ethers');
const { createApp } = require('../server.cjs');

async function withServer(options, check) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { return await check(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('challenge has unique secure nonces and tells user what they sign', async () => {
  let sequence = 0;
  await withServer({ randomBytes: () => Buffer.alloc(20, sequence++), now: () => 1000 }, async base => {
    const a = await (await fetch(base + '/challenge')).json();
    const b = await (await fetch(base + '/challenge')).json();
    assert.notEqual(a.nonce, b.nonce);
    assert.match(a.message, new RegExp(a.nonce));
    assert.match(a.message, /Only sign if/);
  });
});

test('missing fields and stale challenge are denied', async () => {
  let now = 100;
  await withServer({ now: () => now }, async base => {
    const c = await (await fetch(base + '/challenge')).json();
    assert.equal((await post(base + '/verify', { nonce: c.nonce })).status, 401);
    assert.equal((await post(base + '/verify', { signature: 'x' })).status, 401);
    now += 300000;
    const signature = await Wallet.createRandom().signMessage(c.message);
    assert.equal((await post(base + '/verify', { nonce: c.nonce, signature })).status, 401);
  });
});

test('invalid signature cannot be replayed even when a later valid signature is provided', async () => {
  await withServer({}, async base => {
    const c = await (await fetch(base + '/challenge')).json();
    assert.equal((await post(base + '/verify', { nonce: c.nonce, signature: 'bad' })).status, 401);
    const wallet = Wallet.createRandom();
    assert.equal((await post(base + '/verify', { nonce: c.nonce, signature: await wallet.signMessage(c.message) })).status, 401);
  });
});

test('expired challenges are swept when more than 5000 have accumulated', async () => {
  let id = 0;
  let now = 0;
  await withServer({ now: () => now, randomBytes: () => { const buffer = Buffer.alloc(20); buffer.writeUInt32BE(++id, 0); return buffer; } }, async base => {
    // Cycle nonce to exercise code path, not to test cryptographic randomness.
    for (let i = 0; i < 5001; i++) await fetch(base + '/challenge');
    now += 6 * 60 * 1000;
    const latest = await (await fetch(base + '/challenge')).json();
    assert.ok(latest.nonce);
  });
});

test('status includes inactive wallet and 0 expiry', async () => {
  const address = Wallet.createRandom().address;
  await withServer({ getStatus: async () => ({ active: false, expiresAt: 0 }) }, async base => {
    const response = await fetch(base + '/active/' + address);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { wallet: address.toLowerCase(), active: false, expiresAt: 0 });
  });
});

test('the real gateway RPC adapter reads active/expiry from a local mocked blockchain', async () => {
  const http = require('node:http');
  const { ethers } = require('ethers');
  const address = Wallet.createRandom().address;
  const iface = new ethers.Interface([
    'function isActive(address) view returns (bool)',
    'function expiresAt(address) view returns (uint256)'
  ]);
  const isActiveSelector = iface.getFunction('isActive').selector;
  const expirySelector = iface.getFunction('expiresAt').selector;
  const rpc = http.createServer((req, res) => {
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      const answer = item => {
        let result;
        if (item.method === 'eth_chainId') result = '0x7a69';
        else if (item.method === 'eth_blockNumber') result = '0x1';
        else if (item.method === 'net_version') result = '31337';
        else if (item.method === 'eth_call') {
          const selector = item.params[0].data.slice(0, 10);
          result = selector === isActiveSelector ? ethers.zeroPadValue('0x01', 32)
            : selector === expirySelector ? ethers.toBeHex(987654, 32) : '0x';
        } else result = null;
        return { jsonrpc: '2.0', id: item.id, result };
      };
      const payload = JSON.parse(text);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(payload) ? payload.map(answer) : answer(payload)));
    });
  });
  await new Promise(resolve => rpc.listen(0, '127.0.0.1', resolve));
  const previous = process.env.CHAIN_RPC;
  process.env.CHAIN_RPC = `http://127.0.0.1:${rpc.address().port}`;
  try {
    await withServer({ readContract: () => ({ address: '0x0000000000000000000000000000000000001234' }) }, async base => {
      const response = await fetch(`${base}/active/${address}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.active, true);
      assert.equal(body.expiresAt, 987654);
    });
  } finally {
    if (previous === undefined) delete process.env.CHAIN_RPC;
    else process.env.CHAIN_RPC = previous;
    await new Promise(resolve => rpc.close(resolve));
  }
});

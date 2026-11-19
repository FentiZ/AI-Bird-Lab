const express = require('express');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { ethers } = require('ethers');

// Factories allow tests to exercise routes without a blockchain or external server.
function createApp(options = {}) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  const challenges = new Map();
  const now = options.now || (() => Date.now());
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const readContract = options.readContract || (() => JSON.parse(fs.readFileSync('/shared/contract.json', 'utf8')));
  const getStatus = options.getStatus || (async address => {
    const provider = new ethers.JsonRpcProvider(process.env.CHAIN_RPC || 'http://chain:8545');
    const data = readContract();
    const contract = new ethers.Contract(data.address,
      ['function isActive(address) view returns (bool)', 'function expiresAt(address) view returns (uint256)'], provider);
    const [active, expiry] = await Promise.all([contract.isActive(address), contract.expiresAt(address)]);
    return { active, expiresAt: Number(expiry) };
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/info', (_req, res) => {
    try { res.json(readContract()); } catch { res.status(503).json({ error: 'Contract not deployed' }); }
  });

  app.get('/challenge', (_req, res) => {
    const nonce = randomBytes(20).toString('hex');
    const message = `AI Bird Lab local login\nNonce: ${nonce}\nOnly sign if you requested login.`;
    challenges.set(nonce, { message, expires: now() + 5 * 60 * 1000 });
    if (challenges.size > 5000) {
      for (const [id, value] of challenges) if (now() > value.expires) challenges.delete(id);
    }
    res.json({ nonce, message });
  });

  app.post('/verify', (req, res) => {
    const { nonce, signature } = req.body || {};
    const challenge = typeof nonce === 'string' ? challenges.get(nonce) : null;
    if (!challenge || challenge.expires <= now() || typeof signature !== 'string') {
      return res.status(401).json({ error: 'Challenge expired or missing' });
    }
    challenges.delete(nonce);
    try {
      const wallet = ethers.verifyMessage(challenge.message, signature);
      res.json({ wallet: wallet.toLowerCase() });
    } catch { res.status(401).json({ error: 'Invalid wallet signature' }); }
  });

  app.get('/active/:address', async (req, res) => {
    if (!ethers.isAddress(req.params.address)) return res.status(400).json({ error: 'Invalid wallet address' });
    try {
      const status = await getStatus(req.params.address);
      res.json({ wallet: req.params.address.toLowerCase(), active: status.active,
        expiresAt: Number(status.expiresAt) });
    } catch (error) {
      console.error('Chain RPC failed:', error.message);
      res.status(503).json({ error: 'Blockchain unavailable' });
    }
  });

  return app;
}

if (require.main === module) {
  createApp().listen(3001, '0.0.0.0', () => console.log('Chain gateway on port 3001'));
}
module.exports = { createApp };

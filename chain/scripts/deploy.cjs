const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const { ethers } = require('ethers');

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../contracts/BirdSubscription.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'BirdSubscription.sol': { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(x => x.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const contract = output.contracts['BirdSubscription.sol'].BirdSubscription;
  const provider = new ethers.JsonRpcProvider(process.env.CHAIN_RPC || 'http://chain:8545');
  const privateKey = process.env.DEPLOY_PRIVATE_KEY;
  if (!privateKey) throw new Error('DEPLOY_PRIVATE_KEY is required (local test key only)');
  const wallet = new ethers.Wallet(privateKey, provider);
  const factory = new ethers.ContractFactory(contract.abi, '0x' + contract.evm.bytecode.object, wallet);
  const instance = await factory.deploy(ethers.parseEther('0.001'));
  await instance.waitForDeployment();
  const address = await instance.getAddress();
  const info = { address, chainId: 31337, priceWei: ethers.parseEther('0.001').toString(), rpcUrl: 'http://127.0.0.1:8545' };
  fs.mkdirSync('/shared', { recursive: true });
  fs.writeFileSync('/shared/contract.json', JSON.stringify(info, null, 2));
  console.log('BirdSubscription deployed:', address);
}
main().catch(e => { console.error(e); process.exit(1); });

import { BrowserProvider, Contract } from 'ethers';
import { api, saveToken, type ContractInfo } from './api';

type WalletWindow = Window & { ethereum?: any };

async function providerFor(chain: ContractInfo) {
  const ethereum = (window as WalletWindow).ethereum;
  if (!ethereum) throw new Error('Потрібен MetaMask у браузері.');
  const hexChain = '0x' + chain.chainId.toString(16);
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;
    await ethereum.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: hexChain, chainName: 'BirdLab Hardhat LOCAL', rpcUrls: [chain.rpcUrl],
      nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 }
    }] });
  }
  return new BrowserProvider(ethereum);
}

export async function signIn(): Promise<string> {
  const chain = await api.chain();
  const provider = await providerFor(chain);
  await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();
  const challenge = await api.challenge();
  const signature = await signer.signMessage(challenge.message);
  const login = await api.verify(challenge.nonce, signature);
  if (login.wallet !== (await signer.getAddress()).toLowerCase()) throw new Error('Wallet mismatch');
  saveToken(login.token);
  return login.wallet;
}

export async function buySubscription() {
  const chain = await api.chain();
  const provider = await providerFor(chain);
  const signer = await provider.getSigner();
  const login = await api.me();
  if ((await signer.getAddress()).toLowerCase() !== login.wallet) {
    throw new Error('У MetaMask обрано інший акаунт. Знову підключіть гаманець для входу.');
  }
  const contract = new Contract(chain.address, ['function subscribe() payable'], signer);
  const tx = await contract.subscribe({ value: BigInt(chain.priceWei) });
  await tx.wait();
}

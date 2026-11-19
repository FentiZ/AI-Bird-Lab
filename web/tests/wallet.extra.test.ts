import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ chain: vi.fn(), me: vi.fn(), challenge: vi.fn(), verify: vi.fn(),
  saveToken: vi.fn(), BrowserProvider: vi.fn(), Contract: vi.fn() }));
vi.mock('../src/api', () => ({ api: mock, saveToken: mock.saveToken }));
vi.mock('ethers', () => ({ BrowserProvider: mock.BrowserProvider, Contract: mock.Contract }));
import { signIn, buySubscription } from '../src/wallet';
const user = '0x0123456789abcdef0123456789abcdef01234567';
const config = { chainId: 31337, address: '0x0000000000000000000000000000000000000123', rpcUrl: 'http://localhost:8545', priceWei: '1000000000000000' };
let request: ReturnType<typeof vi.fn>;
let signer: { getAddress: ReturnType<typeof vi.fn>; signMessage: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.resetAllMocks();
  request = vi.fn().mockResolvedValue(null);
  Object.defineProperty(window, 'ethereum', { configurable: true, value: { request } });
  signer = { getAddress: vi.fn().mockResolvedValue(user), signMessage: vi.fn().mockResolvedValue('sig') };
  mock.BrowserProvider.mockImplementation(() => ({ send: vi.fn(), getSigner: vi.fn().mockResolvedValue(signer) }));
  mock.chain.mockResolvedValue(config);
  mock.challenge.mockResolvedValue({ nonce: 'a', message: 'sign now' });
  mock.verify.mockResolvedValue({ wallet: user, token: 'jwt' });
  mock.me.mockResolvedValue({ wallet: user });
});

it('adds Hardhat network if MetaMask reports unknown chain (4902)', async () => {
  request.mockRejectedValueOnce({ code: 4902 });
  await signIn();
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_addEthereumChain',
    params: [expect.objectContaining({ chainId: '0x7a69', rpcUrls: ['http://localhost:8545'] })] }));
});

it('does not suppress a real MetaMask failure while switching networks', async () => {
  request.mockRejectedValueOnce({ code: 4001 });
  await expect(signIn()).rejects.toEqual({ code: 4001 });
  expect(mock.verify).not.toHaveBeenCalled();
});

it('rejects subscription when MetaMask is missing', async () => {
  Object.defineProperty(window, 'ethereum', { configurable: true, value: undefined });
  await expect(buySubscription()).rejects.toThrow('MetaMask');
});

it('does not save a token when the wallet signature fails', async () => {
  signer.signMessage.mockRejectedValueOnce(new Error('Rejected'));
  await expect(signIn()).rejects.toThrow('Rejected');
  expect(mock.saveToken).not.toHaveBeenCalled();
});

it('does not start payment if API subscription check fails', async () => {
  mock.me.mockRejectedValueOnce(new Error('Unauthorized'));
  await expect(buySubscription()).rejects.toThrow('Unauthorized');
  expect(mock.Contract).not.toHaveBeenCalled();
});

it('propagates rejected transaction confirmation', async () => {
  mock.Contract.mockImplementation(() => ({ subscribe: vi.fn().mockResolvedValue({ wait: vi.fn().mockRejectedValue(new Error('Reverted')) }) }));
  await expect(buySubscription()).rejects.toThrow('Reverted');
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chain: vi.fn(), challenge: vi.fn(), verify: vi.fn(), me: vi.fn(),
  saveToken: vi.fn(), BrowserProvider: vi.fn(), Contract: vi.fn()
}));
vi.mock('../src/api', () => ({ api: mocks, saveToken: mocks.saveToken }));
vi.mock('ethers', () => ({ BrowserProvider: mocks.BrowserProvider, Contract: mocks.Contract }));
import { signIn, buySubscription } from '../src/wallet';

const chain = { address: '0x0000000000000000000000000000000000001234', chainId: 31337,
  priceWei: '1000000000000000', rpcUrl: 'http://127.0.0.1:8545' };
const wallet = '0x0123456789abcdef0123456789abcdef01234567';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.chain.mockResolvedValue(chain);
  mocks.challenge.mockResolvedValue({ nonce: 'nonce', message: 'sign test' });
  mocks.verify.mockResolvedValue({ wallet, token: 'issued-token' });
  mocks.me.mockResolvedValue({ wallet, active: false });
  Object.defineProperty(window, 'ethereum', { configurable: true, value: { request: vi.fn().mockResolvedValue(null) } });
  mocks.BrowserProvider.mockImplementation(() => ({
    send: vi.fn(),
    getSigner: vi.fn().mockResolvedValue({
      getAddress: vi.fn().mockResolvedValue(wallet),
      signMessage: vi.fn().mockResolvedValue('signed')
    })
  }));
});

describe('MetaMask wallet flow', () => {
  it('requires MetaMask', async () => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: undefined });
    await expect(signIn()).rejects.toThrow('MetaMask');
  });
  it('signs one-time challenge and stores returned token', async () => {
    expect(await signIn()).toBe(wallet);
    expect(mocks.verify).toHaveBeenCalledWith('nonce', 'signed');
    expect(mocks.saveToken).toHaveBeenCalledWith('issued-token');
  });
  it('rejects login when backend wallet differs', async () => {
    mocks.verify.mockResolvedValueOnce({ wallet: '0x0000000000000000000000000000000000000000', token: 'fake' });
    await expect(signIn()).rejects.toThrow('Wallet mismatch');
    expect(mocks.saveToken).not.toHaveBeenCalled();
  });
  it('prevents subscribing with a different MetaMask account', async () => {
    mocks.me.mockResolvedValue({ wallet: '0x0000000000000000000000000000000000000000' });
    await expect(buySubscription()).rejects.toThrow('інший акаунт');
    expect(mocks.Contract).not.toHaveBeenCalled();
  });
  it('sends exact wei price and waits for confirmation', async () => {
    const wait = vi.fn().mockResolvedValue(null);
    const subscribe = vi.fn().mockResolvedValue({ wait });
    mocks.Contract.mockImplementation(() => ({ subscribe }));
    await buySubscription();
    expect(subscribe).toHaveBeenCalledWith({ value: 1000000000000000n });
    expect(wait).toHaveBeenCalled();
  });
});

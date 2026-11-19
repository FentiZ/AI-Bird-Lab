import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  chain: vi.fn(), birds: vi.fn(), me: vi.fn(), analyses: vi.fn(), stats: vi.fn(),
  analyze: vi.fn(), image: vi.fn(), delete: vi.fn(), export: vi.fn(),
  getToken: vi.fn(), clearToken: vi.fn(), signIn: vi.fn(), buySubscription: vi.fn()
}));
vi.mock('../src/api', () => ({ api: mocks, getToken: mocks.getToken, clearToken: mocks.clearToken }));
vi.mock('../src/wallet', () => ({ signIn: mocks.signIn, buySubscription: mocks.buySubscription }));
import App from '../src/App';

const sampleBird = {
  english_name: 'Robin', ukrainian_name: 'Вільшанка', scientific_name: 'Erithacus rubecula',
  description_uk: 'Маленький птах', source_url: 'https://example.test/robin'
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getToken.mockReturnValue('');
  mocks.chain.mockResolvedValue({ address: '0x1234567890123456789012345678901234567890', priceWei: '1000000000000000', chainId: 31337 });
  mocks.birds.mockResolvedValue([sampleBird]);
  mocks.analyses.mockResolvedValue([]);
  mocks.stats.mockResolvedValue({ total: 0, queued: 0, species: [], highest: null, lowest: null });
});
afterEach(() => cleanup());

it('renders dashboard and requires subscription before photo upload', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Підключити гаманець' })).toBeTruthy();
  const upload = screen.getByRole('button', { name: 'Надіслати на AI-аналіз' }) as HTMLButtonElement;
  expect(upload.disabled).toBe(true);
});

it('shows catalog loaded from API', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '📚 Птахи' }));
  expect(await screen.findByText('Вільшанка')).toBeTruthy();
  expect(screen.getByText('Erithacus rubecula')).toBeTruthy();
});

it('switches to statistics and handles empty results', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '📊 Статистика' }));
  expect(await screen.findByText('Завершені аналізи')).toBeTruthy();
  expect(screen.getByText(/Найчастіші види/)).toBeTruthy();
});

it('shows a clear message when blockchain service cannot be reached', async () => {
  mocks.chain.mockRejectedValueOnce(new Error('Gateway unavailable'));
  render(<App />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Gateway unavailable'));
});

it('allows subscribed user to queue an image', async () => {
  mocks.signIn.mockImplementation(async () => { mocks.getToken.mockReturnValue('signed-token'); return '0xuser'; });
  mocks.me.mockResolvedValue({ wallet: '0x0123456789abcdef0123456789abcdef01234567', active: true, expiresAt: 1900000000 });
  mocks.analyze.mockResolvedValue({ status: 'queued' });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Підключити гаманець' }));
  await waitFor(() => expect(mocks.signIn).toHaveBeenCalled());
  const button = await screen.findByRole('button', { name: 'Надіслати на AI-аналіз' });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['photo'], 'robin.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
});


it('shows non-bird result without inventing bird species', async () => {
  mocks.signIn.mockImplementation(async () => { mocks.getToken.mockReturnValue('signed-token'); });
  mocks.me.mockResolvedValue({ wallet: '0x0123456789abcdef0123456789abcdef01234567', active: true, expiresAt: 1900000000 });
  mocks.analyses.mockResolvedValue([{ id: 5, status: 'not_bird', imageName: 'cat.jpg',
    error: 'На фото не виявлено птаха.', predictedSpecies: '', confidence: 0,
    analysisDate: '2026-11-16T10:00:00Z', birdInfo: null, top3: [] }]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Підключити гаманець' }));
  await waitFor(() => expect(mocks.me).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '🕘 Історія' }));
  expect(await screen.findByText('На фото не виявлено птаха.')).toBeTruthy();
  expect(screen.getByText(/Це не птах/)).toBeTruthy();
});

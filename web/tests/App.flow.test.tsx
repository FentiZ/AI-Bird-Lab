import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  chain: vi.fn(), birds: vi.fn(), me: vi.fn(), analyses: vi.fn(), stats: vi.fn(),
  analyze: vi.fn(), image: vi.fn(), delete: vi.fn(), export: vi.fn(),
  getToken: vi.fn(), clearToken: vi.fn(), signIn: vi.fn(), buySubscription: vi.fn(),
}));
vi.mock('../src/api', () => ({ api: m, getToken: m.getToken, clearToken: m.clearToken }));
vi.mock('../src/wallet', () => ({ signIn: m.signIn, buySubscription: m.buySubscription }));
import App from '../src/App';

const user = { wallet: '0x0123456789abcdef0123456789abcdef01234567', active: true, expiresAt: 1900000000 };
const bird = { english_name: 'Robin', ukrainian_name: 'Вільшанка', scientific_name: 'Erithacus rubecula',
  description_uk: 'Відомий птах', family: 'Muscicapidae', diet_uk: 'Комахи', conservation: 'LC', source_url: 'https://bird.test' };
const done = { id: 10, imageName: 'robin.jpg', status: 'done', predictedSpecies: 'Robin', confidence: 95.55,
  error: '', analysisDate: '2026-10-18T12:00:00Z', birdInfo: bird, top3: [
    { species: 'Robin', confidence: 95.55 }, { species: 'Owl', confidence: 3.1 }
  ] };

beforeEach(() => {
  vi.resetAllMocks();
  m.getToken.mockReturnValue('bearer-token');
  m.chain.mockResolvedValue({ chainId: 31337, address: '0x1234567890123456789012345678901234567890', priceWei: '1000000000000000' });
  m.birds.mockResolvedValue([bird]);
  m.me.mockResolvedValue(user);
  m.analyses.mockResolvedValue([done]);
  m.stats.mockResolvedValue({ total: 1, queued: 0, species: [{ species: 'Robin', count: 1 }], highest: done, lowest: done });
  m.image.mockResolvedValue(new Blob(['photo'], { type: 'image/jpeg' }));
  m.analyze.mockResolvedValue({ status: 'queued' });
  m.delete.mockResolvedValue({});
  m.export.mockResolvedValue(null);
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('restores saved session and renders successful recognition with bird details', async () => {
  render(<App />);
  expect(await screen.findByText(/Активна до/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '🕘 Історія' }));
  expect(await screen.findByText('Упевненість: 95.55%')).toBeTruthy();
  expect(screen.getByText('Відомий птах')).toBeTruthy();
  expect(screen.getByText('Muscicapidae', { exact: false })).toBeTruthy();
  expect(await screen.findByAltText('Bird photo')).toBeTruthy();
});

it('shows queued, failed and unknown species details without invented facts', async () => {
  m.analyses.mockResolvedValue([
    { ...done, id: 11, status: 'queued', predictedSpecies: '', imageName: 'wait.jpg' },
    { ...done, id: 12, status: 'failed', error: 'Service failed', predictedSpecies: '' },
    { ...done, id: 13, birdInfo: null, predictedSpecies: 'Unknown Bird' },
  ]);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '🕘 Історія' }));
  expect(await screen.findByText(/У черзі/)).toBeTruthy();
  expect(screen.getByText('Service failed')).toBeTruthy();
  expect(screen.getByText(/Факти не генеруються/)).toBeTruthy();
});

it('restores gracefully when the stored session is expired', async () => {
  m.me.mockRejectedValueOnce(new Error('JWT expired'));
  render(<App />);
  await waitFor(() => expect(m.me).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: 'Підключити гаманець' })).toBeTruthy();
  expect(screen.queryByText(/Активна до/)).toBeNull();
});

it('shows authentication failure message without granting access', async () => {
  m.getToken.mockReturnValue('');
  m.signIn.mockRejectedValueOnce(new Error('User rejected signature'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Підключити гаманець' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('User rejected signature'));
  expect((screen.getByRole('button', { name: 'Надіслати на AI-аналіз' }) as HTMLButtonElement).disabled).toBe(true);
});

it('processes wallet subscription success, refresh and token clipboard', async () => {
  render(<App />);
  const pay = await screen.findByRole('button', { name: /Оплатити 0.001 test ETH/ });
  fireEvent.click(pay);
  await waitFor(() => expect(m.buySubscription).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('Підписка активна!')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Оновити статус' }));
  await waitFor(() => expect(m.me.mock.calls.length).toBeGreaterThanOrEqual(2));
  fireEvent.click(screen.getByRole('button', { name: 'Скопіювати токен для Expo Go' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('bearer-token'));
});

it('handles a rejected subscription transaction', async () => {
  m.buySubscription.mockRejectedValueOnce(new Error('Transaction rejected'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Оплатити/ }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Transaction rejected'));
});

it('refuses invalid extension and mismatched media type before upload', async () => {
  render(<App />);
  await screen.findByRole('button', { name: /Оплатити/ });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [
    new File(['no'], 'video.mp4', { type: 'video/mp4' }),
    new File(['no'], 'fake.jpg', { type: 'image/png' }),
  ] } });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Відхилено:'));
  expect((screen.getByRole('button', { name: 'Надіслати на AI-аналіз' }) as HTMLButtonElement).disabled).toBe(true);
  expect(m.analyze).not.toHaveBeenCalled();
});

it('submits two images, reports per-photo errors and navigates to history', async () => {
  m.analyze.mockResolvedValueOnce({ status: 'queued' }).mockRejectedValueOnce(new Error('API down'));
  render(<App />);
  await screen.findByRole('button', { name: /Оплатити/ });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['a'], 'one.jpg', { type: 'image/jpeg' }), new File(['b'], 'two.png', { type: 'image/png' })] }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати на AI-аналіз' }));
  await waitFor(() => expect(m.analyze).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/У черзі 1 з 2 фото/)).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('two.png');
  expect(await screen.findByText('Історія (1)')).toBeTruthy();
});

it('searches history, can cancel deletion, or delete after confirmation', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '🕘 Історія' }));
  const search = await screen.findByPlaceholderText('Пошук за назвою виду або фото');
  fireEvent.change(search, { target: { value: 'Robin' } });
  await waitFor(() => expect(m.analyses).toHaveBeenCalledWith('Robin'));
  vi.mocked(window.confirm).mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));
  expect(m.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));
  await waitFor(() => expect(m.delete).toHaveBeenCalledWith(10));
});

it('reports deletion and CSV errors clearly', async () => {
  m.delete.mockRejectedValueOnce(new Error('Delete unavailable'));
  m.export.mockRejectedValueOnce(new Error('CSV unavailable'));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '🕘 Історія' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Видалити' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Delete unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Експорт CSV' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('CSV unavailable'));
  fireEvent.click(screen.getByRole('button', { name: '×' }));
  expect(screen.queryByRole('status')).toBeNull();
});

it('shows real statistic values and logs out cleanly', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '📊 Статистика' }));
  expect(await screen.findByText(/Robin — 1/)).toBeTruthy();
  expect(screen.getAllByText('95.5%').length).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Вийти' }));
  expect(m.clearToken).toHaveBeenCalled();
  expect(await screen.findByText('Сеанс завершено.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Підключити гаманець' })).toBeTruthy();
});

it('does not grant AI when connected wallet has inactive subscription', async () => {
  m.me.mockResolvedValue({ ...user, active: false, expiresAt: 0 });
  render(<App />);
  expect(await screen.findByText('⛔ Немає активної підписки')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Надіслати на AI-аналіз' }) as HTMLButtonElement).disabled).toBe(true);
});

it('does not show confidential images when protected download fails', async () => {
  m.image.mockRejectedValueOnce(new Error('401'));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '🕘 Історія' }));
  expect(await screen.findByText('Упевненість: 95.55%')).toBeTruthy();
  await waitFor(() => expect(m.image).toHaveBeenCalledWith(10));
  expect(screen.queryByAltText('Bird photo')).toBeNull();
});

it('revokes loaded private photo URL on navigation away from history', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '🕘 Історія' }));
  expect(await screen.findByAltText('Bird photo')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '📚 Птахи' }));
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo'));
});

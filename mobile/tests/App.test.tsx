import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({
  getItemAsync: vi.fn(), setItemAsync: vi.fn(),
  launchCameraAsync: vi.fn(), launchImageLibraryAsync: vi.fn(), alert: vi.fn(),
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: m.getItemAsync, setItemAsync: m.setItemAsync }));
vi.mock('expo-image-picker', () => ({ launchCameraAsync: m.launchCameraAsync, launchImageLibraryAsync: m.launchImageLibraryAsync }));
// These DOM substitutes test application behavior, NOT native appearance/OS permissions.
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  const generic = (tag: string) => ({ children, style, ...props }: any) => h(tag, {}, children);
  const button = ({ children, onPress, disabled }: any) => h('button', { onClick: onPress, disabled }, children);
  const input = ({ value, onChangeText, ...props }: any) => h('input', { value, onChange: (event: any) => onChangeText(event.target.value) });
  const image = ({ source }: any) => h('img', { src: source.uri, alt: 'Bird image' });
  return {
    ActivityIndicator: () => h('span', {}, 'Loading'),
    Alert: { alert: m.alert }, Image: image,
    SafeAreaView: generic('div'), ScrollView: generic('div'), StatusBar: () => null,
    StyleSheet: { create: (styles: any) => styles }, Text: generic('span'), TextInput: input,
    TouchableOpacity: button, View: generic('div')
  };
});
import App from '../App';

const user = { wallet: '0x0000000000000000000000000000000000000012', active: true, expiresAt: 1900000000 };
const done = { id: 2, status: 'done', imageName: 'bird.jpg', predictedSpecies: 'Robin', confidence: 91.5,
  error: '', analysisDate: '2026-10-10', birdInfo: { description_uk: 'Червоногруда пташка' }, top3: [{ species: 'Robin', confidence: 91.5 }] };
const reply = (data: any, status = 200) => ({ ok: status < 400, status, json: async () => data });
let http: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  m.getItemAsync.mockResolvedValue(null);
  m.setItemAsync.mockResolvedValue(undefined);
  http = vi.fn(async (url: string, init: any) => {
    if (url.endsWith('/auth/me')) return reply(user);
    if (url.endsWith('/analyses')) return init?.method === 'DELETE' ? reply(null, 204) : reply([done]);
    if (/\/analyses\/\d+$/.test(url) && init?.method === 'DELETE') return reply(null, 204);
    if (url.endsWith('/analyze')) return reply({ status: 'queued' }, 202);
    return reply({});
  });
  vi.stubGlobal('fetch', http);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function goSubscription() {
  fireEvent.click(screen.getByRole('button', { name: 'Підписка' }));
  return screen.findByRole('button', { name: 'Зберегти та підключитися' });
}
async function connect() {
  const button = await goSubscription();
  fireEvent.click(button);
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Готово', 'Підключено до AI Bird Lab'));
}

it('initial screen contains camera and gallery but disables AI without a subscription', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: '📷 Камера' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '🖼️ Галерея' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Надіслати на AI' }) as HTMLButtonElement).disabled).toBe(true);
});

it('restores saved URL and token from Expo SecureStore', async () => {
  m.getItemAsync.mockImplementation(async (key: string) => key === 'birdlab_url' ? 'http://192.168.1.9:5080' : 'saved-jwt');
  render(<App />);
  await goSubscription();
  await waitFor(() => expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('http://192.168.1.9:5080'));
  expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).value).toBe('saved-jwt');
});

it('stores connection securely and requests subscription plus history using JWT', async () => {
  render(<App />);
  const button = await goSubscription();
  const fields = screen.getAllByRole('textbox');
  fireEvent.change(fields[0], { target: { value: 'http://192.168.1.5:5080' } });
  fireEvent.change(fields[1], { target: { value: 'secret-jwt' } });
  fireEvent.click(button);
  await waitFor(() => expect(m.setItemAsync).toHaveBeenCalledWith('birdlab_token', 'secret-jwt'));
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Готово', 'Підключено до AI Bird Lab'));
  expect(http.mock.calls.some(([url, init]) => url.endsWith('/api/auth/me') && init.headers.Authorization === 'Bearer secret-jwt')).toBe(true);
  expect(screen.getByText(/Підписка: активна/)).toBeTruthy();
});

it('reports API connection errors in the subscription screen', async () => {
  http.mockRejectedValueOnce(new Error('Network unreachable'));
  render(<App />);
  const button = await goSubscription();
  fireEvent.click(button);
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Помилка', expect.stringContaining('Network unreachable')));
});

it('gallery permits photos, submits them to RabbitMQ and clears image afterward', async () => {
  m.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///robin.png', fileName: 'robin.png', mimeType: 'image/png' }] });
  render(<App />);
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Фото' }));
  fireEvent.click(screen.getByRole('button', { name: '🖼️ Галерея' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Надіслати на AI' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати на AI' }));
  await waitFor(() => expect(http.mock.calls.some(([url, init]) => url.endsWith('/api/analyze') && init.method === 'POST')).toBe(true));
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Успіх', expect.stringContaining('RabbitMQ')));
  expect(await screen.findByText('Історія (1)')).toBeTruthy();
});

it('camera rejects videos and damaged file types before sending', async () => {
  m.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///video.mp4', fileName: 'video.mp4', type: 'video' }] });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '📷 Камера' }));
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Фото', expect.stringContaining('фотографію')));
  expect(http).not.toHaveBeenCalled();
});

it('does not change selection when user cancels camera', async () => {
  m.launchCameraAsync.mockResolvedValue({ canceled: true, assets: [] });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '📷 Камера' }));
  await waitFor(() => expect(m.launchCameraAsync).toHaveBeenCalledWith({ mediaTypes: ['images'], quality: 0.8 }));
  expect(screen.getByText('Фото не вибрано')).toBeTruthy();
});

it('displays completed, failed and not-bird history records', async () => {
  http = vi.fn(async (url: string) => url.endsWith('/auth/me') ? reply(user) : reply([
    done, { ...done, id: 3, status: 'not_bird', imageName: 'cat.jpg', predictedSpecies: '', error: 'На фото немає птаха' },
    { ...done, id: 4, status: 'failed', imageName: 'bad.jpg', predictedSpecies: '', error: '' }
  ]));
  vi.stubGlobal('fetch', http);
  render(<App />);
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Історія' }));
  expect(await screen.findByText('Червоногруда пташка')).toBeTruthy();
  expect(screen.getByText('На фото немає птаха')).toBeTruthy();
  expect(screen.getByText('На фото не виявлено птаха.')).toBeTruthy();
});

it('deletes a record and refreshes the list', async () => {
  render(<App />);
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Історія' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Видалити' }));
  await waitFor(() => expect(http.mock.calls.some(([url, init]) => url.endsWith('/api/analyses/2') && init.method === 'DELETE')).toBe(true));
});

it('reports errors when deleting a result', async () => {
  http = vi.fn(async (url: string, init: any) => {
    if (init.method === 'DELETE') return reply({ error: 'Could not delete' }, 500);
    return url.endsWith('/auth/me') ? reply(user) : reply([done]);
  });
  vi.stubGlobal('fetch', http);
  render(<App />);
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Історія' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Видалити' }));
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Помилка', expect.stringContaining('Could not delete')));
});

it('refreshing subscription notifies user when API is unavailable', async () => {
  render(<App />);
  http.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Оновити підписку' }));
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Помилка', expect.stringContaining('offline')));
});

it('shows an empty history when the server has no analyses', async () => {
  http = vi.fn(async (url: string) => url.endsWith('/auth/me') ? reply(user) : reply([]));
  vi.stubGlobal('fetch', http);
  render(<App />);
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Історія' }));
  expect(await screen.findByText(/Даних немає/)).toBeTruthy();
});

it('does not allow AI requests on an inactive subscription', async () => {
  http = vi.fn(async (url: string) => url.endsWith('/auth/me') ? reply({ ...user, active: false }) : reply([]));
  vi.stubGlobal('fetch', http);
  m.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///bird.jpg', fileName: 'bird.jpg' }] });
  render(<App />);
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Фото' }));
  fireEvent.click(screen.getByRole('button', { name: '🖼️ Галерея' }));
  await waitFor(() => expect(m.launchImageLibraryAsync).toHaveBeenCalled());
  expect((screen.getByRole('button', { name: 'Надіслати на AI' }) as HTMLButtonElement).disabled).toBe(true);
  expect(http.mock.calls.some(([url]) => url.endsWith('/analyze'))).toBe(false);
});

it('keeps current photo on server analysis failure and shows alert', async () => {
  m.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///bird.jpg', fileName: 'bird.jpg', mimeType: 'image/jpeg' }] });
  http = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/me')) return reply(user);
    if (url.endsWith('/analyze')) return reply({ error: 'AI unavailable' }, 503);
    return reply([done]);
  });
  vi.stubGlobal('fetch', http);
  render(<App />);
  await connect();
  fireEvent.click(screen.getByRole('button', { name: 'Фото' }));
  fireEvent.click(screen.getByRole('button', { name: '🖼️ Галерея' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Надіслати на AI' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати на AI' }));
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Помилка аналізу', expect.stringContaining('AI unavailable')));
  expect(screen.getByRole('button', { name: 'Надіслати на AI' }).hasAttribute('disabled')).toBe(false);
});

it('notifies user on gallery permission or camera selection errors', async () => {
  m.launchImageLibraryAsync.mockRejectedValueOnce(new Error('Camera permission denied'));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '🖼️ Галерея' }));
  await waitFor(() => expect(m.alert).toHaveBeenCalledWith('Фото', expect.stringContaining('Camera permission denied')));
});

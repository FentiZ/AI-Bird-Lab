import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api, saveToken, clearToken } from '../src/api';
import { validatePhotoFile } from '../src/photo';

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());
const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

it('performs public challenge / verification without a bearer token', async () => {
  saveToken('private');
  vi.mocked(fetch).mockResolvedValue(ok({ token: 'new' }));
  await api.challenge();
  await api.verify('nonce', 'signature');
  const [url, init] = vi.mocked(fetch).mock.calls[1];
  expect(url).toBe('/api/auth/verify');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(init?.body as string)).toEqual({ nonce: 'nonce', signature: 'signature' });
  expect((init?.headers as Headers).has('Authorization')).toBe(false);
  expect((init?.headers as Headers).get('Content-Type')).toBe('application/json');
});

it('covers catalog, stats, current user and missing auth token', async () => {
  clearToken();
  vi.mocked(fetch).mockResolvedValue(ok([]));
  await api.birds(); await api.stats(); await api.me(); await api.analyses();
  expect(vi.mocked(fetch).mock.calls.map(x => x[0])).toEqual(['/api/birds', '/api/stats', '/api/auth/me', '/api/analyses?search=']);
  expect((vi.mocked(fetch).mock.calls[2][1]?.headers as Headers).has('Authorization')).toBe(false);
});

it('fetches a protected image as Blob', async () => {
  saveToken('session');
  vi.mocked(fetch).mockResolvedValue(new Response(new Blob(['data'], { type: 'image/png' })));
  const result = await api.image(9);
  expect(result).toBeInstanceOf(Blob);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/analyses/9/image');
});

it('exports CSV and revokes browser blob URL', async () => {
  saveToken('session');
  vi.mocked(fetch).mockResolvedValue(new Response('header\nvalue'));
  URL.createObjectURL = vi.fn(() => 'blob:csv'); URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await api.export();
  expect(URL.createObjectURL).toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
  expect(click).toHaveBeenCalledOnce(); click.mockRestore();
});

it('prefers error.detail, title, then fallback for HTTP failures', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Invalid photo' }), { status: 400 }));
  await expect(api.stats()).rejects.toThrow('Invalid photo');
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Unauthorized' }), { status: 401 }));
  await expect(api.me()).rejects.toThrow('Unauthorized');
});

it('prevents empty, oversized and unsupported image extensions', () => {
  expect(validatePhotoFile({ name: 'empty.png', size: 0, type: 'image/png' })).toContain('порожній');
  expect(validatePhotoFile({ name: 'huge.png', size: 10 * 1024 * 1024 + 1, type: 'image/png' })).toContain('10 МБ');
  expect(validatePhotoFile({ name: 'hello', size: 1, type: '' })).toContain('лише фото');
  expect(validatePhotoFile({ name: 'OK.JPEG', size: 1, type: '' })).toBeNull();
  expect(validatePhotoFile({ name: 'OK.jpg', size: 1, type: 'image/jpeg' })).toBeNull();
});

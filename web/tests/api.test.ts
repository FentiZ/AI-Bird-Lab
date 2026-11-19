import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api, getToken, saveToken, clearToken } from '../src/api';
import { validatePhotoFile } from '../src/photo';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

describe('React REST client', () => {
  it('stores, reads and deletes auth token', () => {
    saveToken('secret'); expect(getToken()).toBe('secret'); clearToken(); expect(getToken()).toBe('');
  });

  it('does not send secret token to public endpoints', async () => {
    saveToken('secret');
    vi.mocked(fetch).mockResolvedValue(response({ chainId: 31337 }));
    await api.chain();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Headers).has('Authorization')).toBe(false);
  });

  it('sends authorization header when reading analyses', async () => {
    saveToken('secret');
    vi.mocked(fetch).mockResolvedValue(response([]));
    await api.analyses('Barn & Owl');
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/analyses?search=Barn%20%26%20Owl');
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer secret');
  });

  it('sends photo as multipart without explicitly setting content-type', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ status: 'queued' }, 202));
    const file = new File(['test image'], 'bird.jpg', { type: 'image/jpeg' });
    await api.analyze(file);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/analyze');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('file')).toEqual(file);
    expect((init?.headers as Headers).has('Content-Type')).toBe(false);
  });

  it('converts HTTP errors to useful messages', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ error: 'Active subscription required' }, 402));
    await expect(api.me()).rejects.toThrow('Active subscription required');
    vi.mocked(fetch).mockResolvedValue(new Response('bad', { status: 503 }));
    await expect(api.me()).rejects.toThrow('Server error 503');
  });

  it('deletes analysis using correct method and id', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await api.delete(42);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/analyses/42');
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe('DELETE');
  });
});

describe('photo-only uploads', () => {
  it('accepts JPG, JPEG and PNG regardless of uppercase extension', () => {
    expect(validatePhotoFile(new File(['x'], 'robin.JPG', { type: 'image/jpeg' }))).toBeNull();
    expect(validatePhotoFile(new File(['x'], 'robin.png', { type: 'image/png' }))).toBeNull();
  });
  it('rejects videos, text, mismatched MIME, and oversized photos', () => {
    expect(validatePhotoFile(new File(['x'], 'movie.mp4', { type: 'video/mp4' }))).toContain('лише фото');
    expect(validatePhotoFile(new File(['x'], 'report.pdf', { type: 'application/pdf' }))).toContain('лише фото');
    expect(validatePhotoFile(new File(['x'], 'fake.jpg', { type: 'image/png' }))).toContain('не відповідає');
    expect(validatePhotoFile({ name: 'huge.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 })).toContain('10 МБ');
  });
  it('does not upload unsupported file even when called directly', async () => {
    const file = new File(['x'], 'cat.gif', { type: 'image/gif' });
    await expect(api.analyze(file)).rejects.toThrow('лише фото');
    expect(fetch).not.toHaveBeenCalled();
  });
});

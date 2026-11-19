import { expect, it, vi } from 'vitest';
import { apiRequest, photoUpload, cleanBaseUrl, apiUrl } from '../src/client';
it('supports PNG by extension if MIME absent', () => {
  const value = photoUpload({ uri: 'file:///a.png' }, 111);
  expect(value).toEqual({ uri: 'file:///a.png', type: 'image/png', name: 'bird-111.png' });
});
it('normalizes URL and supports blank names for camera capture', () => {
  expect(cleanBaseUrl('  http://host:5080// ')).toBe('http://host:5080');
  expect(apiUrl('http://host:5080', '/stats')).toBe('http://host:5080/api/stats');
  expect(photoUpload({ uri: 'content://photo' }, 55).name).toBe('bird-55.jpg');
  expect(photoUpload({ uri: 'file:///bird.jpeg' }, 77).type).toBe('image/jpeg');
});
it('does not accept HEIF mime without extension, or mismatching photo types', () => {
  expect(() => photoUpload({ uri: 'file:///shot', mimeType: 'image/heic' })).toThrow('HEIC');
  expect(() => photoUpload({ uri: 'file:///bird.png', fileName: 'bird.png', mimeType: 'image/jpeg' })).toThrow('не відповідає');
});
it('returns detailed server errors or HTTP fallback when body cannot be parsed', async () => {
  const detail = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'Token expired' }) });
  await expect(apiRequest('http://host', '', '/auth/me', 'GET', undefined, detail)).rejects.toThrow('Token expired');
  const title = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ title: 'SQL failed' }) });
  await expect(apiRequest('http://host', '', '/stats', 'GET', undefined, title)).rejects.toThrow('SQL failed');
});

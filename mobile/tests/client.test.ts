import { describe, expect, it, vi } from 'vitest';
import { apiUrl, cleanBaseUrl, photoUpload, apiRequest } from '../src/client';

describe('Expo mobile API and photo helpers', () => {
  it('trims LAN URL and removes trailing slashes', () => {
    expect(cleanBaseUrl(' http://192.168.1.5:5080/// ')).toBe('http://192.168.1.5:5080');
    expect(apiUrl('http://192.168.1.5:5080/', '/analyses/3')).toBe('http://192.168.1.5:5080/api/analyses/3');
  });

  it('uses original image file name when available', () => {
    expect(photoUpload({ uri: 'file:///bird.jpg', fileName: 'robin.JPG', mimeType: 'image/jpeg' })).toEqual({
      uri: 'file:///bird.jpg', name: 'robin.JPG', type: 'image/jpeg'
    });
  });

  it('provides simple JPEG defaults for camera pictures', () => {
    expect(photoUpload({ uri: 'file:///camera' }, 1234)).toEqual({
      uri: 'file:///camera', name: 'bird-1234.jpg', type: 'image/jpeg'
    });
  });

  it('rejects video, webp, PDF and mismatched extensions', () => {
    expect(() => photoUpload({ uri: 'file:///movie.mp4', fileName: 'movie.mp4', mimeType: 'video/mp4', type: 'video' })).toThrow('фотографію');
    expect(() => photoUpload({ uri: 'file:///cat.webp', fileName: 'cat.webp', mimeType: 'image/webp' })).toThrow('JPG');
    expect(() => photoUpload({ uri: 'file:///file.pdf', fileName: 'file.pdf' })).toThrow('JPG');
    expect(() => photoUpload({ uri: 'file:///fake.jpg', fileName: 'fake.jpg', mimeType: 'image/png' })).toThrow('не відповідає');
    expect(photoUpload({ uri: 'file:///picture.png', fileName: 'picture.png', mimeType: 'image/png' }).type).toBe('image/png');
  });

  it('rejects HEIC images which the backend cannot decode', () => {
    expect(() => photoUpload({ uri: 'file:///x', fileName: 'bird.HEIC' })).toThrow('HEIC');
    expect(() => photoUpload({ uri: 'file:///x', mimeType: 'image/heif' })).toThrow('HEIC');
  });

  it('sends bearer token and multipart without manually setting content type', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'queued' }), { status: 202 }));
    const body = new FormData(); body.append('file', 'sample');
    const result = await apiRequest(' http://127.0.0.1:5080/ ', ' token ', '/analyze', 'POST', body, fetchStub);
    expect(result.status).toBe('queued');
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:5080/api/analyze');
    expect(init.headers.Authorization).toBe('Bearer token');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBe(body);
  });

  it('handles 204 deletion without trying to parse response', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiRequest('http://host', 'token', '/analyses/1', 'DELETE', undefined, fetchStub)).toBeNull();
  });

  it('reports 402 subscription error and invalid server responses', async () => {
    const denied = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Active subscription required' }), { status: 402 }));
    await expect(apiRequest('http://host', 'token', '/analyze', 'POST', undefined, denied)).rejects.toThrow('Active subscription required');
    const failed = vi.fn().mockResolvedValue(new Response('internal error', { status: 503 }));
    await expect(apiRequest('http://host', 'token', '/auth/me', 'GET', undefined, failed)).rejects.toThrow('Помилка 503');
  });
});

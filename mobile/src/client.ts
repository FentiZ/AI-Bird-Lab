// Pure mobile API helpers: no Expo or React Native required in tests.
export type PhotoAsset = { uri: string; fileName?: string | null; mimeType?: string | null };

export function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function apiUrl(baseUrl: string, path: string): string {
  return cleanBaseUrl(baseUrl) + '/api' + path;
}

export function photoUpload(asset: PhotoAsset & { type?: string | null }, timestamp = Date.now()): { uri: string; name: string; type: string } {
  if (asset.type && asset.type !== 'image') throw new Error('Потрібно вибрати фотографію, не відео.');
  const originalName = asset.fileName || asset.uri.split('?')[0].split('/').pop() || '';
  const ext = originalName.split('.').pop()?.toLowerCase();
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime.includes('heic') || mime.includes('heif') || ext === 'heic' || ext === 'heif')
    throw new Error('HEIC не підтримується. Виберіть JPG/PNG або зробіть фото камерою.');
  if (mime && mime !== 'image/jpeg' && mime !== 'image/png')
    throw new Error('Можна завантажувати лише JPG, JPEG або PNG.');
  if (ext && !['jpg', 'jpeg', 'png'].includes(ext)) {
    // Expo camera can return a URI without a file extension, but not a known unsupported file.
    if (asset.fileName || ext !== originalName.toLowerCase())
      throw new Error('Можна завантажувати лише JPG, JPEG або PNG.');
  }
  const isPng = mime === 'image/png' || (ext === 'png' && !mime);
  const type = isPng ? 'image/png' : 'image/jpeg';
  if (mime && ext && ['jpg', 'jpeg', 'png'].includes(ext) &&
      ((ext === 'png') !== (mime === 'image/png')))
    throw new Error('Формат файлу не відповідає розширенню.');
  const name = asset.fileName || `bird-${timestamp}.${isPng ? 'png' : 'jpg'}`;
  return { uri: asset.uri, name, type };
}

export async function apiRequest(
  baseUrl: string, token: string, path: string, method = 'GET', body?: FormData,
  http: typeof fetch = fetch
): Promise<any> {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token.trim() };
  const response = await http(apiUrl(baseUrl, path), { method, headers, body });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.detail || error.title || `Помилка ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

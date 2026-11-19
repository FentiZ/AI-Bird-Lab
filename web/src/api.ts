import { validatePhotoFile } from './photo';
export const API = '/api';
export type Prediction = { species: string; confidence: number };
export type Bird = {
  english_name: string; ukrainian_name: string; scientific_name: string;
  family: string; habitat_uk: string; distribution_uk: string; diet_uk: string;
  size_uk: string; conservation: string; description_uk: string;
  interesting_fact_uk: string; source_url: string;
};
export type Analysis = {
  id: number; imageName: string; predictedSpecies: string; confidence: number;
  analysisDate: string; description: string; status: 'queued' | 'done' | 'failed' | 'not_bird';
  error: string; birdInfo: Bird | null; top3: Prediction[];
};
export type Stats = {
  total: number; queued: number; species: { species: string; count: number }[];
  highest: Analysis | null; lowest: Analysis | null;
};
export type Subscription = { wallet: string; active: boolean; expiresAt: number };
export type ContractInfo = { address: string; chainId: number; priceWei: string; rpcUrl: string };

export const getToken = () => localStorage.getItem('birdlab_token') || '';
export const saveToken = (token: string) => localStorage.setItem('birdlab_token', token);
export const clearToken = () => localStorage.removeItem('birdlab_token');

async function request(path: string, init: RequestInit = {}, withToken = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (withToken && getToken()) headers.set('Authorization', 'Bearer ' + getToken());
  const response = await fetch(API + path, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || body?.detail || body?.title || `Server error ${response.status}`);
  }
  return response;
}

async function json<T>(path: string, init?: RequestInit, token = true): Promise<T> {
  return (await request(path, init, token)).json();
}

export const api = {
  chain: () => json<ContractInfo>('/blockchain', undefined, false),
  challenge: () => json<{ nonce: string; message: string }>('/auth/challenge', undefined, false),
  verify: (nonce: string, signature: string) => json<{ wallet: string; token: string }>(
    '/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce, signature }) }, false),
  me: () => json<Subscription>('/auth/me'),
  birds: () => json<Bird[]>('/birds', undefined, false),
  analyses: (search = '') => json<Analysis[]>('/analyses?search=' + encodeURIComponent(search)),
  stats: () => json<Stats>('/stats'),
  analyze: async (file: File) => {
    const invalid = validatePhotoFile(file);
    if (invalid) throw new Error(invalid);
    const data = new FormData();
    data.append('file', file);
    return json<Analysis>('/analyze', { method: 'POST', body: data });
  },
  delete: (id: number) => request(`/analyses/${id}`, { method: 'DELETE' }),
  image: (id: number) => request(`/analyses/${id}/image`).then(r => r.blob()),
  export: async () => {
    const response = await request('/export');
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url; a.download = 'bird_analysis.csv'; a.click();
    URL.revokeObjectURL(url);
  }
};

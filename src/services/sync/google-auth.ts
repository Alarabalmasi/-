import { env } from '../../config/env.ts';
import { fetchJson } from './http.ts';

let cached: { token: string; expiresAt: number } | null = null;

export async function googleAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'refresh_token', client_id: env.googleClientId, client_secret: env.googleClientSecret, refresh_token: env.googleRefreshToken,
  });
  const data = await fetchJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!data?.access_token) throw new Error('Google OAuth token response missing access_token');
  cached = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return cached.token;
}

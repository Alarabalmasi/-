import { env } from '../../config/env.ts';

export async function fetchJson(url: string, init: RequestInit = {}): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt <= env.httpRetryCount; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.httpTimeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let body: any = null;
      if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
      }
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status} ${response.statusText}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
        if (response.status === 429 || response.status >= 500) throw err;
        throw Object.assign(err, { permanent: true });
      }
      return body;
    } catch (error: any) {
      last = error;
      if (error?.permanent || attempt >= env.httpRetryCount) throw error;
      await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

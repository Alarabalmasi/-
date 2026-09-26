import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.resolve(process.cwd(), '.env'));
for (const [k, v] of Object.entries(fileEnv)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const num = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const env = {
  timezone: process.env.APP_TIMEZONE || 'Asia/Riyadh',
  syncLookbackHours: num('SYNC_LOOKBACK_HOURS', 48),
  httpTimeoutMs: num('HTTP_TIMEOUT_MS', 20000),
  httpRetryCount: num('HTTP_RETRY_COUNT', 3),
  lockStaleMs: num('LOCK_STALE_MS', 3600000),
  googleSheetId: process.env.GOOGLE_SHEET_ID || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  googleAdsCustomerId: (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''),
  googleAdsLoginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, ''),
  googleAdsApiVersion: process.env.GOOGLE_ADS_API_VERSION || 'v25',
  googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
  searchConsoleSiteUrl: process.env.SEARCH_CONSOLE_SITE_URL || '',
  searchConsoleRowLimit: num('SEARCH_CONSOLE_ROW_LIMIT', 25000),
  zidAuthorizationToken: process.env.ZID_AUTHORIZATION_TOKEN || '',
  zidManagerToken: process.env.ZID_MANAGER_TOKEN || '',
  zidStoreId: process.env.ZID_STORE_ID || '',
  zidBaseUrl: process.env.ZID_BASE_URL || 'https://api.zid.sa/v1',
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  whatsappWabaId: process.env.WHATSAPP_WABA_ID || '',
  whatsappGraphVersion: process.env.WHATSAPP_GRAPH_VERSION || '',
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || '',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  whatsappWebhookPort: num('WHATSAPP_WEBHOOK_PORT', 8787),
};

export function missingFor(source: 'google-sheets' | 'zid' | 'whatsapp' | 'google-ads' | 'search-console'): string[] {
  const required: Record<string, [string, string][]> = {
    'google-sheets': [
      ['GOOGLE_SHEET_ID', env.googleSheetId], ['GOOGLE_CLIENT_ID', env.googleClientId],
      ['GOOGLE_CLIENT_SECRET', env.googleClientSecret], ['GOOGLE_REFRESH_TOKEN', env.googleRefreshToken],
    ],
    zid: [
      ['ZID_AUTHORIZATION_TOKEN', env.zidAuthorizationToken], ['ZID_MANAGER_TOKEN', env.zidManagerToken], ['ZID_STORE_ID', env.zidStoreId],
    ],
    whatsapp: [
      ['WHATSAPP_ACCESS_TOKEN', env.whatsappAccessToken], ['WHATSAPP_WABA_ID', env.whatsappWabaId], ['WHATSAPP_GRAPH_VERSION', env.whatsappGraphVersion],
    ],
    'google-ads': [
      ['GOOGLE_CLIENT_ID', env.googleClientId], ['GOOGLE_CLIENT_SECRET', env.googleClientSecret], ['GOOGLE_REFRESH_TOKEN', env.googleRefreshToken], ['GOOGLE_ADS_CUSTOMER_ID', env.googleAdsCustomerId],
    ],
    'search-console': [
      ['GOOGLE_CLIENT_ID', env.googleClientId], ['GOOGLE_CLIENT_SECRET', env.googleClientSecret], ['GOOGLE_REFRESH_TOKEN', env.googleRefreshToken], ['SEARCH_CONSOLE_SITE_URL', env.searchConsoleSiteUrl],
    ],
  };
  return required[source].filter(([, v]) => !v).map(([k]) => k);
}

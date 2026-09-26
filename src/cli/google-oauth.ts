import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALLBACK_PATH = '/oauth2callback';
const CALLBACK_TIMEOUT_MS = 15 * 60 * 1000;
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

type InstalledCredentials = {
  client_id: string;
  client_secret: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readInstalledCredentials(projectRoot: string): InstalledCredentials {
  const candidates = fs.readdirSync(projectRoot).filter((name) => /^client_secret_.+\.json$/i.test(name));
  if (candidates.length !== 1) throw new Error('Expected one Desktop OAuth client_secret JSON file in the project root.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, candidates[0]), 'utf8'));
  } catch {
    throw new Error('The Desktop OAuth client_secret JSON file is invalid.');
  }

  const installed = isRecord(parsed) && isRecord(parsed.installed) ? parsed.installed : null;
  if (!installed || typeof installed.client_id !== 'string' || typeof installed.client_secret !== 'string') {
    throw new Error('The client_secret JSON file is not a valid Desktop OAuth client.');
  }
  return { client_id: installed.client_id, client_secret: installed.client_secret };
}

function readEnvValue(contents: string, key: string): string {
  const line = contents.split(/\r?\n/).find((entry) => new RegExp(`^${key}\\s*=`).test(entry));
  if (!line) return '';
  const value = line.slice(line.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function replaceEnvValues(contents: string, values: Record<string, string>): string {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const hasFinalNewline = contents.endsWith('\n');
  const lines = contents.split(/\r?\n/);
  if (hasFinalNewline) lines.pop();
  if (lines.length === 1 && lines[0] === '') lines.length = 0;

  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error('OAuth returned an invalid value.');
    const matcher = new RegExp(`^${key}\\s*=`);
    let found = false;
    for (let index = 0; index < lines.length; index += 1) {
      if (matcher.test(lines[index])) {
        lines[index] = `${key}=${value}`;
        found = true;
      }
    }
    if (!found) lines.push(`${key}=${value}`);
  }

  return lines.join(newline) + (hasFinalNewline ? newline : '');
}

function saveEnvValues(envPath: string, clientId: string, values: Record<string, string>): void {
  const latestContents = fs.readFileSync(envPath, 'utf8');
  if (readEnvValue(latestContents, 'GOOGLE_CLIENT_ID') !== clientId) {
    throw new Error('GOOGLE_CLIENT_ID changed during authorization; no credentials were saved.');
  }

  const latestSecret = readEnvValue(latestContents, 'GOOGLE_CLIENT_SECRET');
  if (latestSecret && latestSecret !== values.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_SECRET does not match the selected Desktop OAuth client.');
  }

  const updatedContents = replaceEnvValues(latestContents, values);
  const tempPath = path.join(path.dirname(envPath), `.env.oauth-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tempPath, updatedContents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, envPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function openBrowser(url: string): Promise<void> {
  let command: string;
  let args: string[];
  if (process.platform === 'win32') {
    command = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new Error('Could not open the system browser.')));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function stateMatches(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function waitForAuthorizationCode(server: ReturnType<typeof createServer>, state: string, authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Google authorization timed out.')), CALLBACK_TIMEOUT_MS);

    const finish = (error?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(code!);
    };

    server.on('request', (request, response) => {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || requestUrl.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'cache-control': 'no-store' }).end('Not found.');
        return;
      }

      if (!stateMatches(requestUrl.searchParams.get('state') || '', state)) {
        response.writeHead(400, { 'cache-control': 'no-store' }).end('Authorization state mismatch.');
        return;
      }

      if (requestUrl.searchParams.has('error')) {
        response.writeHead(400, { 'cache-control': 'no-store' }).end('Google authorization was not completed.');
        finish(new Error('Google authorization was not completed.'));
        return;
      }

      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400, { 'cache-control': 'no-store' }).end('Authorization code is missing.');
        finish(new Error('Google authorization code is missing.'));
        return;
      }

      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
      }).end('Google authorization complete. You may close this window.');
      finish(undefined, code);
    });

    void openBrowser(authUrl).catch(() => finish(new Error('Could not open the system browser.')));
  });
}

async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  verifier: string,
  credentials: InstalledCredentials,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Could not exchange the authorization code with Google.');
  }

  if (!response.ok) throw new Error('Google rejected the authorization code.');
  let tokenResponse: unknown;
  try {
    tokenResponse = await response.json();
  } catch {
    throw new Error('Google returned an invalid token response.');
  }
  if (!isRecord(tokenResponse) || typeof tokenResponse.refresh_token !== 'string' || !tokenResponse.refresh_token) {
    throw new Error('Google did not return a refresh token. No credentials were saved.');
  }
  return tokenResponse.refresh_token;
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) throw new Error('The project .env file is missing.');

  const credentials = readInstalledCredentials(projectRoot);
  const initialEnv = fs.readFileSync(envPath, 'utf8');
  if (readEnvValue(initialEnv, 'GOOGLE_CLIENT_ID') !== credentials.client_id) {
    throw new Error('GOOGLE_CLIENT_ID in .env does not match the Desktop OAuth client.');
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(32).toString('base64url');
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new Error('Could not start the localhost callback server.')));
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not determine the localhost callback port.');

    const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.search = new URLSearchParams({
      client_id: credentials.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    }).toString();

    console.log('Opening Google sign-in in your browser. Complete authorization to continue.');
    const code = await waitForAuthorizationCode(server, state, authUrl.toString());
    const refreshToken = await exchangeAuthorizationCode(code, redirectUri, verifier, credentials);
    saveEnvValues(envPath, credentials.client_id, {
      GOOGLE_CLIENT_SECRET: credentials.client_secret,
      GOOGLE_REFRESH_TOKEN: refreshToken,
    });
    console.log('Google authorization complete. Credentials were saved to .env.');
  } finally {
    server.close();
  }
}

main().catch(() => {
  console.error('Google OAuth failed. No credential values were printed.');
  process.exitCode = 1;
});
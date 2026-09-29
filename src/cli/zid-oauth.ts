import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ZID_AUTHORIZE_URL = 'https://oauth.zid.sa/oauth/authorize';
const ZID_TOKEN_URL = 'https://oauth.zid.sa/oauth/token';
const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PORT = 8789;
const CALLBACK_PATH = '/oauth/callback';
const CALLBACK_TIMEOUT_MS = 15 * 60 * 1000;

type ZidAppCredentials = {
  clientId: string;
  clientSecret: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive terminal.'));
  }

  process.stdout.write(prompt);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          finish(new Error('Input canceled.'));
          return;
        }
        if (byte === 10 || byte === 13) {
          finish();
          return;
        }
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
      }
    };

    input.on('data', onData);
  });
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
    if (!value || /[\r\n]/.test(value)) throw new Error('A required Zid credential is invalid.');
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

function saveEnvValues(envPath: string, values: Record<string, string>): void {
  const contents = fs.readFileSync(envPath, 'utf8');
  const updated = replaceEnvValues(contents, values);
  const tempPath = path.join(path.dirname(envPath), `.env.zid-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tempPath, updated, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
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

function waitForAuthorizationCode(
  server: ReturnType<typeof createServer>,
  state: string,
  authorizeUrl: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Zid authorization timed out.')), CALLBACK_TIMEOUT_MS);

    const finish = (error?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(code!);
    };

    server.on('request', (request, response) => {
      const requestUrl = new URL(request.url || '/', `http://${CALLBACK_HOST}`);
      if (request.method !== 'GET' || requestUrl.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'cache-control': 'no-store' }).end('Not found.');
        return;
      }

      if (!stateMatches(requestUrl.searchParams.get('state') || '', state)) {
        response.writeHead(400, { 'cache-control': 'no-store' }).end('Authorization state mismatch.');
        return;
      }

      if (requestUrl.searchParams.has('error')) {
        response.writeHead(400, { 'cache-control': 'no-store' }).end('Zid authorization was not completed.');
        finish(new Error('Zid authorization was not completed.'));
        return;
      }

      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400, { 'cache-control': 'no-store' }).end('Authorization code is missing.');
        finish(new Error('Zid authorization code is missing.'));
        return;
      }

      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
      }).end('Zid authorization complete. You may close this window.');
      finish(undefined, code);
    });

    void openBrowser(authorizeUrl).catch(() => finish(new Error('Could not open the system browser.')));
  });
}

function authorizationValue(payload: unknown, response: Response): string {
  const candidates: unknown[] = [];
  if (isRecord(payload)) {
    candidates.push(payload.Authorization, payload.authorization, payload.authorization_token, payload.authorizationToken);
    if (isRecord(payload.data)) {
      candidates.push(payload.data.Authorization, payload.data.authorization, payload.data.authorization_token, payload.data.authorizationToken);
    }
  }
  candidates.push(response.headers.get('authorization'));
  const value = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
  if (!value) throw new Error('Zid did not return the Authorization credential.');
  return value;
}

async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  credentials: ZidAppCredentials,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(ZID_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Could not exchange the Zid authorization code.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Zid returned an invalid token response.');
  }
  if (!response.ok) throw new Error('Zid rejected the authorization code.');
  return authorizationValue(payload, response);
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) throw new Error('The project .env file is missing.');

  const initialEnv = fs.readFileSync(envPath, 'utf8');
  const managerToken = readEnvValue(initialEnv, 'ZID_MANAGER_TOKEN') || await readHidden('Zid direct Manager Token (input hidden): ');
  const storeId = readEnvValue(initialEnv, 'ZID_STORE_ID') || await readHidden('Zid Store ID (input hidden): ');
  const clientId = await readHidden('Zid app Client ID (input hidden): ');
  const clientSecret = await readHidden('Zid app Client Secret (input hidden): ');
  if (!managerToken || !storeId || !clientId || !clientSecret) throw new Error('A required Zid value was empty.');

  const credentials = { clientId, clientSecret };
  const redirectUri = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
  const state = randomBytes(32).toString('base64url');
  const authorizeUrl = new URL(ZID_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  }).toString();

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new Error('Could not start the Zid localhost callback server.')));
    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => resolve());
  });

  try {
    console.log('Opening Zid sign-in in your browser. Complete authorization to continue.');
    const code = await waitForAuthorizationCode(server, state, authorizeUrl.toString());
    const authorizationToken = await exchangeAuthorizationCode(code, redirectUri, credentials);
    saveEnvValues(envPath, {
      ZID_AUTHORIZATION_TOKEN: authorizationToken,
      ZID_MANAGER_TOKEN: managerToken,
      ZID_STORE_ID: storeId,
    });
    console.log('Zid authorization complete. Credentials were saved to .env.');
  } finally {
    server.close();
  }
}

main().catch(() => {
  console.error('Zid OAuth failed. No credential values were printed.');
  process.exitCode = 1;
});
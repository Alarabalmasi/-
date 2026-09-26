const SECRET_KEYS = /token|secret|authorization|password|credential|api[-_]?key|refresh/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
      .replace(/(access_token|refresh_token|client_secret)=([^&\s]+)/gi, '$1=[REDACTED]');
  }
  return value;
}

export function safeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return String(redact(msg)).slice(0, 500);
}

export const logger = {
  info(message: string, meta?: unknown) { console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), message, meta: redact(meta) })); },
  warn(message: string, meta?: unknown) { console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), message, meta: redact(meta) })); },
  error(message: string, meta?: unknown) { console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), message, meta: redact(meta) })); },
};

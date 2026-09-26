import { env } from '../../config/env.ts';

export function isoDateInTimezone(input: string | number | Date, timeZone = env.timezone): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(input)}`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCurrency(value: unknown, fallback = 'SAR'): string | null {
  if (value === null || value === undefined || value === '') return fallback;
  const s = String(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

export function stableKey(parts: unknown[]): string {
  return parts.map(x => x === null || x === undefined ? '' : String(x)).join('|');
}

export function normalizeOrderStatus(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  const map: Record<string, string> = {
    completed: 'completed', delivered: 'delivered', cancelled: 'cancelled', canceled: 'cancelled',
    refunded: 'refunded', ready: 'ready', processing: 'processing', new: 'new', pending: 'pending',
  };
  return map[s] || s;
}

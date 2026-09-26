import { toNumberOrNull } from '../normalization/index.ts';

export function dedupeBy<T extends Record<string, unknown>>(rows: T[], keyOf: (r: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(keyOf(row), row);
  return [...map.values()];
}

export function validateRows(rows: Record<string, unknown>[], keyFields: string[]): { valid: Record<string, unknown>[]; errors: string[] } {
  const errors: string[] = [];
  const valid: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const key = keyFields.map(k => row[k] ?? '').join('|');
    if (!key.replace(/\|/g, '')) { errors.push(`row ${i + 1}: missing key`); continue; }
    if (seen.has(key)) { errors.push(`row ${i + 1}: duplicate key ${key}`); continue; }
    seen.add(key);
    for (const field of ['revenue', 'net_sales', 'discount', 'shipping', 'tax', 'cost', 'conversion_value']) {
      if (field in row && row[field] !== null && toNumberOrNull(row[field]) === null) errors.push(`row ${i + 1}: invalid numeric field ${field}`);
    }
    valid.push(row);
  }
  return { valid, errors };
}

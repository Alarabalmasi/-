import test from 'node:test';
import assert from 'node:assert/strict';
import { isoDateInTimezone, normalizeCurrency, normalizeOrderStatus, stableKey, toNumberOrNull } from '../src/services/normalization/index.ts';

test('تطبيع التاريخ إلى توقيت الرياض',()=>{
  assert.equal(isoDateInTimezone('2026-09-26T21:30:00Z','Asia/Riyadh'),'2026-09-27');
});

test('تطبيع الأرقام والعملات والحالات',()=>{
  assert.equal(toNumberOrNull('99.5'),99.5);
  assert.equal(toNumberOrNull('x'),null);
  assert.equal(normalizeCurrency('sar'),'SAR');
  assert.equal(normalizeCurrency('bad!'),null);
  assert.equal(normalizeOrderStatus('CANCELED'),'cancelled');
  assert.equal(stableKey(['a',1,null]),'a|1|');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, safeError } from '../src/services/logging/logger.ts';

test('السجلات لا تسرب الأسرار',()=>{
  const x=redact({access_token:'abc123',nested:{client_secret:'secret'},authorization:'Bearer xyz'});
  assert.deepEqual(x,{access_token:'[REDACTED]',nested:{client_secret:'[REDACTED]'},authorization:'[REDACTED]'});
  assert.ok(!safeError(new Error('Authorization: Bearer abc.def')).includes('abc.def'));
});

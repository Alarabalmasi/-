import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeBy, validateRows } from '../src/services/validation/index.ts';

test('إزالة التكرار تعتمد آخر سجل لنفس المفتاح',()=>{
  const rows=dedupeBy([{id:'1',v:1},{id:'1',v:2},{id:'2',v:3}],r=>r.id);
  assert.deepEqual(rows,[{id:'1',v:2},{id:'2',v:3}]);
});

test('التحقق يرفض المفاتيح المكررة ولا يحول القيم غير الصالحة إلى صفر',()=>{
  const r=validateRows([{key:'a',revenue:'12'},{key:'a',revenue:4},{key:'b',revenue:'bad'}],['key']);
  assert.equal(r.valid.length,2);
  assert.ok(r.errors.some(x=>x.includes('duplicate')));
  assert.ok(r.errors.some(x=>x.includes('invalid numeric')));
});

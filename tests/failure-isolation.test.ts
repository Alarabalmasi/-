import test from 'node:test';
import assert from 'node:assert/strict';
import { runIndependently } from '../src/services/sync/independent.ts';

test('فشل مصدر واحد لا يوقف بقية المصادر',async()=>{
  const r=await runIndependently([async()=>1,async()=>{throw new Error('boom')},async()=>3]);
  assert.equal(r.length,3);
  assert.equal(r[0].ok,true);
  assert.equal(r[1].ok,false);
  assert.equal(r[2].ok,true);
});

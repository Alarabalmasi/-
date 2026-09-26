import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADERS, SHEETS, rowForHeaders } from '../src/connectors/google-sheets/index.ts';

test('تجهيز صفوف Google Sheets يحافظ على ترتيب الأعمدة ويجعل null فارغاً',()=>{
  const h=HEADERS[SHEETS.whatsapp];
  const row=rowForHeaders(h,{key:'2026-09-26',date:'2026-09-26',inbound_messages:null,conversations:4});
  assert.equal(row[0],'2026-09-26');
  assert.equal(row[2],'');
  assert.equal(row[6],4);
});

import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.ts';
import type { SourceName } from '../../types/core.ts';

const file=path.resolve(process.cwd(),'data/state.json');
type State={lastSuccess?:Partial<Record<SourceName,string>>};
function read():State { try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}}
export function windowFor(source:SourceName):{start:Date;end:Date}{
  const end=new Date(); const s=read().lastSuccess?.[source];
  const fallback=new Date(end.getTime()-env.syncLookbackHours*3600_000);
  const start=s ? new Date(Math.min(end.getTime(),new Date(s).getTime()-3600_000)) : fallback;
  return {start,end};
}
export function markSuccess(source:SourceName,at=new Date()){
  fs.mkdirSync(path.dirname(file),{recursive:true}); const state=read(); state.lastSuccess ||= {}; state.lastSuccess[source]=at.toISOString();
  fs.writeFileSync(file,JSON.stringify(state,null,2));
}

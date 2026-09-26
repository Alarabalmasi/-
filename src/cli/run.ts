import { acquireLock } from '../services/sync/lock.ts';
import { runSources } from '../services/sync/index.ts';
import type { SourceName } from '../types/core.ts';

const target=process.argv[2] || 'all';
const mock=process.argv.includes('--mock');
const dryRun=process.argv.includes('--dry-run');
const map:Record<string,SourceName[]>={
  all:['zid','whatsapp','google-ads','search-console'], zid:['zid'], whatsapp:['whatsapp'], 'google-ads':['google-ads'], 'search-console':['search-console'],
};
if (!map[target]) { console.error(`Unknown target: ${target}`); process.exit(2); }
const release=acquireLock();
try {
  const results=await runSources(map[target],{mock,dryRun});
  console.log(JSON.stringify({ok:results.every(r=>r.status!=='failed'),mock,dryRun,results},null,2));
  process.exitCode=results.some(r=>r.status==='failed')?1:0;
} finally { release(); }

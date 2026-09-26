import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.ts';

const lockPath=path.resolve(process.cwd(),'data/sync.lock');

export function acquireLock(): () => void {
  fs.mkdirSync(path.dirname(lockPath),{recursive:true});
  if (fs.existsSync(lockPath)) {
    const age=Date.now()-fs.statSync(lockPath).mtimeMs;
    if (age>env.lockStaleMs) fs.unlinkSync(lockPath);
  }
  try {
    const fd=fs.openSync(lockPath,'wx');
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    fs.closeSync(fd);
  } catch {
    throw new Error('Another sync process is already running');
  }
  return ()=>{ try{fs.unlinkSync(lockPath);}catch{} };
}

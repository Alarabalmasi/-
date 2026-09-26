import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.ts';

const file=path.resolve(process.cwd(),'data/whatsapp-events.ndjson'); fs.mkdirSync(path.dirname(file),{recursive:true});
function hashContact(id:string){ return crypto.createHmac('sha256',env.whatsappAppSecret || env.whatsappVerifyToken || 'local-dev').update(id).digest('hex').slice(0,24); }
function append(e:any){ fs.appendFileSync(file,JSON.stringify(e)+'\n'); }
function verify(raw:Buffer,sig:string|undefined){ if(!env.whatsappAppSecret) return true; const expected='sha256='+crypto.createHmac('sha256',env.whatsappAppSecret).update(raw).digest('hex'); return !!sig && crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)); }

http.createServer((req,res)=>{
  const u=new URL(req.url || '/',`http://${req.headers.host || 'localhost'}`);
  if(req.method==='GET'){
    if(u.searchParams.get('hub.mode')==='subscribe' && u.searchParams.get('hub.verify_token')===env.whatsappVerifyToken){res.writeHead(200);res.end(u.searchParams.get('hub.challenge')||'');return;}
    res.writeHead(403);res.end('forbidden');return;
  }
  if(req.method!=='POST'){res.writeHead(405);res.end('method not allowed');return;}
  const chunks:Buffer[]=[]; req.on('data',c=>chunks.push(c)); req.on('end',()=>{
    const raw=Buffer.concat(chunks); if(!verify(raw,req.headers['x-hub-signature-256'] as string|undefined)){res.writeHead(401);res.end('invalid signature');return;}
    try{
      const body=JSON.parse(raw.toString('utf8'));
      for(const entry of body.entry||[]) for(const change of entry.changes||[]) {
        const v=change.value||{};
        for(const m of v.messages||[]) append({ts:Number(m.timestamp||Math.floor(Date.now()/1000))*1000,direction:'in',contact_hash:hashContact(String(m.from||''))});
        for(const s of v.statuses||[]) append({ts:Number(s.timestamp||Math.floor(Date.now()/1000))*1000,direction:'out',contact_hash:hashContact(String(s.recipient_id||'')),status:s.status||null});
      }
      res.writeHead(200);res.end('ok');
    }catch{res.writeHead(400);res.end('bad request');}
  });
}).listen(env.whatsappWebhookPort,()=>console.log(`WhatsApp webhook listening on ${env.whatsappWebhookPort}; message text and phone numbers are not persisted.`));

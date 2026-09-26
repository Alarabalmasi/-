import fs from 'node:fs';
import path from 'node:path';
import type { Connector, ConnectorContext, ConnectorOutput } from '../../types/core.ts';
import { env } from '../../config/env.ts';
import { fetchJson } from '../../services/sync/http.ts';
import { isoDateInTimezone, stableKey, toNumberOrNull } from '../../services/normalization/index.ts';

type EventRow = { ts:number; direction:'in'|'out'; contact_hash?:string; status?:string };

function localEvents(windowStart: Date, windowEnd: Date): EventRow[] {
  const file = path.resolve(process.cwd(), 'data/whatsapp-events.ndjson');
  if (!fs.existsSync(file)) return [];
  const out: EventRow[] = [];
  for (const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as EventRow;
      const d = new Date(e.ts);
      if (d >= windowStart && d <= windowEnd) out.push(e);
    } catch {}
  }
  return out;
}

export class WhatsAppConnector implements Connector {
  readonly name = 'whatsapp' as const;

  async testConnection() {
    const url = `https://graph.facebook.com/${env.whatsappGraphVersion}/${env.whatsappWabaId}?fields=id&access_token=${encodeURIComponent(env.whatsappAccessToken)}`;
    const data = await fetchJson(url);
    return { ok: String(data?.id || '') === env.whatsappWabaId, detail:'WhatsApp Business Account reachable' };
  }

  async fetch(ctx: ConnectorContext): Promise<ConnectorOutput> {
    if (ctx.mock) return this.mock(ctx);
    const start = Math.floor(ctx.window.start.getTime()/1000);
    const end = Math.floor(ctx.window.end.getTime()/1000);
    const fields = `analytics.start(${start}).end(${end}).granularity(DAY),conversation_analytics.start(${start}).end(${end}).granularity(DAILY)`;
    const url = `https://graph.facebook.com/${env.whatsappGraphVersion}/${env.whatsappWabaId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(env.whatsappAccessToken)}`;
    const data = await fetchJson(url);
    const events = localEvents(ctx.window.start, ctx.window.end);
    const byDate = new Map<string, any>();
    const ensure = (date:string) => {
      if (!byDate.has(date)) byDate.set(date,{date,inbound_messages:null,outbound_messages:null,sent:null,delivered:null,conversations:null,open_conversations:null,closed_conversations:null,first_response_seconds:null,pending_customers:null,attributed_conversions:null});
      return byDate.get(date);
    };

    for (const p of data?.analytics?.data_points || []) {
      const d = isoDateInTimezone(Number(p.start)*1000);
      const row = ensure(d);
      row.sent = (row.sent ?? 0) + (toNumberOrNull(p.sent) ?? 0);
      row.delivered = (row.delivered ?? 0) + (toNumberOrNull(p.delivered) ?? 0);
      row.outbound_messages = row.sent;
    }
    for (const group of data?.conversation_analytics?.data || []) {
      for (const p of group?.data_points || []) {
        const d = isoDateInTimezone(Number(p.start)*1000);
        const row = ensure(d);
        row.conversations = (row.conversations ?? 0) + (toNumberOrNull(p.conversation) ?? 0);
      }
    }

    const eventGroups = new Map<string, EventRow[]>();
    for (const e of events) {
      const d = isoDateInTimezone(e.ts);
      if (!eventGroups.has(d)) eventGroups.set(d,[]);
      eventGroups.get(d)!.push(e);
    }
    for (const [d, es] of eventGroups) {
      const row = ensure(d);
      row.inbound_messages = es.filter(x=>x.direction==='in').length;
      row.outbound_messages = Math.max(row.outbound_messages ?? 0, es.filter(x=>x.direction==='out').length);
      const contacts = new Map<string, {firstIn?:number; firstOut?:number}>();
      for (const e of es) {
        if (!e.contact_hash) continue;
        const c = contacts.get(e.contact_hash) || {};
        if (e.direction==='in') c.firstIn = Math.min(c.firstIn ?? Infinity,e.ts);
        if (e.direction==='out') c.firstOut = Math.min(c.firstOut ?? Infinity,e.ts);
        contacts.set(e.contact_hash,c);
      }
      const responseTimes = [...contacts.values()].filter(c=>c.firstIn && c.firstOut && c.firstOut>=c.firstIn).map(c=>(c.firstOut!-c.firstIn!)/1000);
      row.first_response_seconds = responseTimes.length ? responseTimes.reduce((a,b)=>a+b,0)/responseTimes.length : null;
      row.pending_customers = [...contacts.values()].filter(c=>c.firstIn && !c.firstOut).length;
    }

    const rows = [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({...r,key:stableKey([r.date])}));
    const warnings = [
      'open/closed conversation status is not exposed by WABA analytics; left null unless supplied by an inbox/CRM source',
      'incoming message counts and first-response time require webhook events; null when local webhook event store has no data',
      'attributed conversions require a documented attribution mechanism; left null',
    ];
    return { source:this.name, rows, pulled:rows.length, warnings };
  }

  private mock(ctx: ConnectorContext): ConnectorOutput {
    const d=isoDateInTimezone(ctx.window.end);
    return {source:this.name,pulled:1,warnings:['MOCK_DATA'],rows:[{date:d,inbound_messages:20,outbound_messages:18,sent:18,delivered:17,conversations:12,open_conversations:null,closed_conversations:null,first_response_seconds:180,pending_customers:2,attributed_conversions:null,key:d}]};
  }
}

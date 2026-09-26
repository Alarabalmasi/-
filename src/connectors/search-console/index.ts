import type { Connector, ConnectorContext, ConnectorOutput } from '../../types/core.ts';
import { env } from '../../config/env.ts';
import { googleAccessToken } from '../../services/sync/google-auth.ts';
import { fetchJson } from '../../services/sync/http.ts';
import { stableKey, toNumberOrNull } from '../../services/normalization/index.ts';

function ymd(d: Date) { return d.toISOString().slice(0,10); }

export class SearchConsoleConnector implements Connector {
  readonly name = 'search-console' as const;

  async testConnection() {
    const token = await googleAccessToken();
    const data = await fetchJson('https://www.googleapis.com/webmasters/v3/sites', { headers:{Authorization:`Bearer ${token}`} });
    const ok = (data?.siteEntry || []).some((x:any) => x.siteUrl === env.searchConsoleSiteUrl);
    return { ok, detail: ok ? 'Search Console property accessible' : 'OAuth works but target property not listed' };
  }

  async fetch(ctx: ConnectorContext): Promise<ConnectorOutput> {
    if (ctx.mock) return this.mock(ctx);
    const token = await googleAccessToken();
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(env.searchConsoleSiteUrl)}/searchAnalytics/query`;
    const all: any[] = [];
    let startRow = 0;
    const rowLimit = Math.min(env.searchConsoleRowLimit, 25000);
    while (true) {
      const body = { startDate:ymd(ctx.window.start), endDate:ymd(ctx.window.end), dimensions:['date','query','page','device','country'], rowLimit, startRow, dataState:'final' };
      const data = await fetchJson(url, { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify(body) });
      const batch = data?.rows || [];
      all.push(...batch);
      if (batch.length < rowLimit) break;
      startRow += rowLimit;
      if (startRow >= 100000) break;
    }
    const rows = all.map((r:any) => ({
      date:r.keys?.[0] ?? null, query:r.keys?.[1] ?? null, page:r.keys?.[2] ?? null, device:r.keys?.[3] ?? null, country:r.keys?.[4] ?? null,
      clicks:toNumberOrNull(r.clicks), impressions:toNumberOrNull(r.impressions), ctr:toNumberOrNull(r.ctr), position:toNumberOrNull(r.position),
      key:stableKey([...(r.keys || [])]),
    }));
    return { source:this.name, rows, pulled:rows.length, warnings:[] };
  }

  private mock(ctx: ConnectorContext): ConnectorOutput {
    const d = ymd(ctx.window.end);
    return { source:this.name,pulled:1,warnings:['MOCK_DATA'],rows:[{date:d,query:'ثوب رجالي',page:'https://alarabalmasi.com/',device:'MOBILE',country:'sau',clicks:20,impressions:1000,ctr:.02,position:6.5,key:`${d}|ثوب رجالي|https://alarabalmasi.com/|MOBILE|sau`}]} ;
  }
}

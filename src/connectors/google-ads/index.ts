import type { Connector, ConnectorContext, ConnectorOutput } from '../../types/core.ts';
import { env } from '../../config/env.ts';
import { googleAccessToken } from '../../services/sync/google-auth.ts';
import { fetchJson } from '../../services/sync/http.ts';
import { stableKey, toNumberOrNull } from '../../services/normalization/index.ts';

function ymd(d: Date) { return d.toISOString().slice(0,10); }

export class GoogleAdsConnector implements Connector {
  readonly name = 'google-ads' as const;

  private async query(gaql: string): Promise<any[]> {
    const token = await googleAccessToken();
    const h: Record<string,string> = { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' };
    if (env.googleAdsLoginCustomerId) h['login-customer-id'] = env.googleAdsLoginCustomerId;
    if (env.googleAdsDeveloperToken) h['developer-token'] = env.googleAdsDeveloperToken;
    const url = `https://googleads.googleapis.com/${env.googleAdsApiVersion}/customers/${env.googleAdsCustomerId}/googleAds:searchStream`;
    const data = await fetchJson(url, { method:'POST', headers:h, body:JSON.stringify({ query: gaql }) });
    const chunks = Array.isArray(data) ? data : [data];
    return chunks.flatMap((x:any) => x?.results || []);
  }

  async testConnection() {
    const rows = await this.query('SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1');
    return { ok: rows.length >= 0, detail: 'Google Ads API reachable' };
  }

  async fetch(ctx: ConnectorContext): Promise<ConnectorOutput> {
    if (ctx.mock) return this.mock(ctx);
    const start = ymd(ctx.window.start), end = ymd(ctx.window.end);
    const baseMetrics = 'metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.ctr, metrics.conversions, metrics.conversions_value';
    const campaignQ = `SELECT segments.date, customer.id, customer.currency_code, campaign.id, campaign.name, ${baseMetrics} FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`;
    const adGroupQ = `SELECT segments.date, customer.id, customer.currency_code, campaign.id, campaign.name, ad_group.id, ad_group.name, ${baseMetrics} FROM ad_group WHERE segments.date BETWEEN '${start}' AND '${end}'`;
    const keywordQ = `SELECT segments.date, customer.id, customer.currency_code, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ${baseMetrics} FROM keyword_view WHERE segments.date BETWEEN '${start}' AND '${end}'`;
    const warnings: string[] = [];
    const groups: [string, any[]][] = [];
    groups.push(['campaign', await this.query(campaignQ)]);
    try { groups.push(['ad_group', await this.query(adGroupQ)]); } catch { warnings.push('تعذر جلب مستوى مجموعة الإعلانات'); }
    try { groups.push(['keyword', await this.query(keywordQ)]); } catch { warnings.push('تعذر جلب مستوى الكلمات المفتاحية'); }

    const rows: Record<string,unknown>[] = [];
    for (const [level, rs] of groups) for (const r of rs) {
      const m = r.metrics || {};
      const cost = toNumberOrNull(m.costMicros) === null ? null : Number(m.costMicros) / 1_000_000;
      const conv = toNumberOrNull(m.conversions);
      const value = toNumberOrNull(m.conversionsValue);
      rows.push({
        level, date:r.segments?.date ?? null, account_id:String(r.customer?.id ?? env.googleAdsCustomerId), currency:r.customer?.currencyCode ?? null,
        campaign_id:String(r.campaign?.id ?? ''), campaign_name:r.campaign?.name ?? null,
        ad_group_id:r.adGroup?.id ? String(r.adGroup.id) : null, ad_group_name:r.adGroup?.name ?? null,
        keyword_id:r.adGroupCriterion?.criterionId ? String(r.adGroupCriterion.criterionId) : null,
        keyword:r.adGroupCriterion?.keyword?.text ?? null, match_type:r.adGroupCriterion?.keyword?.matchType ?? null,
        cost, clicks:toNumberOrNull(m.clicks), impressions:toNumberOrNull(m.impressions), ctr:toNumberOrNull(m.ctr), conversions:conv,
        conversion_value:value, cpa: cost !== null && conv && conv > 0 ? cost / conv : null, roas: cost !== null && cost > 0 && value !== null ? value / cost : null,
        key: stableKey([level,r.segments?.date,r.customer?.id,r.campaign?.id,r.adGroup?.id,r.adGroupCriterion?.criterionId]),
      });
    }
    return { source:this.name, rows, pulled:rows.length, warnings };
  }

  private mock(ctx: ConnectorContext): ConnectorOutput {
    const d = ymd(ctx.window.end);
    return { source:this.name, pulled:1, warnings:['MOCK_DATA'], rows:[{ level:'campaign',date:d,account_id:'mock',currency:'SAR',campaign_id:'mock-c1',campaign_name:'حملة تجريبية',ad_group_id:null,ad_group_name:null,keyword_id:null,keyword:null,match_type:null,cost:100,clicks:50,impressions:5000,ctr:.01,conversions:4,conversion_value:400,cpa:25,roas:4,key:`campaign|${d}|mock|mock-c1||` }]};
  }
}

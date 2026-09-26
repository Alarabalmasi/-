import { env } from '../../config/env.ts';
import { googleAccessToken } from '../../services/sync/google-auth.ts';
import { fetchJson } from '../../services/sync/http.ts';

export const SHEETS = {
  zid: 'زد', whatsapp:'واتساب', ads:'أداء الإعلانات', search:'أداء البحث', log:'سجل التشغيل', dashboard:'لوحة المتابعة'
} as const;

export const HEADERS: Record<string,string[]> = {
  [SHEETS.zid]: ['key','record_type','date','order_id','status','revenue','net_sales','discount','shipping','tax','currency','branch','channel','quantity','product_id','sku','product_name','available_quantity','critical_stock'],
  [SHEETS.whatsapp]: ['key','date','inbound_messages','outbound_messages','sent','delivered','conversations','open_conversations','closed_conversations','first_response_seconds','pending_customers','attributed_conversions'],
  [SHEETS.ads]: ['key','level','date','account_id','currency','campaign_id','campaign_name','ad_group_id','ad_group_name','keyword_id','keyword','match_type','cost','clicks','impressions','ctr','conversions','conversion_value','cpa','roas'],
  [SHEETS.search]: ['key','date','query','page','device','country','clicks','impressions','ctr','position'],
  [SHEETS.log]: ['source','attempt_time','status','pulled','written','duration_ms','message'],
};

export function rowForHeaders(headers:string[],row:Record<string,unknown>):unknown[]{ return headers.map(h=>row[h]===undefined || row[h]===null ? '' : row[h]); }

function colLetters(n:number): string {
  let s='';
  while(n>0){ n--; s=String.fromCharCode(65+n%26)+s; n=Math.floor(n/26); }
  return s;
}

export class GoogleSheetsConnector {
  private async authHeaders() { return { Authorization:`Bearer ${await googleAccessToken()}`, 'Content-Type':'application/json' }; }

  async metadata() {
    const h=await this.authHeaders();
    return fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetId}?fields=sheets.properties,properties(title,timeZone,locale)`,{headers:h});
  }

  async testConnection() {
    const data=await this.metadata();
    return {ok:String(data?.spreadsheetId || env.googleSheetId)===env.googleSheetId || Array.isArray(data?.sheets),detail:'Google Sheets API reachable'};
  }

  async ensureManagedTabs() {
    const meta=await this.metadata();
    const existing=new Set((meta?.sheets||[]).map((s:any)=>s.properties?.title));
    const needed=[SHEETS.zid,SHEETS.whatsapp,SHEETS.ads,SHEETS.search,SHEETS.log];
    const requests=needed.filter(x=>!existing.has(x)).map(title=>({addSheet:{properties:{title}}}));
    if (requests.length) {
      const h=await this.authHeaders();
      await fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetId}:batchUpdate`,{method:'POST',headers:h,body:JSON.stringify({requests})});
    }
    for (const tab of needed) await this.ensureHeader(tab,HEADERS[tab]);
  }

  private async getValues(tab:string): Promise<any[][]> {
    const h=await this.authHeaders();
    const range=encodeURIComponent(`'${tab.replace(/'/g,"''")}'!A1:Z50000`);
    const data=await fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetId}/values/${range}`,{headers:h});
    return data?.values || [];
  }

  private async updateValues(tab:string, startCell:string, values:any[][]) {
    if (!values.length) return;
    const h=await this.authHeaders();
    const endCol=colLetters(values[0].length);
    const endRow=Number(startCell.match(/\d+/)?.[0] || 1)+values.length-1;
    const range=encodeURIComponent(`'${tab.replace(/'/g,"''")}'!${startCell}:${endCol}${endRow}`);
    await fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetId}/values/${range}?valueInputOption=RAW`,{method:'PUT',headers:h,body:JSON.stringify({values})});
  }

  private async ensureHeader(tab:string, headers:string[]) {
    const existing=await this.getValues(tab);
    if (!existing.length) await this.updateValues(tab,'A1',[headers]);
  }

  async upsert(tab:string, rows:Record<string,unknown>[], keyField='key'): Promise<number> {
    if (!rows.length) return 0;
    const headers=HEADERS[tab];
    if (!headers) throw new Error(`No managed header definition for ${tab}`);
    const existing=await this.getValues(tab);
    const existingHeader=(existing[0]||[]) as string[];
    if (!existingHeader.length) await this.updateValues(tab,'A1',[headers]);
    else if (headers.some((h,i)=>existingHeader[i]!==h)) throw new Error(`Sheet ${tab} header mismatch; refusing destructive write`);

    const map=new Map<string, any[]>();
    for (const r of existing.slice(1)) {
      const obj=Object.fromEntries(headers.map((h,i)=>[h,r[i]??'']));
      if (obj[keyField]) map.set(String(obj[keyField]),headers.map(h=>obj[h]??''));
    }
    let changed=0;
    for (const row of rows) {
      const key=String(row[keyField]??'');
      if (!key) continue;
      const values=rowForHeaders(headers,row);
      const before=map.get(key);
      if (!before || JSON.stringify(before)!==JSON.stringify(values)) changed++;
      map.set(key,values);
    }
    const merged=[...map.values()];
    await this.updateValues(tab,'A2',merged);
    return changed;
  }

  async refreshDashboard(sourceStatuses: Record<string,{status:string;updatedAt:string;records:number;message?:string}> = {}) {
    const current=await this.getValues(SHEETS.dashboard);
    const marker=current?.[0]?.[9] ?? '';
    if (marker && marker !== 'تكاملات API — آلي') throw new Error('Dashboard J1:O20 is not empty; refusing to overwrite unmanaged cells');
    const zid=await this.getValues(SHEETS.zid);
    const wa=await this.getValues(SHEETS.whatsapp);
    const ads=await this.getValues(SHEETS.ads);
    const zh=HEADERS[SHEETS.zid], wh=HEADERS[SHEETS.whatsapp], ah=HEADERS[SHEETS.ads];
    const obj=(headers:string[],row:any[])=>Object.fromEntries(headers.map((h,i)=>[h,row[i]??'']));
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:env.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const z=zid.slice(1).map(r=>obj(zh,r)); const w=wa.slice(1).map(r=>obj(wh,r)); const a=ads.slice(1).map(r=>obj(ah,r));
    const zToday=z.filter(r=>r.record_type==='order' && r.date===today);
    const aToday=a.filter(r=>r.level==='campaign' && r.date===today);
    const wToday=w.filter(r=>r.date===today);
    const sum=(xs:any[],k:string)=>xs.reduce((t,r)=>t+(r[k]===''?0:Number(r[k])||0),0);
    const revenue=sum(zToday,'revenue'), orders=zToday.length, cost=sum(aToday,'cost'), conv=sum(aToday,'conversions'), value=sum(aToday,'conversion_value');
    const critical=z.filter(r=>r.record_type==='stock' && (r.critical_stock===true || String(r.critical_stock).toLowerCase()==='true')).length;
    const ctrImpressions=sum(aToday,'impressions'); const ctr=ctrImpressions?sum(aToday,'clicks')/ctrImpressions:null;
    const cpa=conv?cost/conv:null, roas=cost?value/cost:null;
    const conversations=sum(wToday,'conversations'), inbound=sum(wToday,'inbound_messages');
    const sources=['zid','whatsapp','google-ads','search-console'];
    const block:any[][]=[
      ['تكاملات API — آلي','','','','',''],
      ['المصدر','آخر تحديث','الحالة','السجلات','التنبيه',''],
      ...sources.map(s=>[s,sourceStatuses[s]?.updatedAt||'',sourceStatuses[s]?.status||'',sourceStatuses[s]?.records??'',sourceStatuses[s]?.message||'','']),
      ['','','','','',''],
      ['المؤشر','القيمة','التاريخ','','',''],
      ['الإيرادات اليوم',revenue,today,'','',''],
      ['الطلبات اليوم',orders,today,'','',''],
      ['المخزون الحرج',critical,today,'','',''],
      ['محادثات واتساب',conversations,today,'','',''],
      ['رسائل واتساب الواردة',inbound,today,'','',''],
      ['تكلفة الإعلانات',cost,today,'','',''],
      ['التحويلات',conv,today,'','',''],
      ['CTR',ctr,today,'','',''],
      ['CPA',cpa,today,'','',''],
      ['ROAS',roas,today,'','',''],
    ];
    await this.updateValues(SHEETS.dashboard,'J1',block);
  }

  async appendLog(row:Record<string,unknown>) {
    const headers=HEADERS[SHEETS.log];
    const h=await this.authHeaders();
    const range=encodeURIComponent(`'${SHEETS.log}'!A:G`);
    const values=[rowForHeaders(headers,row)];
    await fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',headers:h,body:JSON.stringify({values})});
  }
}

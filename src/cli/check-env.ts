import { missingFor, env } from '../config/env.ts';
const sources=['google-sheets','zid','whatsapp','google-ads','search-console'] as const;
const result=Object.fromEntries(sources.map(s=>[s,{missing:missingFor(s)}]));
console.log(JSON.stringify({
  ok:Object.values(result).every((x:any)=>x.missing.length===0),
  timezone:env.timezone,
  spreadsheetConfigured:Boolean(env.googleSheetId),
  googleAdsApiVersion:env.googleAdsApiVersion,
  result,
  scopes:{
    googleAds:['https://www.googleapis.com/auth/adwords'],
    searchConsole:['https://www.googleapis.com/auth/webmasters.readonly'],
    googleSheets:['https://www.googleapis.com/auth/spreadsheets'],
    zid:['orders.read','products.read'],
    whatsapp:['whatsapp_business_management (read analytics)','webhook subscription for inbound/status events when configured)']
  }
},null,2));

import type { Connector, SourceName, SyncRunResult } from '../../types/core.ts';
import { ZidConnector } from '../../connectors/zid/index.ts';
import { WhatsAppConnector } from '../../connectors/whatsapp/index.ts';
import { GoogleAdsConnector } from '../../connectors/google-ads/index.ts';
import { SearchConsoleConnector } from '../../connectors/search-console/index.ts';
import { GoogleSheetsConnector, SHEETS } from '../../connectors/google-sheets/index.ts';
import { validateRows } from '../validation/index.ts';
import { safeError, logger } from '../logging/logger.ts';
import { windowFor, markSuccess } from './state.ts';

const connectors:Record<SourceName,Connector>={
  zid:new ZidConnector(), whatsapp:new WhatsAppConnector(), 'google-ads':new GoogleAdsConnector(), 'search-console':new SearchConsoleConnector(),
};
const tab:Record<SourceName,string>={zid:SHEETS.zid,whatsapp:SHEETS.whatsapp,'google-ads':SHEETS.ads,'search-console':SHEETS.search};

export async function runSources(sources:SourceName[],opts:{mock:boolean;dryRun:boolean;sheets?:GoogleSheetsConnector}):Promise<SyncRunResult[]>{
  const sheets=opts.sheets || new GoogleSheetsConnector();
  if (!opts.dryRun) await sheets.ensureManagedTabs();
  const results:SyncRunResult[]=[];
  const dashboardStatuses:Record<string,{status:string;updatedAt:string;records:number;message?:string}>={};
  for (const source of sources) {
    const started=Date.now();
    try {
      const output=await connectors[source].fetch({window:windowFor(source),mock:opts.mock});
      const {valid,errors}=validateRows(output.rows,['key']);
      const warnings=[...output.warnings,...errors];
      let written=0;
      if (!opts.dryRun) {
        written=await sheets.upsert(tab[source],valid,'key');
        markSuccess(source);
      }
      const result:SyncRunResult={source,status:opts.dryRun?'dry-run':'success',pulled:output.pulled,written,durationMs:Date.now()-started,warnings};
      results.push(result);
      dashboardStatuses[source]={status:result.status,updatedAt:new Date().toISOString(),records:result.written,message:warnings.join('; ').slice(0,180)};
      if (!opts.dryRun) await sheets.appendLog({source,attempt_time:new Date().toISOString(),status:result.status,pulled:result.pulled,written:result.written,duration_ms:result.durationMs,message:warnings.join('; ').slice(0,500)});
      logger.info(`sync ${source} completed`,result);
    } catch(error) {
      const result:SyncRunResult={source,status:'failed',pulled:0,written:0,durationMs:Date.now()-started,error:safeError(error),warnings:[]};
      results.push(result); dashboardStatuses[source]={status:'failed',updatedAt:new Date().toISOString(),records:0,message:result.error}; logger.error(`sync ${source} failed`,result);
      if (!opts.dryRun) {
        try { await sheets.appendLog({source,attempt_time:new Date().toISOString(),status:'failed',pulled:0,written:0,duration_ms:result.durationMs,message:result.error}); } catch {}
      }
    }
  }
  if (!opts.dryRun) { try { await sheets.refreshDashboard(dashboardStatuses); } catch(e) { logger.warn('dashboard refresh skipped',{error:safeError(e)}); } }
  return results;
}

export async function testConnections(sources:SourceName[]) {
  const out:Record<string,unknown>={};
  for (const s of sources) {
    try{out[s]=await connectors[s].testConnection();}catch(e){out[s]={ok:false,detail:safeError(e)};}
  }
  return out;
}

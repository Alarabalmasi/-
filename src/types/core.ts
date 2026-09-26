export type SourceName = 'zid' | 'whatsapp' | 'google-ads' | 'search-console';

export type SyncWindow = {
  start: Date;
  end: Date;
};

export type ConnectorContext = {
  window: SyncWindow;
  mock: boolean;
};

export type ConnectorOutput = {
  source: SourceName;
  rows: Record<string, unknown>[];
  pulled: number;
  warnings: string[];
};

export interface Connector {
  readonly name: SourceName;
  testConnection(): Promise<{ ok: boolean; detail: string }>;
  fetch(ctx: ConnectorContext): Promise<ConnectorOutput>;
}

export type SyncRunResult = {
  source: SourceName;
  status: 'success' | 'failed' | 'dry-run';
  pulled: number;
  written: number;
  durationMs: number;
  error?: string;
  warnings: string[];
};

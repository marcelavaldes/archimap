export type LogCategory = 'STATE' | 'API' | 'DATA' | 'MAP' | 'ERROR';
export type LogSeverity = 'info' | 'warn' | 'error' | 'success';

export interface DebugLogEntry {
  id: string;
  timestamp: number;
  category: LogCategory;
  severity: LogSeverity;
  message: string;
  detail?: unknown;
}

export interface DataQualitySummary {
  totalFeatures: number;
  featuresWithScore: number;
  deptsFetched: number;
  deptsSucceeded: number;
  deptsFailed: number;
  lastCriterion: string | null;
  lastLoadDurationMs: number | null;
}

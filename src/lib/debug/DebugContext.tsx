'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { DebugLogEntry, DataQualitySummary, LogCategory, LogSeverity } from './types';

const MAX_LOGS = 500;

interface DebugContextType {
  logs: DebugLogEntry[];
  dataQuality: DataQualitySummary;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  log: (category: LogCategory, severity: LogSeverity, message: string, detail?: unknown) => void;
  updateDataQuality: (partial: Partial<DataQualitySummary>) => void;
  clearLogs: () => void;
}

const defaultDataQuality: DataQualitySummary = {
  totalFeatures: 0,
  featuresWithScore: 0,
  deptsFetched: 0,
  deptsSucceeded: 0,
  deptsFailed: 0,
  lastCriterion: null,
  lastLoadDurationMs: null,
};

const DebugContext = createContext<DebugContextType | null>(null);

let logCounter = 0;

export function DebugProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [dataQuality, setDataQuality] = useState<DataQualitySummary>(defaultDataQuality);
  const [isOpen, setIsOpen] = useState(false);

  const log = useCallback(
    (category: LogCategory, severity: LogSeverity, message: string, detail?: unknown) => {
      const entry: DebugLogEntry = {
        id: String(++logCounter),
        timestamp: Date.now(),
        category,
        severity,
        message,
        detail,
      };
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    },
    []
  );

  const updateDataQuality = useCallback((partial: Partial<DataQualitySummary>) => {
    setDataQuality((prev) => ({ ...prev, ...partial }));
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    setDataQuality(defaultDataQuality);
  }, []);

  // Ctrl+Shift+D toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <DebugContext.Provider
      value={{ logs, dataQuality, isOpen, setIsOpen, log, updateDataQuality, clearLogs }}
    >
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug() {
  const ctx = useContext(DebugContext);
  if (!ctx) throw new Error('useDebug must be used within DebugProvider');
  return ctx;
}

'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import type { DebugLogEntry, DataQualitySummary, LogCategory, LogSeverity } from './types';

const MAX_LOGS = 500;

type LogFn = (category: LogCategory, severity: LogSeverity, message: string, detail?: unknown) => void;

interface DebugContextType {
  logs: DebugLogEntry[];
  dataQuality: DataQualitySummary;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  log: LogFn;
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

  // Use ref for setLogs to avoid stale closures in callbacks
  const setLogsRef = useRef(setLogs);
  setLogsRef.current = setLogs;

  const setDataQualityRef = useRef(setDataQuality);
  setDataQualityRef.current = setDataQuality;

  // Stable log function that never changes identity
  const log = useCallback<LogFn>(
    (category, severity, message, detail) => {
      const entry: DebugLogEntry = {
        id: String(++logCounter),
        timestamp: Date.now(),
        category,
        severity,
        message,
        detail,
      };
      console.log(`[DBG][${category}][${severity}] ${message}`, detail !== undefined ? detail : '');
      setLogsRef.current((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    },
    []
  );

  const updateDataQuality = useCallback((partial: Partial<DataQualitySummary>) => {
    setDataQualityRef.current((prev) => ({ ...prev, ...partial }));
  }, []);

  const clearLogs = useCallback(() => {
    setLogsRef.current([]);
    setDataQualityRef.current(defaultDataQuality);
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

  // Memoize context value to prevent unnecessary consumer re-renders
  const value = useMemo<DebugContextType>(
    () => ({ logs, dataQuality, isOpen, setIsOpen, log, updateDataQuality, clearLogs }),
    [logs, dataQuality, isOpen, log, updateDataQuality, clearLogs]
  );

  return (
    <DebugContext.Provider value={value}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug() {
  const ctx = useContext(DebugContext);
  if (!ctx) throw new Error('useDebug must be used within DebugProvider');
  return ctx;
}

'use client';

import { useRef, useEffect, useState } from 'react';
import { useDebug } from '@/lib/debug/DebugContext';
import type { DebugLogEntry, LogCategory, LogSeverity } from '@/lib/debug/types';

const SEVERITY_COLORS: Record<LogSeverity, string> = {
  info: 'text-gray-400',
  success: 'text-green-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const CATEGORY_BADGE: Record<LogCategory, { bg: string; text: string }> = {
  STATE: { bg: 'bg-blue-900/60', text: 'text-blue-300' },
  API: { bg: 'bg-purple-900/60', text: 'text-purple-300' },
  DATA: { bg: 'bg-teal-900/60', text: 'text-teal-300' },
  MAP: { bg: 'bg-orange-900/60', text: 'text-orange-300' },
  ERROR: { bg: 'bg-red-900/60', text: 'text-red-300' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return (
    d.toTimeString().slice(0, 8) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  );
}

function LogEntry({ entry }: { entry: DebugLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const badge = CATEGORY_BADGE[entry.category];
  const sevColor = SEVERITY_COLORS[entry.severity];

  return (
    <div
      className={`px-2 py-1 border-b border-gray-800 text-xs font-mono hover:bg-gray-800/50 cursor-pointer ${sevColor}`}
      onClick={() => entry.detail !== undefined && setExpanded(!expanded)}
    >
      <span className="text-gray-500">[{formatTime(entry.timestamp)}]</span>{' '}
      <span
        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${badge.bg} ${badge.text}`}
      >
        {entry.category}
      </span>{' '}
      <span>{entry.message}</span>
      {entry.detail !== undefined && (
        <span className="text-gray-600 ml-1">{expanded ? '\u25BC' : '\u25B6'}</span>
      )}
      {expanded && entry.detail !== undefined && (
        <pre className="mt-1 ml-4 p-2 bg-gray-900 rounded text-[10px] text-gray-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
          {typeof entry.detail === 'string'
            ? entry.detail
            : JSON.stringify(entry.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function DebugPanel() {
  const { logs, dataQuality, isOpen, setIsOpen, clearLogs } = useDebug();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length, isOpen]);

  // Closed state: small DBG button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="absolute top-2 right-14 z-50 bg-gray-900/80 text-gray-400 hover:text-white text-[10px] font-mono px-2 py-1 rounded border border-gray-700 hover:border-gray-500 transition-colors"
        title="Debug Panel (Ctrl+Shift+D)"
      >
        DBG
      </button>
    );
  }

  const scorePercent =
    dataQuality.totalFeatures > 0
      ? ((dataQuality.featuresWithScore / dataQuality.totalFeatures) * 100).toFixed(1)
      : '-';

  const deptRate =
    dataQuality.deptsFetched > 0
      ? `${dataQuality.deptsSucceeded}/${dataQuality.deptsFetched}`
      : '-';

  return (
    <div className="absolute top-2 right-14 z-50 w-[480px] max-h-[60vh] flex flex-col bg-gray-950/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-2xl text-gray-200 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="font-bold text-sm">Debug Panel</span>
        <div className="flex items-center gap-2">
          <button
            onClick={clearLogs}
            className="text-gray-500 hover:text-gray-300 text-[10px] border border-gray-700 rounded px-2 py-0.5"
          >
            Clear
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Data quality summary */}
      <div className="grid grid-cols-4 gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/50 text-[10px]">
        <div>
          <div className="text-gray-500">Features</div>
          <div className="font-bold">{dataQuality.totalFeatures}</div>
        </div>
        <div>
          <div className="text-gray-500">With Score</div>
          <div className="font-bold">
            {dataQuality.featuresWithScore}{' '}
            <span className={
              scorePercent !== '-' && parseFloat(scorePercent) < 50
                ? 'text-red-400'
                : scorePercent !== '-' && parseFloat(scorePercent) >= 80
                  ? 'text-green-400'
                  : 'text-amber-400'
            }>
              ({scorePercent}%)
            </span>
          </div>
        </div>
        <div>
          <div className="text-gray-500">Depts</div>
          <div className="font-bold">
            {deptRate}
            {dataQuality.deptsFailed > 0 && (
              <span className="text-red-400"> ({dataQuality.deptsFailed} fail)</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Load Time</div>
          <div className="font-bold">
            {dataQuality.lastLoadDurationMs != null
              ? `${dataQuality.lastLoadDurationMs.toFixed(0)}ms`
              : '-'}
          </div>
        </div>
      </div>

      {/* Log list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {logs.length === 0 ? (
          <div className="p-4 text-center text-gray-600">
            No logs yet. Select a criterion to see activity.
          </div>
        ) : (
          logs.map((entry) => <LogEntry key={entry.id} entry={entry} />)
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1 border-t border-gray-800 text-[10px] text-gray-600 flex justify-between">
        <span>{logs.length} entries</span>
        <span>Ctrl+Shift+D to toggle</span>
      </div>
    </div>
  );
}

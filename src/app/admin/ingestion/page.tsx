'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { adminFetch, errorMessage } from '@/lib/admin/client';
import { EmptyState, ErrorPanel } from '../_components/ErrorPanel';

interface IngestionCriterion {
  id: string;
  name: string;
  ingestion_type: string;
  api_config: { script?: string; description?: string; source_url?: string } | null;
  last_updated: string | null;
  coverage: {
    communes_with_data: number;
    total_communes: number;
    coverage_percent: number;
  } | null;
}

interface LogEntry {
  time: string;
  message: string;
}

interface RunResult {
  status: 'done' | 'error';
  message: string;
  /** Set when the run completed but wrote nothing (fixture mode dry run). */
  note?: string;
}

function now(): string {
  return new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function IngestionPage() {
  const [criteria, setCriteria] = useState<IngestionCriterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchCriteria = useCallback(async () => {
    setError('');
    try {
      const data = await adminFetch<IngestionCriterion[]>('/api/admin/ingestion/status');
      setCriteria(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCriteria();
  }, [fetchCriteria]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Abort any in-flight run when the operator navigates away, so the SSE
  // reader is not left holding a stream on an unmounted component.
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleRun = async (criterionId: string) => {
    const criterion = criteria.find((c) => c.id === criterionId);
    setRunning(criterionId);
    setLogs([]);
    setRunResult(null);

    const abort = new AbortController();
    abortRef.current = abort;

    const addLog = (message: string) => {
      setLogs((prev) => [...prev, { time: now(), message }]);
    };

    addLog(`Launching ingestion for: ${criterion?.name ?? criterionId}`);

    try {
      const res = await fetch(`/api/admin/ingestion/${criterionId}/run`, {
        method: 'POST',
        signal: abort.signal,
      });

      if (!res.ok) {
        // Read as text first. A framework-level 500 is an HTML page, and
        // res.json() on it threw a SyntaxError that the outer catch reported as
        // "Connection lost" — sending the operator after a network problem that
        // was really a missing environment variable.
        const raw = await res.text();
        let message: string;
        try {
          message = JSON.parse(raw).error ?? `Erreur ${res.status}`;
        } catch {
          message = `Erreur ${res.status} ${res.statusText}`.trim();
        }
        addLog(`ERROR: ${message}`);
        setRunResult({ status: 'error', message });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        addLog('ERROR: No response stream');
        setRunResult({ status: 'error', message: 'Réponse sans flux' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'log') {
              addLog(event.message);
            } else if (event.type === 'done') {
              setRunResult({
                status: 'done',
                message: `Inserted ${event.inserted} records for ${event.communes} communes`,
                // A dry run is not a success. Carry the server's own words
                // through so the banner cannot read as "it worked".
                note: event.persisted === false ? event.fixtureNote : undefined,
              });
              if (event.persisted !== false) fetchCriteria(); // Refresh coverage
            } else if (event.type === 'error') {
              setRunResult({ status: 'error', message: event.message });
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addLog(`Connection error: ${(err as Error).message}`);
        setRunResult({ status: 'error', message: 'Connection lost' });
      }
    } finally {
      setRunning(null);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setRunning(null);
    setLogs((prev) => [...prev, { time: now(), message: '--- Cancelled by user ---' }]);
  };

  if (loading) {
    return <div className="animate-pulse text-gray-400">Chargement...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Ingestion</h1>

      {error ? (
        <ErrorPanel message={error} onRetry={fetchCriteria} />
      ) : criteria.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200">
          <EmptyState
            title="Aucun critère de type API configuré"
            hint="Passez le type d’ingestion d’un critère à « API » pour le lancer d’ici."
          />
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Critère</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Dernière MAJ</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Couverture</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {criteria.map((c) => {
                  const percent = Number(c.coverage?.coverage_percent) || 0;
                  return (
                    <tr key={c.id} className={`hover:bg-gray-50 ${running === c.id ? 'bg-blue-50' : ''}`}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {c.api_config?.description ?? c.api_config?.script ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {c.last_updated ?? 'Jamais'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">{percent}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {running === c.id ? (
                          <button
                            onClick={handleCancel}
                            className="px-3 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRun(c.id)}
                            disabled={running !== null}
                            aria-label={`Lancer l'ingestion de ${c.name}`}
                            className="px-3 py-1 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                          >
                            Run
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log console */}
      {logs.length > 0 && (
        <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-300">Console</span>
              {running && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-green-400">Running</span>
                </span>
              )}
            </div>
            {runResult && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                runResult.status === 'error'
                  ? 'bg-red-900 text-red-300'
                  : runResult.note
                    ? 'bg-amber-900 text-amber-200'
                    : 'bg-green-900 text-green-300'
              }`}>
                {runResult.status === 'error' ? 'Error' : runResult.note ? 'Dry run' : 'Success'}
              </span>
            )}
          </div>
          <div
            ref={logContainerRef}
            className="p-4 max-h-96 overflow-y-auto font-mono text-sm leading-relaxed"
          >
            {logs.map((entry, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-gray-600 flex-shrink-0 select-none">{entry.time}</span>
                <span className={`whitespace-pre-wrap ${
                  entry.message.startsWith('ERROR') || entry.message.startsWith('--- Cancel')
                    ? 'text-red-400'
                    : entry.message.startsWith('===') || entry.message.startsWith('Inserted')
                      ? 'text-green-400'
                      : entry.message.startsWith('Step')
                        ? 'text-blue-400'
                        : 'text-gray-300'
                }`}>
                  {entry.message}
                </span>
              </div>
            ))}
            {running && (
              <div className="flex gap-3 mt-1">
                <span className="text-gray-600 flex-shrink-0 select-none">{now()}</span>
                <span className="text-gray-500 animate-pulse">Waiting for data...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result banner */}
      {runResult && (
        <div className={`mt-4 p-4 rounded-lg text-sm ${
          runResult.status === 'error'
            ? 'bg-red-50 text-red-700 border border-red-200'
            : runResult.note
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : 'bg-green-50 text-green-700 border border-green-200'
        }`}>
          {runResult.status === 'error' ? '✗ ' : runResult.note ? '◦ ' : '✓ '}
          {runResult.note ?? runResult.message}
        </div>
      )}
    </div>
  );
}

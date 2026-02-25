'use client';

import { useEffect, useState } from 'react';

interface IngestionCriterion {
  id: string;
  name: string;
  ingestion_type: string;
  api_config: { script?: string; description?: string } | null;
  last_updated: string | null;
  coverage: {
    communes_with_data: number;
    total_communes: number;
    coverage_percent: number;
  } | null;
}

export default function IngestionPage() {
  const [criteria, setCriteria] = useState<IngestionCriterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/ingestion/status')
      .then(res => res.json())
      .then(setCriteria)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleRun = async (criterionId: string) => {
    setRunning(criterionId);
    setResult(null);

    try {
      const res = await fetch(`/api/admin/ingestion/${criterionId}/run`, { method: 'POST' });
      const data = await res.json();

      if (data.status === 'manual_required') {
        setResult(`Script: ${data.command}\n${data.message}`);
      } else if (data.error) {
        setResult(`Erreur: ${data.error}`);
      } else {
        setResult('Ingestion terminée');
      }
    } catch {
      setResult('Erreur de connexion');
    } finally {
      setRunning(null);
    }
  };

  if (loading) {
    return <div className="animate-pulse text-gray-400">Chargement...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Ingestion</h1>

      {result && (
        <div className="mb-4 p-4 bg-blue-50 text-blue-700 text-sm rounded-lg whitespace-pre-line font-mono">
          {result}
        </div>
      )}

      {criteria.length === 0 ? (
        <div className="text-gray-400">Aucun critère de type API configuré</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Critère</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Script</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Dernière MAJ</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Couverture</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {criteria.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                    {c.api_config?.script ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {c.last_updated ?? 'Jamais'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.min(100, c.coverage?.coverage_percent ?? 0)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{c.coverage?.coverage_percent ?? 0}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRun(c.id)}
                      disabled={running === c.id}
                      className="px-3 py-1 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                      {running === c.id ? 'En cours...' : 'Run'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

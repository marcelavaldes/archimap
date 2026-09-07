'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, errorMessage } from '@/lib/admin/client';
import { EmptyState, ErrorPanel } from '../_components/ErrorPanel';

interface CriterionWithCoverage {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  coverage: {
    communes_with_data: number;
    total_communes: number;
    coverage_percent: number;
  } | null;
}

export default function DataOverviewPage() {
  const [criteria, setCriteria] = useState<CriterionWithCoverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await adminFetch<CriterionWithCoverage[]>('/api/admin/criteria');
      setCriteria(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="animate-pulse text-gray-400">Chargement...</div>;
  }

  if (error) {
    return <ErrorPanel message={error} onRetry={load} />;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Données</h1>

      {criteria.length === 0 ? (
        // Without this the page was a heading over nothing — indistinguishable
        // from a screen that failed to render.
        <div className="bg-white rounded-lg border border-gray-200">
          <EmptyState
            title="Aucun critère"
            hint="Créez un critère avant d’y charger des données."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {criteria.map((c) => {
            const percent = Number(c.coverage?.coverage_percent) || 0;
            return (
              <Link
                key={c.id}
                href={`/admin/data/${c.id}`}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-900">{c.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    c.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {c.enabled ? 'Actif' : 'Inactif'}
                  </span>
                </div>
                <div className="text-xs text-gray-400 capitalize mb-3">{c.category}</div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{(Number(c.coverage?.communes_with_data) || 0).toLocaleString('fr-FR')} communes</span>
                    <span>{percent}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

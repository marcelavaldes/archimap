'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, errorMessage } from '@/lib/admin/client';
import { EmptyState, ErrorPanel } from './_components/ErrorPanel';

interface CoverageRow {
  criterion_id: string;
  name: string;
  enabled: boolean;
  communes_with_data: number;
  total_communes: number;
  coverage_percent: number;
  oldest_data: string | null;
  newest_data: string | null;
}

interface DashboardData {
  totalCriteria: number;
  enabledCriteria: number;
  totalCommunes: number;
  totalValues: number;
  averageCoverage: number;
  coverage: CoverageRow[];
}

/** Numbers arrive as strings from PostgREST NUMERIC columns; coerce before formatting. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminFetch<DashboardData>('/api/admin/dashboard')
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="animate-pulse text-gray-400">Chargement...</div>;
  }

  if (error || !data) {
    return <ErrorPanel message={error || 'Réponse vide du serveur'} />;
  }

  // `coverage` is defensive: the route returns an array, but a partially
  // migrated database (no criterion_coverage view) answers with null, and the
  // whole page used to disappear behind a TypeError rather than show the four
  // summary cards it could still render.
  const coverage = Array.isArray(data.coverage) ? data.coverage : [];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Critères" value={num(data.totalCriteria)} sub={`${num(data.enabledCriteria)} activés`} />
        <StatCard label="Communes" value={num(data.totalCommunes).toLocaleString('fr-FR')} />
        <StatCard label="Valeurs enregistrées" value={num(data.totalValues).toLocaleString('fr-FR')} />
        <StatCard label="Couverture moyenne" value={`${num(data.averageCoverage)}%`} />
      </div>

      {/* Coverage table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Couverture par critère</h2>
        </div>
        {coverage.length === 0 ? (
          <EmptyState
            title="Aucun critère"
            hint="Créez-en un depuis l’onglet Critères."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Critère</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">État</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Communes</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Couverture</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Données</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {coverage.map((c) => (
                  <tr key={c.criterion_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/criteria/${c.criterion_id}`} className="text-sm font-medium text-blue-600 hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs rounded-full ${
                        c.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {c.enabled ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {num(c.communes_with_data).toLocaleString('fr-FR')} / {num(c.total_communes).toLocaleString('fr-FR')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${Math.min(100, Math.max(0, num(c.coverage_percent)))}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-600">{num(c.coverage_percent)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {c.oldest_data && c.newest_data
                        ? `${c.oldest_data} — ${c.newest_data}`
                        : 'Aucune donnée'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

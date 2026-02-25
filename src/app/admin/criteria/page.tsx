'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface CriterionRow {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  display_order: number;
  ingestion_type: string;
  coverage: {
    communes_with_data: number;
    total_communes: number;
    coverage_percent: number;
  };
}

export default function CriteriaListPage() {
  const [criteria, setCriteria] = useState<CriterionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCriteria = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/criteria');
      const data = await res.json();
      setCriteria(data);
    } catch (e) {
      console.error('Error fetching criteria:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCriteria();
  }, [fetchCriteria]);

  const toggleEnabled = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/criteria/${id}/toggle`, { method: 'PATCH' });
      if (res.ok) {
        setCriteria(prev => prev.map(c =>
          c.id === id ? { ...c, enabled: !c.enabled } : c
        ));
      }
    } catch (e) {
      console.error('Error toggling criterion:', e);
    }
  };

  const deleteCriterion = async (id: string, name: string) => {
    if (!confirm(`Supprimer "${name}" et toutes ses données ?`)) return;

    try {
      const res = await fetch(`/api/admin/criteria/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCriteria(prev => prev.filter(c => c.id !== id));
      }
    } catch (e) {
      console.error('Error deleting criterion:', e);
    }
  };

  if (loading) {
    return <div className="animate-pulse text-gray-400">Chargement...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Critères</h1>
        <Link
          href="/admin/criteria/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          Nouveau critère
        </Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Activé</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Couverture</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {criteria.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/criteria/${c.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-xs text-gray-400 font-mono">{c.id}</div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 capitalize">{c.category}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    c.ingestion_type === 'api' ? 'bg-purple-100 text-purple-700' :
                    c.ingestion_type === 'csv' ? 'bg-orange-100 text-orange-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {c.ingestion_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => toggleEnabled(c.id)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${
                      c.enabled ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      c.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
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
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/admin/criteria/${c.id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Éditer
                    </Link>
                    <button
                      onClick={() => deleteCriterion(c.id, c.name)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

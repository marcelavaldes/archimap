'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { adminFetch, errorMessage, unpersistedNote } from '@/lib/admin/client';
import { EmptyState, ErrorPanel } from '../_components/ErrorPanel';

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
  } | null;
}

export default function CriteriaListPage() {
  const [criteria, setCriteria] = useState<CriterionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchCriteria = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await adminFetch<CriterionRow[]>('/api/admin/criteria');
      // The route contracts to return an array. Checking anyway is not
      // paranoia here: the previous version passed whatever came back straight
      // into state, so an `{ error }` body reached `criteria.map(...)` and took
      // the whole page down with a TypeError and no message on screen.
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

  const toggleEnabled = async (id: string) => {
    setActionError('');
    setNotice(null);
    setBusyId(id);

    // Optimistic, with a real rollback. Before, a failed PATCH did nothing at
    // all: `if (res.ok)` guarded the state update and there was no else, so the
    // switch simply refused to move and the operator was left clicking it.
    const previous = criteria;
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));

    try {
      setNotice(
        unpersistedNote(
          await adminFetch<unknown>(`/api/admin/criteria/${id}/toggle`, { method: 'PATCH' })
        )
      );
    } catch (e) {
      setCriteria(previous);
      setActionError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const deleteCriterion = async (id: string, name: string) => {
    if (!confirm(`Supprimer "${name}" et toutes ses données ?`)) return;
    setActionError('');
    setNotice(null);
    setBusyId(id);

    try {
      const result = await adminFetch<unknown>(`/api/admin/criteria/${id}`, { method: 'DELETE' });
      setCriteria((prev) => prev.filter((c) => c.id !== id));
      setNotice(unpersistedNote(result));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="animate-pulse text-gray-400">Chargement...</div>;
  }

  if (error) {
    return <ErrorPanel message={error} onRetry={fetchCriteria} />;
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

      {actionError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}
      {notice && (
        <div
          data-testid="write-notice"
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        >
          {notice}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {criteria.length === 0 ? (
          <EmptyState
            title="Aucun critère"
            hint="Utilisez « Nouveau critère » pour en ajouter un."
          />
        ) : (
          <div className="overflow-x-auto">
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
                        disabled={busyId === c.id}
                        role="switch"
                        aria-checked={c.enabled}
                        aria-label={`Activer ${c.name}`}
                        className={`w-10 h-5 rounded-full transition-colors relative disabled:opacity-50 ${
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
                            style={{ width: `${Math.min(100, Math.max(0, Number(c.coverage?.coverage_percent) || 0))}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{Number(c.coverage?.coverage_percent) || 0}%</span>
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
                          disabled={busyId === c.id}
                          className="text-xs text-red-500 hover:underline disabled:opacity-50"
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
        )}
      </div>
    </div>
  );
}

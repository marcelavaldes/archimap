'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { adminFetch, errorMessage, unpersistedNote } from '@/lib/admin/client';
import { EmptyState, ErrorPanel } from '../../_components/ErrorPanel';

interface ValueRow {
  id: string;
  commune_code: string;
  value: number;
  score: number;
  rank_national: number;
  source_date: string | null;
  communes: { nom: string } | null;
}

interface PageData {
  data: ValueRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface UploadResponse {
  total: number;
  inserted: number;
  validated?: number;
  errors: number;
  parseErrors?: string[];
  sampleErrors?: string[];
}

/**
 * How long to sit on a keystroke before searching.
 *
 * The search box refetched on every character, so typing "montpellier" fired
 * eleven requests. That is not just wasteful: the responses race, and the last
 * one to arrive wins regardless of which query it answers, so the table could
 * settle on the results for "montpel". Same failure the map hit in 39412ff.
 */
const SEARCH_DEBOUNCE_MS = 300;

export default function CriterionDataPage() {
  const { criterionId } = useParams<{ criterionId: string }>();
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [criterionName, setCriterionName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [uploadTone, setUploadTone] = useState<'info' | 'error'>('info');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Monotonic request id. Only the newest in-flight fetch is allowed to write
   * state, so an earlier, slower response cannot overwrite a later one.
   */
  const requestRef = useRef(0);

  // Debounce the search box, and reset to page 1 whenever the term changes —
  // page 4 of "montpellier" is almost never a page that exists.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchData = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);

      const data = await adminFetch<PageData>(`/api/admin/data/${criterionId}?${params}`);
      if (requestId !== requestRef.current) return;
      setPageData(data);
    } catch (e) {
      if (requestId !== requestRef.current) return;
      setError(errorMessage(e));
      setPageData(null);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [criterionId, page, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // The heading used to be the raw slug ("propertyPrice"), which reads like an
  // unfinished screen. Failing to resolve the name is not worth an error state:
  // the slug is still a correct, if ugly, title.
  useEffect(() => {
    let cancelled = false;
    adminFetch<{ name?: string }>(`/api/admin/criteria/${criterionId}`)
      .then((c) => {
        if (!cancelled && c?.name) setCriterionName(c.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [criterionId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);
    setUploadTone('info');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await adminFetch<UploadResponse>(
        `/api/admin/data/${criterionId}/upload`,
        { method: 'POST', body: formData }
      );

      const note = unpersistedNote(result);
      setUploadResult(
        note
          ? `${result.validated ?? result.total} lignes lues et notées, 0 écrite. ${note}`
          : `Upload terminé: ${result.inserted} insérés, ${result.errors} erreurs`
      );
      if (!note) fetchData();
    } catch (err) {
      setUploadTone('error');
      setUploadResult(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(`Supprimer TOUTES les données pour ${criterionId} ?`)) return;
    setUploadResult(null);
    setUploadTone('info');

    try {
      const result = await adminFetch<{ deleted: number; wouldDelete?: number }>(
        `/api/admin/data/${criterionId}`,
        { method: 'DELETE' }
      );
      const note = unpersistedNote(result);
      setUploadResult(
        note
          ? `Aucune suppression (${result.wouldDelete ?? 0} valeurs concernées). ${note}`
          : `${result.deleted} valeurs supprimées`
      );
      if (!note) fetchData();
    } catch (err) {
      setUploadTone('error');
      setUploadResult(errorMessage(err));
    }
  };

  const rows = pageData?.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/data" className="text-sm text-gray-500 hover:text-gray-700">&larr; Retour</Link>
        <h1 className="text-2xl font-semibold text-gray-900">{criterionName ?? criterionId}</h1>
        {criterionName && <span className="text-sm font-mono text-gray-400">{criterionId}</span>}
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-4 mb-4">
        <input
          type="text"
          placeholder="Rechercher une commune..."
          aria-label="Rechercher une commune"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 max-w-xs"
        />

        <label className={`px-4 py-2 bg-blue-600 text-white text-sm rounded-lg cursor-pointer hover:bg-blue-700 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          {uploading ? 'Upload en cours...' : 'Upload CSV'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            aria-label="Upload CSV"
            onChange={handleUpload}
            className="hidden"
          />
        </label>

        <button
          onClick={handleDeleteAll}
          className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
        >
          Tout supprimer
        </button>
      </div>

      {uploadResult && (
        <div
          className={`mb-4 p-3 text-sm rounded-lg ${
            uploadTone === 'error'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-blue-50 text-blue-700'
          }`}
        >
          {uploadResult}
        </div>
      )}

      {/* Data table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 animate-pulse">Chargement...</div>
        ) : error ? (
          <div className="p-4">
            <ErrorPanel message={error} onRetry={fetchData} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={search ? `Aucune commune ne correspond à « ${search} »` : 'Aucune donnée'}
            hint={search ? undefined : 'Chargez un CSV (colonnes commune_code, value) pour commencer.'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Commune</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Valeur</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Score</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Rang</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm text-gray-900">{row.communes?.nom ?? '—'}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 font-mono">{row.commune_code}</td>
                      <td className="px-4 py-2 text-sm text-gray-900 text-right">{Number(row.value).toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-2 text-sm text-gray-900 text-right">{row.score}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 text-right">#{Number(row.rank_national).toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">{row.source_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/*
              The footer shows unconditionally. Gating it on `totalPages > 1`
              hid the result count for any query that fit on one page, which is
              exactly when a searcher most wants to know how many matched.
            */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <div className="text-xs text-gray-500">
                {(pageData?.total ?? 0).toLocaleString('fr-FR')} résultats — Page{' '}
                {pageData?.page ?? 1}/{Math.max(1, pageData?.totalPages ?? 1)}
              </div>
              {(pageData?.totalPages ?? 1) > 1 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1 text-sm border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Précédent
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pageData?.totalPages ?? p, p + 1))}
                    disabled={page >= (pageData?.totalPages ?? 1)}
                    className="px-3 py-1 text-sm border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Suivant
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface ValueRow {
  id: string;
  commune_code: string;
  value: number;
  score: number;
  rank_national: number;
  source_date: string;
  communes: { nom: string };
}

interface PageData {
  data: ValueRow[];
  total: number;
  page: number;
  totalPages: number;
}

export default function CriterionDataPage() {
  const { criterionId } = useParams<{ criterionId: string }>();
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);

      const res = await fetch(`/api/admin/data/${criterionId}?${params}`);
      const data = await res.json();
      setPageData(data);
    } catch (e) {
      console.error('Error fetching data:', e);
    } finally {
      setLoading(false);
    }
  }, [criterionId, page, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`/api/admin/data/${criterionId}/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();

      if (res.ok) {
        setUploadResult(`Upload terminé: ${result.inserted} insérés, ${result.errors} erreurs`);
        fetchData();
      } else {
        setUploadResult(`Erreur: ${result.error}`);
      }
    } catch {
      setUploadResult('Erreur de connexion');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(`Supprimer TOUTES les données pour ${criterionId} ?`)) return;

    try {
      const res = await fetch(`/api/admin/data/${criterionId}`, { method: 'DELETE' });
      const result = await res.json();
      setUploadResult(`${result.deleted} valeurs supprimées`);
      fetchData();
    } catch {
      setUploadResult('Erreur lors de la suppression');
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/data" className="text-sm text-gray-500 hover:text-gray-700">&larr; Retour</Link>
        <h1 className="text-2xl font-semibold text-gray-900">{criterionId}</h1>
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-4 mb-4">
        <input
          type="text"
          placeholder="Rechercher une commune..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 max-w-xs"
        />

        <label className={`px-4 py-2 bg-blue-600 text-white text-sm rounded-lg cursor-pointer hover:bg-blue-700 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          {uploading ? 'Upload en cours...' : 'Upload CSV'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
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
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 text-sm rounded-lg">
          {uploadResult}
        </div>
      )}

      {/* Data table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 animate-pulse">Chargement...</div>
        ) : !pageData?.data.length ? (
          <div className="p-8 text-center text-gray-400">Aucune donnée</div>
        ) : (
          <>
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
                {pageData.data.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-900">{row.communes?.nom ?? '—'}</td>
                    <td className="px-4 py-2 text-sm text-gray-500 font-mono">{row.commune_code}</td>
                    <td className="px-4 py-2 text-sm text-gray-900 text-right">{row.value?.toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-2 text-sm text-gray-900 text-right">{row.score}</td>
                    <td className="px-4 py-2 text-sm text-gray-500 text-right">#{row.rank_national?.toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{row.source_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pageData.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                <div className="text-xs text-gray-500">
                  {pageData.total.toLocaleString('fr-FR')} résultats — Page {pageData.page}/{pageData.totalPages}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1 text-sm border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Précédent
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(pageData.totalPages, p + 1))}
                    disabled={page >= pageData.totalPages}
                    className="px-3 py-1 text-sm border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

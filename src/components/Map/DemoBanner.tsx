'use client';

import { useEffect, useState } from 'react';

/**
 * Tells the viewer, unmissably, that they are looking at the demo fixture —
 * and exactly where its numbers came from.
 *
 * A demo that shows real-looking data without saying what it is invites the
 * worst possible reading: that the pipeline is live and the coverage is
 * complete. Both are currently false. This banner names the région, says the
 * data is real open data rather than invented, and lists each criterion's
 * actual source and coverage so a claim can be checked instead of trusted.
 *
 * It self-detects: the component fetches the fixture manifest, which only
 * exists when the fixture has been built and is being served. On a real
 * Supabase-backed deployment the fetch 404s and nothing renders, so this cannot
 * mislabel live data as a demo.
 */

interface Provenance {
  status: 'real' | 'no-data';
  source?: string;
  sourceDate?: string;
  communes?: number;
  coverage?: number;
  reason?: string;
  scoredAgainst?: number;
}

interface Manifest {
  generatedAt: string;
  region: { label: string; departements: string[] };
  communeCount: number;
  criteriaShipped: string[];
  criteriaOmitted: string[];
  provenance: Record<string, Provenance>;
}

export function DemoBanner() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/fixtures/manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch(() => {
        /* not in fixture mode — render nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!manifest) return null;

  const real = Object.entries(manifest.provenance).filter(([, p]) => p.status === 'real');

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 max-w-[min(38rem,calc(100vw-2rem))]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs shadow-sm hover:bg-amber-100 transition-colors"
        aria-expanded={open}
      >
        <span className="font-semibold shrink-0">Démo</span>
        <span className="truncate">
          {manifest.region.label} · {manifest.communeCount} communes ·{' '}
          {real.length} critères en données réelles
        </span>
        <svg
          className={`w-3.5 h-3.5 ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-1 p-3 rounded-lg bg-white border border-gray-200 shadow-lg text-xs max-h-[60vh] overflow-y-auto">
          <p className="text-gray-600 mb-3 leading-snug">
            Données publiques réelles, filtrées sur {manifest.region.label}. Les scores sont
            des <strong>percentiles nationaux</strong> : un score de 30 signifie « 30ᵉ
            percentile en France », pas au sein du département.
          </p>

          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                <th className="pb-1 font-medium">Critère</th>
                <th className="pb-1 font-medium">Source</th>
                <th className="pb-1 font-medium text-right">Couverture</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {real.map(([id, p]) => (
                <tr key={id} className="border-t border-gray-100">
                  <td className="py-1 pr-2 whitespace-nowrap">{id}</td>
                  <td className="py-1 pr-2 text-gray-600">{p.source}</td>
                  <td className="py-1 text-right tabular-nums text-gray-600">
                    {p.communes}/{manifest.communeCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {manifest.criteriaOmitted.length > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-200">
              <p className="text-gray-500 leading-snug">
                <strong className="text-gray-700">Non disponibles</strong> (source
                indisponible ou données inexploitables, non simulées) :{' '}
                {manifest.criteriaOmitted.join(', ')}
              </p>
            </div>
          )}

          <p className="mt-3 pt-2 border-t border-gray-200 text-[10px] text-gray-400">
            Fixture générée le {new Date(manifest.generatedAt).toLocaleString('fr-FR')}
          </p>
        </div>
      )}
    </div>
  );
}

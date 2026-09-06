'use client';

import { useState, useCallback, useEffect, createContext, useContext, Suspense, ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Map } from 'maplibre-gl';
import type { Criterion } from '@/types/criteria';
import { useCriteria } from '@/lib/criteria';
import { Header, Sidebar } from '@/components/Layout';
import { DebugProvider } from '@/lib/debug/DebugContext';
import { DebugPanel } from '@/components/Debug/DebugPanel';

/**
 * 'single'    — one criterion at a time, the original view. Its colouring goes
 *               through interpolateColor() and the per-criterion raw-ordered
 *               palettes.
 * 'composite' — a weighted blend of several criteria, coloured by its own
 *               good-to-bad ramp. See src/lib/map/composite.ts.
 *
 * The two are separate modes rather than one merged path because the
 * single-criterion colouring is correct, load-bearing and heavily commented;
 * folding a composite into it would risk the direction bugs that code exists
 * to prevent.
 */
export type MapMode = 'single' | 'composite';

// Map context for sharing state between layout and pages
interface MapContextType {
  map: Map | null;
  setMap: (map: Map | null) => void;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
  selectedCriterion: string | null;
  setSelectedCriterion: (criterion: string | null) => void;
  activeLayers: string[];
  toggleLayer: (criterionId: string) => void;
  criteria: Record<string, Criterion> | null;
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  /**
   * criterionId -> relative importance (0 = ignored). Only ratios matter;
   * compositeScore() renormalises, so these are never forced to sum to 1.
   */
  weights: Record<string, number>;
  setWeight: (criterionId: string, weight: number) => void;
  resetWeights: () => void;
}

/**
 * Weights live in the URL, not in a database.
 *
 * US-4.1 ("Create Client Profile") wanted saved per-client weightings, and was
 * deferred with the rest of the consultant tier. A query string gets most of
 * that value for none of the cost: a weighting becomes a link you can send,
 * bookmark or reopen, with no accounts, no persistence and no schema.
 *
 * Format: ?mode=composite&w=temperature:3,propertyPrice:1
 */
function parseWeights(raw: string | null): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [id, value] = pair.split(':');
    const weight = Number(value);
    if (id && Number.isFinite(weight) && weight > 0) out[id] = weight;
  }
  return out;
}

function serializeWeights(weights: Record<string, number>): string {
  return Object.entries(weights)
    .filter(([, w]) => w > 0)
    .map(([id, w]) => `${id}:${w}`)
    .join(',');
}

const MapContext = createContext<MapContextType | null>(null);

export function useMapContext() {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error('useMapContext must be used within MapLayout');
  }
  return context;
}

/**
 * useSearchParams() opts this subtree into client-side rendering, so it must
 * sit under a Suspense boundary — hence the split between this wrapper and
 * MapLayoutInner below.
 */
export default function MapLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="h-screen" />}>
      <MapLayoutInner>{children}</MapLayoutInner>
    </Suspense>
  );
}

function MapLayoutInner({ children }: { children: ReactNode }) {
  const [darkMode, setDarkMode] = useState(false);
  const [map, setMap] = useState<Map | null>(null);
  const [activeLayers, setActiveLayers] = useState<string[]>([]);
  const [selectedCriterion, setSelectedCriterion] = useState<string | null>(null);
  const { criteria } = useCriteria();

  // Seeded from the URL in the state initializers, so a shared link opens on
  // the same weighting with no post-mount state write and no flash of the
  // default view.
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<MapMode>(() =>
    searchParams.get('mode') === 'composite' ? 'composite' : 'single'
  );
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    parseWeights(searchParams.get('w'))
  );

  // Mirror mode/weights back into the URL. replaceState rather than push: a
  // slider drag would otherwise bury the back button under dozens of entries.
  // Written directly rather than via router.replace to avoid re-running the
  // App Router's navigation for what is only a bookmarkable-state update.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const serialized = serializeWeights(weights);

    if (mode === 'composite') params.set('mode', 'composite');
    else params.delete('mode');

    if (serialized) params.set('w', serialized);
    else params.delete('w');

    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
  }, [mode, weights]);

  const setWeight = useCallback((criterionId: string, weight: number) => {
    setWeights((prev) => {
      if (weight <= 0) {
        if (!(criterionId in prev)) return prev;
        const next = { ...prev };
        delete next[criterionId];
        return next;
      }
      if (prev[criterionId] === weight) return prev;
      return { ...prev, [criterionId]: weight };
    });
  }, []);

  const resetWeights = useCallback(() => setWeights({}), []);

  const handleDarkModeToggle = useCallback((isDark: boolean) => {
    setDarkMode(isDark);
  }, []);

  const toggleLayer = useCallback((criterionId: string) => {
    setActiveLayers((prev) =>
      prev.includes(criterionId)
        ? prev.filter((id) => id !== criterionId)
        : [...prev, criterionId]
    );
  }, []);

  const contextValue: MapContextType = {
    map,
    setMap,
    darkMode,
    setDarkMode,
    selectedCriterion,
    setSelectedCriterion,
    activeLayers,
    toggleLayer,
    criteria,
    mode,
    setMode,
    weights,
    setWeight,
    resetWeights,
  };

  return (
    <MapContext.Provider value={contextValue}>
      <DebugProvider>
        <div className="flex flex-col h-screen">
          <Header onDarkModeToggle={handleDarkModeToggle} />

          <div className="flex flex-1 overflow-hidden">
            <Sidebar
              criteria={criteria}
              selectedCriterion={selectedCriterion}
              onCriterionSelect={setSelectedCriterion}
              activeLayers={activeLayers}
              onLayerToggle={toggleLayer}
              mode={mode}
              onModeChange={setMode}
              weights={weights}
              onWeightChange={setWeight}
              onResetWeights={resetWeights}
            />

            <main className="flex-1 relative">
              {children}

              {/* Active layers indicator */}
              {activeLayers.length > 0 && (
                <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-sm z-30">
                  <span className="text-muted-foreground">Couches actives: </span>
                  <span className="font-medium">{activeLayers.length}</span>
                </div>
              )}

              {/* Map status + Build version */}
              <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground z-30">
                <div>{map ? 'Carte prête' : 'Initialisation...'}</div>
                <div className="text-[10px] opacity-60 mt-1">Build: {process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString('fr-FR', { timeZone: 'UTC' }) : 'dev'}</div>
              </div>

              <DebugPanel />
            </main>
          </div>
        </div>
      </DebugProvider>
    </MapContext.Provider>
  );
}

'use client';

import { useState, useCallback, createContext, useContext, ReactNode, Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { Map } from 'maplibre-gl';
import { Header, Sidebar } from '@/components/Layout';

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
}

const MapContext = createContext<MapContextType | null>(null);

export function useMapContext() {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error('useMapContext must be used within MapLayout');
  }
  return context;
}

// Inner layout component that uses searchParams
function MapLayoutInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [darkMode, setDarkMode] = useState(false);
  const [map, setMap] = useState<Map | null>(null);
  const [activeLayers, setActiveLayers] = useState<string[]>([]);

  // Get criterion from URL or state
  const criterionFromUrl = searchParams.get('criterion');
  const [selectedCriterion, setSelectedCriterionState] = useState<string | null>(
    criterionFromUrl
  );

  // Sync criterion selection with URL
  const setSelectedCriterion = useCallback((criterion: string | null) => {
    setSelectedCriterionState(criterion);

    // Update URL with criterion parameter
    const params = new URLSearchParams(searchParams.toString());
    if (criterion) {
      params.set('criterion', criterion);
    } else {
      params.delete('criterion');
    }

    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router, searchParams]);

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
  };

  return (
    <MapContext.Provider value={contextValue}>
      <div className="flex flex-col h-screen">
        <Header onDarkModeToggle={handleDarkModeToggle} />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            selectedCriterion={selectedCriterion}
            onCriterionSelect={setSelectedCriterion}
            activeLayers={activeLayers}
            onLayerToggle={toggleLayer}
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

            {/* Map status */}
            <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground z-30">
              {map ? 'Carte prête' : 'Initialisation...'}
            </div>
          </main>
        </div>
      </div>
    </MapContext.Provider>
  );
}

// Loading fallback for Suspense
function MapLayoutFallback() {
  return (
    <div className="flex flex-col h-screen">
      <div className="h-14 border-b border-border bg-background" />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 border-r border-border bg-background" />
        <main className="flex-1 relative flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">Chargement...</span>
          </div>
        </main>
      </div>
    </div>
  );
}

// Main layout export wrapped in Suspense
export default function MapLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<MapLayoutFallback />}>
      <MapLayoutInner>{children}</MapLayoutInner>
    </Suspense>
  );
}

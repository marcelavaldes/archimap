'use client';

import { useState, useCallback, createContext, useContext, ReactNode } from 'react';
import type { Map } from 'maplibre-gl';
import { Header, Sidebar } from '@/components/Layout';
import { DebugProvider } from '@/lib/debug/DebugContext';
import { DebugPanel } from '@/components/Debug/DebugPanel';

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

export default function MapLayout({ children }: { children: ReactNode }) {
  const [darkMode, setDarkMode] = useState(false);
  const [map, setMap] = useState<Map | null>(null);
  const [activeLayers, setActiveLayers] = useState<string[]>([]);
  const [selectedCriterion, setSelectedCriterion] = useState<string | null>(null);

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
      <DebugProvider>
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

              {/* Map status + Build version */}
              <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground z-30">
                <div>{map ? 'Carte prête' : 'Initialisation...'}</div>
                <div className="text-[10px] opacity-60 mt-1">Build: 2026-02-23 22:45 UTC</div>
              </div>

              <DebugPanel />
            </main>
          </div>
        </div>
      </DebugProvider>
    </MapContext.Provider>
  );
}

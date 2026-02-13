'use client';

import { useState, useCallback } from 'react';
import type { Map } from 'maplibre-gl';
import { FranceMap } from '@/components/Map';
import { Header, Sidebar } from '@/components/Layout';

export default function Home() {
  const [darkMode, setDarkMode] = useState(false);
  const [map, setMap] = useState<Map | null>(null);
  const [selectedCriterion, setSelectedCriterion] = useState<string | null>(null);
  const [activeLayers, setActiveLayers] = useState<string[]>([]);

  const handleMapLoad = useCallback((loadedMap: Map) => {
    setMap(loadedMap);
    console.log('Map loaded successfully');
  }, []);

  const handleDarkModeToggle = useCallback((isDark: boolean) => {
    setDarkMode(isDark);
  }, []);

  const handleLayerToggle = useCallback((criterionId: string) => {
    setActiveLayers((prev) =>
      prev.includes(criterionId)
        ? prev.filter((id) => id !== criterionId)
        : [...prev, criterionId]
    );
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <Header onDarkModeToggle={handleDarkModeToggle} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          selectedCriterion={selectedCriterion}
          onCriterionSelect={setSelectedCriterion}
          activeLayers={activeLayers}
          onLayerToggle={handleLayerToggle}
        />

        <main className="flex-1 relative">
          <FranceMap
            darkMode={darkMode}
            onMapLoad={handleMapLoad}
          />

          {/* Active layers indicator */}
          {activeLayers.length > 0 && (
            <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-sm">
              <span className="text-muted-foreground">Couches actives: </span>
              <span className="font-medium">{activeLayers.length}</span>
            </div>
          )}

          {/* Map status */}
          <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground">
            {map ? 'Carte prête' : 'Initialisation...'}
          </div>
        </main>
      </div>
    </div>
  );
}

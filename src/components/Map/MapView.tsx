'use client';

import { useCallback } from 'react';
import { FranceMap } from './FranceMap';
import { useMapContext } from '@/app/map/layout';

export function MapView() {
  const { darkMode, setMap, selectedCriterion } = useMapContext();

  // Handle map load
  const handleMapLoad = useCallback((map: import('maplibre-gl').Map) => {
    setMap(map);
    console.log('[MapView] Map loaded');
  }, [setMap]);

  return (
    <FranceMap
      darkMode={darkMode}
      onMapLoad={handleMapLoad}
      selectedCriterion={selectedCriterion}
    />
  );
}

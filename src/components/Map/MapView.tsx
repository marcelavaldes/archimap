'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FranceMap } from './FranceMap';
import { useMapContext } from '@/app/map/layout';

type AdminLevelPlural = 'regions' | 'departements' | 'communes';

interface MapViewProps {
  initialLevel?: AdminLevelPlural;
  initialRegion?: { code: string; nom: string };
  initialDepartment?: { code: string; nom: string };
  initialCommune?: { code: string; nom: string; population?: number | null };
  showDetailPanel?: boolean;
}

export function MapView({
  initialLevel = 'regions',
  initialRegion,
  initialDepartment,
  initialCommune,
  showDetailPanel = false,
}: MapViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { darkMode, setMap, selectedCriterion } = useMapContext();

  // Build criterion query string
  const criterionParam = selectedCriterion ? `?criterion=${selectedCriterion}` : '';

  // Handle navigation when user clicks on a feature
  const handleNavigate = useCallback((
    level: 'region' | 'departement' | 'commune',
    code: string
  ) => {
    let path = '/map';

    switch (level) {
      case 'region':
        path = `/map/region/${code}`;
        break;
      case 'departement':
        path = `/map/department/${code}`;
        break;
      case 'commune':
        path = `/map/commune/${code}`;
        break;
    }

    // Preserve criterion in URL
    const params = new URLSearchParams(searchParams.toString());
    const queryString = params.toString() ? `?${params.toString()}` : '';

    router.push(`${path}${queryString}`);
  }, [router, searchParams]);

  // Handle map load
  const handleMapLoad = useCallback((map: import('maplibre-gl').Map) => {
    setMap(map);
  }, [setMap]);

  return (
    <FranceMap
      darkMode={darkMode}
      onMapLoad={handleMapLoad}
      selectedCriterion={selectedCriterion}
      initialLevel={initialLevel}
      initialRegion={initialRegion}
      initialDepartment={initialDepartment}
      initialCommune={initialCommune}
      showDetailPanel={showDetailPanel}
      onNavigate={handleNavigate}
    />
  );
}

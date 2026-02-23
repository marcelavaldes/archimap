'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapContext } from './layout';
import { CRITERIA } from '@/types/criteria';
import { generateColorStops } from '@/lib/map/colors';

const BUILD_TIME = '2026-02-23 23:15 UTC';

// Départements with criterion data (Hérault area for demo)
const DEMO_DEPARTEMENTS = ['34', '30', '11', '66', '09', '31', '81', '12', '48', '07'];

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [status, setStatus] = useState('Initialisation...');

  // Get criterion from context
  const { selectedCriterion, setMap } = useMapContext();

  // Build choropleth fill-color expression
  const buildFillColor = useCallback((criterionId: string | null): string | maplibregl.ExpressionSpecification => {
    const noDataColor = '#e2e8f0';
    const defaultColor = '#2196F3';

    if (!criterionId || !CRITERIA[criterionId]) {
      return defaultColor;
    }

    const criterion = CRITERIA[criterionId];
    const colorStops = generateColorStops(criterion, 10);

    return [
      'case',
      ['any',
        ['==', ['get', 'criterionScore'], null],
        ['!', ['has', 'criterionScore']],
      ],
      noDataColor,
      [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'criterionScore'], 0],
        ...colorStops.flatMap(([score, color]) => [score, color]),
      ],
    ];
  }, []);

  // Load GeoJSON layer
  const loadLayer = useCallback(async (criterionId: string | null) => {
    if (!map.current) return;

    const mapInstance = map.current;

    // Remove all existing layers/sources
    ['communes', 'regions'].forEach(sourceId => {
      if (mapInstance.getLayer(`${sourceId}-line`)) {
        mapInstance.removeLayer(`${sourceId}-line`);
      }
      if (mapInstance.getLayer(`${sourceId}-fill`)) {
        mapInstance.removeLayer(`${sourceId}-fill`);
      }
      if (mapInstance.getSource(sourceId)) {
        mapInstance.removeSource(sourceId);
      }
    });

    // If criterion selected, load communes (which have criterion data)
    // Otherwise load regions
    if (criterionId && CRITERIA[criterionId]) {
      setStatus('Chargement des communes avec critère...');

      // Load communes from multiple départements for demo
      const allFeatures: unknown[] = [];

      for (const deptCode of DEMO_DEPARTEMENTS) {
        try {
          const response = await fetch(`/api/geo/communes?parent=${deptCode}&criterion=${criterionId}`);
          if (response.ok) {
            const geojson = await response.json();
            if (geojson.features) {
              allFeatures.push(...geojson.features);
            }
          }
        } catch (e) {
          console.error(`Failed to load dept ${deptCode}:`, e);
        }
      }

      const communesGeojson = {
        type: 'FeatureCollection',
        features: allFeatures,
      };

      // Add communes source
      mapInstance.addSource('communes', {
        type: 'geojson',
        data: communesGeojson as GeoJSON.FeatureCollection,
        promoteId: 'id',
      });

      // Add fill layer with choropleth
      mapInstance.addLayer({
        id: 'communes-fill',
        type: 'fill',
        source: 'communes',
        paint: {
          'fill-color': buildFillColor(criterionId),
          'fill-opacity': 0.7,
        },
      });

      // Add line layer
      mapInstance.addLayer({
        id: 'communes-line',
        type: 'line',
        source: 'communes',
        paint: {
          'line-color': '#000',
          'line-width': 0.5,
          'line-opacity': 0.3,
        },
      });

      // Zoom to Occitanie region
      mapInstance.flyTo({
        center: [2.5, 43.5],
        zoom: 7,
        duration: 1000,
      });

      const withScore = allFeatures.filter((f: any) => f.properties?.criterionScore != null).length;
      setStatus(`${allFeatures.length} communes (${withScore} avec données) - ${CRITERIA[criterionId].name}`);

    } else {
      // No criterion - load regions
      setStatus('Chargement des régions...');

      const response = await fetch('/api/geo/regions');
      const geojson = await response.json();

      mapInstance.addSource('regions', {
        type: 'geojson',
        data: geojson,
        promoteId: 'id',
      });

      mapInstance.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': '#2196F3',
          'fill-opacity': 0.6,
        },
      });

      mapInstance.addLayer({
        id: 'regions-line',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': '#000',
          'line-width': 1,
          'line-opacity': 0.3,
        },
      });

      // Reset view to France
      mapInstance.flyTo({
        center: [2.5, 46.5],
        zoom: 5,
        duration: 1000,
      });

      setStatus(`${geojson.features?.length || 0} régions`);
    }
  }, [buildFillColor]);

  // Initialize map (only once)
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    setStatus('Création de la carte...');

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [2.5, 46.5],
      zoom: 5,
    });

    mapInstance.addControl(
      new maplibregl.NavigationControl({ showCompass: true, showZoom: true }),
      'top-right'
    );

    mapInstance.addControl(
      new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }),
      'bottom-left'
    );

    mapInstance.on('load', () => {
      map.current = mapInstance;
      setMap(mapInstance);
      setIsMapReady(true);
    });

    mapInstance.on('error', (e) => {
      setStatus('Erreur carte: ' + (e.error?.message || String(e)));
    });

    return () => {
      mapInstance.remove();
      map.current = null;
    };
  }, []); // Empty deps - only run once

  // Load/reload layer when map is ready or criterion changes
  useEffect(() => {
    if (!isMapReady) return;
    loadLayer(selectedCriterion);
  }, [isMapReady, selectedCriterion, loadLayer]);

  return (
    <div className="absolute inset-0">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Status indicator */}
      <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 z-30 shadow-sm">
        <div>{status}</div>
        <div className="text-[10px] opacity-60 mt-1">Build: {BUILD_TIME}</div>
      </div>

      {/* Legend for selected criterion */}
      {selectedCriterion && CRITERIA[selectedCriterion] && (
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-3 z-30 shadow-sm">
          <div className="text-xs font-medium mb-2">{CRITERIA[selectedCriterion].name}</div>
          <div
            className="h-3 w-32 rounded"
            style={{
              background: `linear-gradient(90deg, ${CRITERIA[selectedCriterion].colorScale.low}, ${CRITERIA[selectedCriterion].colorScale.mid}, ${CRITERIA[selectedCriterion].colorScale.high})`,
            }}
          />
          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
            <span>{CRITERIA[selectedCriterion].higherIsBetter ? 'Faible' : 'Bon'}</span>
            <span>{CRITERIA[selectedCriterion].higherIsBetter ? 'Élevé' : 'Mauvais'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapContext } from './layout';
import { CRITERIA } from '@/types/criteria';
import { generateColorStops } from '@/lib/map/colors';

const BUILD_TIME = '2026-02-23 23:00 UTC';

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

    // Build URL with criterion
    let url = '/api/geo/regions';
    if (criterionId) {
      url += `?criterion=${criterionId}`;
    }

    setStatus('Chargement des données...');

    try {
      const response = await fetch(url);
      const geojson = await response.json();

      // Remove existing layers/source if they exist
      if (mapInstance.getLayer('regions-line')) {
        mapInstance.removeLayer('regions-line');
      }
      if (mapInstance.getLayer('regions-fill')) {
        mapInstance.removeLayer('regions-fill');
      }
      if (mapInstance.getSource('regions')) {
        mapInstance.removeSource('regions');
      }

      // Add source
      mapInstance.addSource('regions', {
        type: 'geojson',
        data: geojson,
        promoteId: 'id',
      });

      // Add fill layer with choropleth
      mapInstance.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': buildFillColor(criterionId),
          'fill-opacity': 0.7,
        },
      });

      // Add line layer
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

      const criterionName = criterionId && CRITERIA[criterionId]
        ? ` - ${CRITERIA[criterionId].name}`
        : '';
      setStatus(`${geojson.features?.length || 0} régions${criterionName}`);

    } catch (error) {
      setStatus('Erreur: ' + String(error));
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

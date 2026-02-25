'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapContext } from './layout';
import { CRITERIA } from '@/types/criteria';
import { generateColorStops } from '@/lib/map/colors';
import { useDebug } from '@/lib/debug/DebugContext';

const BUILD_TIME = '2026-02-23 23:15 UTC';

// Départements with criterion data (Hérault area for demo)
const DEMO_DEPARTEMENTS = ['34', '30', '11', '66', '09', '31', '81', '12', '48', '07'];

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [status, setStatus] = useState('Initialisation...');
  const { log, updateDataQuality } = useDebug();

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

    log('MAP', 'info', `buildFillColor: ${colorStops.length} stops generated`, {
      criterionId,
      stops: colorStops,
    });

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
  }, [log]);

  // Load GeoJSON layer
  const loadLayer = useCallback(async (criterionId: string | null) => {
    if (!map.current) return;

    const mapInstance = map.current;
    const loadStart = performance.now();

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
      log('DATA', 'info', `Loading communes for criterion: ${criterionId}`, {
        departements: DEMO_DEPARTEMENTS,
      });

      // Load communes from multiple départements for demo
      const allFeatures: unknown[] = [];
      let deptsSucceeded = 0;
      let deptsFailed = 0;

      for (const deptCode of DEMO_DEPARTEMENTS) {
        const deptStart = performance.now();
        const url = `/api/geo/communes?parent=${deptCode}&criterion=${criterionId}`;
        try {
          const response = await fetch(url);
          const deptDuration = (performance.now() - deptStart).toFixed(0);

          // Read debug headers from API
          const debugFeatureCount = response.headers.get('X-Debug-Feature-Count');
          const debugEnrichedCount = response.headers.get('X-Debug-Enriched-Count');

          if (response.ok) {
            const geojson = await response.json();
            const featureCount = geojson.features?.length ?? 0;
            allFeatures.push(...(geojson.features || []));
            deptsSucceeded++;
            log('API', 'success', `Dept ${deptCode}: ${featureCount} features (${deptDuration}ms)`, {
              deptCode,
              status: response.status,
              featureCount,
              serverFeatureCount: debugFeatureCount,
              serverEnrichedCount: debugEnrichedCount,
              durationMs: deptDuration,
              url,
            });
          } else {
            deptsFailed++;
            log('API', 'error', `Dept ${deptCode}: HTTP ${response.status} (${deptDuration}ms)`, {
              deptCode,
              status: response.status,
              url,
            });
          }
        } catch (e) {
          deptsFailed++;
          log('API', 'error', `Dept ${deptCode}: network error`, {
            deptCode,
            error: String(e),
            url,
          });
        }
      }

      // Data quality analysis
      const withScore = allFeatures.filter((f: any) => f.properties?.criterionScore != null).length;
      const withValue = allFeatures.filter((f: any) => f.properties?.criterionValue != null).length;
      const loadDuration = performance.now() - loadStart;

      log('DATA', withScore > 0 ? 'success' : 'warn',
        `Data quality: ${withScore}/${allFeatures.length} have criterionScore (${withValue} have criterionValue)`, {
          totalFeatures: allFeatures.length,
          withCriterionScore: withScore,
          withCriterionValue: withValue,
          withoutScore: allFeatures.length - withScore,
          scorePercent: allFeatures.length > 0 ? ((withScore / allFeatures.length) * 100).toFixed(1) + '%' : 'N/A',
        });

      // Log sample feature for debugging field naming issues
      if (allFeatures.length > 0) {
        const sample = allFeatures[0] as any;
        log('DATA', 'info', `Sample feature properties (first commune)`, {
          featureId: sample.id,
          properties: sample.properties,
          propertyKeys: Object.keys(sample.properties || {}),
        });
      }

      updateDataQuality({
        totalFeatures: allFeatures.length,
        featuresWithScore: withScore,
        deptsFetched: DEMO_DEPARTEMENTS.length,
        deptsSucceeded,
        deptsFailed,
        lastCriterion: criterionId,
        lastLoadDurationMs: loadDuration,
      });

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

      const fillColor = buildFillColor(criterionId);

      // Add fill layer with choropleth
      mapInstance.addLayer({
        id: 'communes-fill',
        type: 'fill',
        source: 'communes',
        paint: {
          'fill-color': fillColor,
          'fill-opacity': 0.7,
        },
      });

      log('MAP', 'info', `Applied fill-color expression to communes-fill`, {
        expressionType: typeof fillColor === 'string' ? 'static' : 'expression',
        expression: fillColor,
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

      setStatus(`${allFeatures.length} communes (${withScore} avec données) - ${CRITERIA[criterionId].name}`);
      log('DATA', 'success', `Layer loaded in ${loadDuration.toFixed(0)}ms`, {
        totalFeatures: allFeatures.length,
        withScore,
        durationMs: loadDuration.toFixed(0),
      });

    } else {
      // No criterion - load regions
      setStatus('Chargement des régions...');
      log('DATA', 'info', 'Loading regions (no criterion selected)');

      try {
        const response = await fetch('/api/geo/regions');
        const geojson = await response.json();

        log('API', response.ok ? 'success' : 'error', `Regions fetch: HTTP ${response.status}, ${geojson.features?.length ?? 0} features`);

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

        const loadDuration = performance.now() - loadStart;
        setStatus(`${geojson.features?.length || 0} régions`);
        log('DATA', 'success', `Regions loaded in ${loadDuration.toFixed(0)}ms`);
      } catch (e) {
        log('ERROR', 'error', `Failed to load regions`, { error: String(e) });
      }
    }
  }, [buildFillColor, log, updateDataQuality]);

  // Initialize map (only once)
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    setStatus('Création de la carte...');
    log('MAP', 'info', 'Creating MapLibre instance');

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
      log('MAP', 'success', 'MapLibre loaded and ready');
    });

    mapInstance.on('error', (e) => {
      const msg = e.error?.message || String(e);
      setStatus('Erreur carte: ' + msg);
      log('ERROR', 'error', `MapLibre error: ${msg}`);
    });

    return () => {
      mapInstance.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load/reload layer when map is ready or criterion changes
  useEffect(() => {
    if (!isMapReady) return;
    log('STATE', 'info', `Criterion changed: ${selectedCriterion ?? '(none)'}`);
    loadLayer(selectedCriterion);
  }, [isMapReady, selectedCriterion, loadLayer, log]);

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

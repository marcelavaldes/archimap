'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapContext } from './layout';
import { generateColorStops, compositeColorStops, compositeGradientCss } from '@/lib/map/colors';
import { compositeScore } from '@/lib/map/composite';
import { useDebug } from '@/lib/debug/DebugContext';

// Départements with criterion data (Hérault area for demo)
const DEMO_DEPARTEMENTS = ['34', '30', '11', '66', '09', '31', '81', '12', '48', '07'];

/** Sources this page owns; cleared before either mode draws. */
const MANAGED_SOURCES = ['communes', 'regions', 'composite'];

interface CompositeStats {
  total: number;
  scored: number;
  meanCoverage: number;
}

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  // Starts already reflecting what the init effect below is about to do, so
  // that effect doesn't need an unconditional setState at its own top level.
  const [status, setStatus] = useState('Création de la carte...');
  const { log, updateDataQuality } = useDebug();

  // Stable refs so callbacks/effects always see latest without re-creating
  const logRef = useRef(log);
  const updateDQRef = useRef(updateDataQuality);
  useEffect(() => {
    logRef.current = log;
    updateDQRef.current = updateDataQuality;
  }, [log, updateDataQuality]);

  // Get criterion and criteria from context
  const { selectedCriterion, setMap, criteria, mode, weights } = useMapContext();

  // Composite mode caches. Geometry is the expensive payload and never varies
  // with weights, so it is fetched once; scores for every criterion are small
  // and fetched alongside it. After that a weight change is pure client-side
  // arithmetic plus setFeatureState — no network, which is what lets the
  // sliders recolour the map continuously.
  const compositeFeatures = useRef<GeoJSON.Feature[] | null>(null);
  const compositeScores = useRef<Record<string, Record<string, number>> | null>(null);
  const [compositeStats, setCompositeStats] = useState<CompositeStats | null>(null);

  // Guards against out-of-order loads, the same hazard fixed in 39412ff for
  // commune fetches: mode/criteria can change while a multi-département load is
  // still in flight, and the loser must not draw over the winner.
  const loadGeneration = useRef(0);

  // Read inside loadComposite without making it a dependency — a weight change
  // must recolour, never reload.
  const weightsRef = useRef(weights);
  useEffect(() => {
    weightsRef.current = weights;
  }, [weights]);

  const removeManagedLayers = useCallback((mapInstance: maplibregl.Map) => {
    MANAGED_SOURCES.forEach((sourceId) => {
      if (mapInstance.getLayer(`${sourceId}-line`)) mapInstance.removeLayer(`${sourceId}-line`);
      if (mapInstance.getLayer(`${sourceId}-fill`)) mapInstance.removeLayer(`${sourceId}-fill`);
      if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
    });
  }, []);

  // Build choropleth fill-color expression
  const buildFillColor = useCallback((criterionId: string | null): string | maplibregl.ExpressionSpecification => {
    const noDataColor = '#e2e8f0';
    const defaultColor = '#2196F3';

    if (!criterionId || !criteria?.[criterionId]) {
      return defaultColor;
    }

    const criterion = criteria[criterionId];
    const colorStops = generateColorStops(criterion, 10);

    logRef.current('MAP', 'info', `buildFillColor: ${colorStops.length} stops generated`, {
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
  }, [criteria]);

  // Load GeoJSON layer
  const loadLayer = useCallback(async (criterionId: string | null) => {
    if (!map.current) return;

    const mapInstance = map.current;
    const loadStart = performance.now();

    // Remove all existing layers/sources
    removeManagedLayers(mapInstance);

    // If criterion selected, load communes (which have criterion data)
    // Otherwise load regions
    if (criterionId && criteria?.[criterionId]) {
      setStatus('Chargement des communes avec critère...');
      logRef.current('DATA', 'info', `Loading communes for criterion: ${criterionId}`, {
        departements: DEMO_DEPARTEMENTS,
      });

      // Load communes from multiple départements for demo
      const allFeatures: GeoJSON.Feature[] = [];
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
            logRef.current('API', 'success', `Dept ${deptCode}: ${featureCount} features (${deptDuration}ms)`, {
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
            logRef.current('API', 'error', `Dept ${deptCode}: HTTP ${response.status} (${deptDuration}ms)`, {
              deptCode,
              status: response.status,
              url,
            });
          }
        } catch (e) {
          deptsFailed++;
          logRef.current('API', 'error', `Dept ${deptCode}: network error`, {
            deptCode,
            error: String(e),
            url,
          });
        }
      }

      // Data quality analysis
      const withScore = allFeatures.filter((f) => f.properties?.criterionScore != null).length;
      const withValue = allFeatures.filter((f) => f.properties?.criterionValue != null).length;
      const loadDuration = performance.now() - loadStart;

      logRef.current('DATA', withScore > 0 ? 'success' : 'warn',
        `Data quality: ${withScore}/${allFeatures.length} have criterionScore (${withValue} have criterionValue)`, {
          totalFeatures: allFeatures.length,
          withCriterionScore: withScore,
          withCriterionValue: withValue,
          withoutScore: allFeatures.length - withScore,
          scorePercent: allFeatures.length > 0 ? ((withScore / allFeatures.length) * 100).toFixed(1) + '%' : 'N/A',
        });

      // Log sample feature for debugging field naming issues
      if (allFeatures.length > 0) {
        const sample = allFeatures[0];
        logRef.current('DATA', 'info', `Sample feature properties (first commune)`, {
          featureId: sample.id,
          properties: sample.properties,
          propertyKeys: Object.keys(sample.properties || {}),
        });
      }

      updateDQRef.current({
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

      logRef.current('MAP', 'info', `Applied fill-color expression to communes-fill`, {
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

      setStatus(`${allFeatures.length} communes (${withScore} avec données) - ${criteria[criterionId].name}`);
      logRef.current('DATA', 'success', `Layer loaded in ${loadDuration.toFixed(0)}ms`, {
        totalFeatures: allFeatures.length,
        withScore,
        durationMs: loadDuration.toFixed(0),
      });

    } else {
      // No criterion - load regions
      setStatus('Chargement des régions...');
      logRef.current('DATA', 'info', 'Loading regions (no criterion selected)');

      try {
        const response = await fetch('/api/geo/regions');
        const geojson = await response.json();

        logRef.current('API', response.ok ? 'success' : 'error', `Regions fetch: HTTP ${response.status}, ${geojson.features?.length ?? 0} features`);

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
        logRef.current('DATA', 'success', `Regions loaded in ${loadDuration.toFixed(0)}ms`);
      } catch (e) {
        logRef.current('ERROR', 'error', `Failed to load regions`, { error: String(e) });
      }
    }
  }, [buildFillColor, criteria, removeManagedLayers]);

  /**
   * Recolour from the current weights. Pure client-side: reads the cached
   * per-criterion scores, folds them through compositeScore(), and pushes the
   * result into MapLibre feature state. No fetch, so this is safe to run on
   * every slider step.
   */
  const applyWeights = useCallback(() => {
    const mapInstance = map.current;
    const features = compositeFeatures.current;
    const scores = compositeScores.current;
    if (!mapInstance || !features || !scores || !mapInstance.getSource('composite')) return;

    let scored = 0;
    let coverageSum = 0;

    for (const feature of features) {
      const code = feature.properties?.code as string;
      if (!code) continue;

      const { score, coverage } = compositeScore(scores[code], weights);

      mapInstance.setFeatureState(
        { source: 'composite', id: code },
        {
          // `hasComposite` is carried separately because a feature-state read
          // of an unset key returns null, which an `interpolate` would coerce
          // to 0 — painting "no data" as "worst possible place".
          hasComposite: score !== null,
          composite: score ?? 0,
          coverage,
        }
      );

      if (score !== null) {
        scored++;
        coverageSum += coverage;
      }
    }

    const stats = {
      total: features.length,
      scored,
      meanCoverage: scored > 0 ? coverageSum / scored : 0,
    };
    setCompositeStats(stats);

    const active = Object.values(weights).filter((w) => w > 0).length;
    setStatus(
      active === 0
        ? `${features.length} communes — aucun critère pondéré`
        : `${scored}/${features.length} communes notées — ${active} critère${active > 1 ? 's' : ''}`
    );
    logRef.current('MAP', scored > 0 ? 'success' : 'warn', `Composite recoloured: ${scored}/${features.length} scored`, {
      weights,
      ...stats,
    });
  }, [weights]);

  /**
   * Enter composite mode: fetch geometry and every criterion's scores once,
   * then hand off to applyWeights for the colouring.
   */
  const loadComposite = useCallback(async () => {
    if (!map.current || !criteria) return;

    const mapInstance = map.current;
    const generation = ++loadGeneration.current;
    const loadStart = performance.now();

    removeManagedLayers(mapInstance);

    if (!compositeFeatures.current || !compositeScores.current) {
      setStatus('Chargement des communes et des scores...');
      const criterionIds = Object.keys(criteria);

      // Parallel, unlike the serial walk in single mode: nothing here depends
      // on the previous département's response.
      const perDept = await Promise.all(
        DEMO_DEPARTEMENTS.map(async (deptCode) => {
          try {
            const [geoRes, scoreRes] = await Promise.all([
              fetch(`/api/geo/communes?parent=${deptCode}`),
              fetch(`/api/scores?parent=${deptCode}&criteria=${criterionIds.join(',')}`),
            ]);
            if (!geoRes.ok || !scoreRes.ok) {
              logRef.current('API', 'error', `Composite dept ${deptCode}: geo ${geoRes.status} / scores ${scoreRes.status}`);
              return null;
            }
            const [geojson, scores] = await Promise.all([geoRes.json(), scoreRes.json()]);
            return {
              features: (geojson.features ?? []) as GeoJSON.Feature[],
              scores: scores as Record<string, Record<string, number>>,
            };
          } catch (e) {
            logRef.current('API', 'error', `Composite dept ${deptCode}: network error`, { error: String(e) });
            return null;
          }
        })
      );

      // A later load already started — drop this result rather than letting an
      // older response overwrite newer state.
      if (generation !== loadGeneration.current) return;

      const features: GeoJSON.Feature[] = [];
      const scores: Record<string, Record<string, number>> = {};
      let deptsSucceeded = 0;
      for (const result of perDept) {
        if (!result) continue;
        deptsSucceeded++;
        features.push(...result.features);
        Object.assign(scores, result.scores);
      }

      compositeFeatures.current = features;
      compositeScores.current = scores;

      logRef.current('DATA', features.length > 0 ? 'success' : 'error',
        `Composite data loaded: ${features.length} communes, ${Object.keys(scores).length} scored, ${deptsSucceeded}/${DEMO_DEPARTEMENTS.length} départements`,
        { durationMs: (performance.now() - loadStart).toFixed(0) });
    }

    if (generation !== loadGeneration.current || !map.current) return;

    const features = compositeFeatures.current ?? [];
    if (features.length === 0) {
      setStatus('Aucune donnée à afficher');
      return;
    }

    mapInstance.addSource('composite', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
      // `code` rather than `id`: feature state is keyed by the promoted id, and
      // properties.code is the field the API guarantees on every feature.
      promoteId: 'code',
    });

    const stops = compositeColorStops(10);

    mapInstance.addLayer({
      id: 'composite-fill',
      type: 'fill',
      source: 'composite',
      paint: {
        'fill-color': [
          'case',
          ['!=', ['feature-state', 'hasComposite'], true],
          '#e2e8f0',
          [
            'interpolate',
            ['linear'],
            ['coalesce', ['feature-state', 'composite'], 0],
            ...stops.flatMap(([score, color]) => [score, color]),
          ],
        ] as maplibregl.ExpressionSpecification,
        // Coverage is rendered as opacity, so a commune scored on two of five
        // weighted criteria reads as visibly less certain than one scored on
        // all five instead of being presented with equal confidence.
        'fill-opacity': [
          'case',
          ['!=', ['feature-state', 'hasComposite'], true],
          0.3,
          [
            'interpolate',
            ['linear'],
            ['coalesce', ['feature-state', 'coverage'], 0],
            0, 0.35,
            1, 0.8,
          ],
        ] as maplibregl.ExpressionSpecification,
      },
    });

    mapInstance.addLayer({
      id: 'composite-line',
      type: 'line',
      source: 'composite',
      paint: { 'line-color': '#000', 'line-width': 0.5, 'line-opacity': 0.25 },
    });

    mapInstance.flyTo({ center: [2.5, 43.5], zoom: 7, duration: 1000 });

    applyWeights();
  }, [criteria, removeManagedLayers, applyWeights]);

  // Initialize map (only once)
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    logRef.current('MAP', 'info', 'Creating MapLibre instance');

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
      logRef.current('MAP', 'success', 'MapLibre loaded and ready');
    });

    mapInstance.on('error', (e) => {
      const msg = e.error?.message || String(e);
      setStatus('Erreur carte: ' + msg);
      logRef.current('ERROR', 'error', `MapLibre error: ${msg}`);
    });

    return () => {
      mapInstance.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load/reload layer when map is ready or criterion changes.
  // Gated on single mode so a criterion change cannot redraw over the
  // composite layer while the weighted view is showing.
  useEffect(() => {
    if (!isMapReady || !criteria || mode !== 'single') return;
    logRef.current('STATE', 'info', `Criterion changed: ${selectedCriterion ?? '(none)'}`);
    // loadLayer sets status text as it progresses; deferring the call to a
    // microtask keeps this effect's own body free of a direct, synchronous
    // setState call while still running before the next paint.
    queueMicrotask(() => loadLayer(selectedCriterion));
  }, [isMapReady, selectedCriterion, loadLayer, criteria, mode]);

  // Enter composite mode: fetch once, then draw. Deliberately not dependent on
  // `weights` — recolouring is the separate effect below.
  useEffect(() => {
    if (!isMapReady || !criteria || mode !== 'composite') return;
    queueMicrotask(() => loadComposite());
  }, [isMapReady, criteria, mode, loadComposite]);

  // Recolour on every weight change. Runs off cached data, so dragging a
  // slider never issues a request and cannot race a load.
  useEffect(() => {
    if (!isMapReady || mode !== 'composite') return;
    applyWeights();
  }, [isMapReady, mode, weights, applyWeights]);

  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME
    ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString('fr-FR', { timeZone: 'UTC' })
    : 'dev';

  const selectedCrit = selectedCriterion && criteria?.[selectedCriterion]
    ? criteria[selectedCriterion]
    : null;

  return (
    <div className="absolute inset-0">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Status indicator */}
      <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 z-30 shadow-sm">
        <div>{status}</div>
        <div className="text-[10px] opacity-60 mt-1">Build: {buildTime}</div>
      </div>

      {/* Legend for the weighted composite */}
      {mode === 'composite' && (
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-3 z-30 shadow-sm w-56">
          <div className="text-xs font-medium mb-2">Score pondéré</div>
          <div className="h-3 w-full rounded" style={{ background: compositeGradientCss() }} />
          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
            <span>Faible</span>
            <span>Élevé</span>
          </div>

          {compositeStats && (
            <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
              <div className="flex justify-between text-[10px] text-gray-600">
                <span>Communes notées</span>
                <span className="tabular-nums">
                  {compositeStats.scored}/{compositeStats.total}
                </span>
              </div>
              {/* Coverage is a real caveat, not a detail: with partial data a
                  commune can be scored on a fraction of the weight you set. */}
              <div className="flex justify-between text-[10px] text-gray-600">
                <span>Couverture moyenne</span>
                <span className="tabular-nums">
                  {Math.round(compositeStats.meanCoverage * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500 pt-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-[#e2e8f0] border border-gray-300" />
                <span>Aucune donnée pondérée</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-snug pt-0.5">
                Les communes sans données pour tous les critères sont notées sur
                ceux qu&apos;elles possèdent, et affichées plus pâles.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Legend for selected criterion */}
      {mode === 'single' && selectedCrit && (
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-3 z-30 shadow-sm">
          <div className="text-xs font-medium mb-2">{selectedCrit.name}</div>
          <div
            className="h-3 w-32 rounded"
            style={{
              background: `linear-gradient(90deg, ${selectedCrit.colorScale.low}, ${selectedCrit.colorScale.mid}, ${selectedCrit.colorScale.high})`,
            }}
          />
          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
            <span>{selectedCrit.higherIsBetter ? 'Faible' : 'Bon'}</span>
            <span>{selectedCrit.higherIsBetter ? 'Élevé' : 'Mauvais'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

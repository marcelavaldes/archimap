'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl, { Map, NavigationControl, ScaleControl, GeoJSONSource, MapMouseEvent, MapLayerMouseEvent, LngLatBounds } from 'maplibre-gl';
import { DEFAULT_MAP_OPTIONS, BASE_MAP_STYLE, DARK_MAP_STYLE, ZOOM_THRESHOLDS, FRANCE_CENTER } from '@/lib/map/config';
import { GeoFeatureProperties, AdminLevel } from '@/types/geo';
import { CRITERIA } from '@/types/criteria';
import { generateColorStops } from '@/lib/map/colors';
import { Tooltip } from './Tooltip';
import { DetailPanel } from './DetailPanel';
import { Breadcrumb, BreadcrumbItem } from './Breadcrumb';
import { Legend } from './Legend';

type AdminLevelPlural = 'regions' | 'departements' | 'communes';

interface InitialLocation {
  code: string;
  nom: string;
  population?: number | null;
}

interface FranceMapProps {
  darkMode?: boolean;
  onMapLoad?: (map: Map) => void;
  className?: string;
  selectedCriterion?: string | null;
  // URL-based navigation props
  initialLevel?: AdminLevelPlural;
  initialRegion?: InitialLocation;
  initialDepartment?: InitialLocation;
  initialCommune?: InitialLocation;
  showDetailPanel?: boolean;
  onNavigate?: (level: 'region' | 'departement' | 'commune', code: string) => void;
}

export function FranceMap({
  darkMode = false,
  onMapLoad,
  className = '',
  selectedCriterion = null,
  initialLevel = 'regions',
  initialRegion,
  initialDepartment,
  initialCommune,
  showDetailPanel: initialShowDetailPanel = false,
  onNavigate,
}: FranceMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentLevel, setCurrentLevel] = useState<AdminLevelPlural>(initialLevel);
  const hoveredFeatureId = useRef<string | number | null>(null);
  const initialNavigationDone = useRef(false);

  // Track current parent code for navigation
  const currentParentCode = useRef<string | null>(
    initialDepartment?.code || initialRegion?.code || null
  );

  // Tooltip state
  const [tooltipFeature, setTooltipFeature] = useState<GeoFeatureProperties | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Detail panel state - initialize with commune if provided
  const [selectedFeature, setSelectedFeature] = useState<GeoFeatureProperties | null>(
    initialCommune && initialShowDetailPanel
      ? {
          id: initialCommune.code,
          code: initialCommune.code,
          nom: initialCommune.nom,
          level: 'commune' as AdminLevel,
          population: initialCommune.population ?? undefined,
        }
      : null
  );

  // Build initial breadcrumb from props
  const buildInitialBreadcrumb = (): BreadcrumbItem[] => {
    const items: BreadcrumbItem[] = [{ level: 'france', nom: 'France' }];
    if (initialRegion) {
      items.push({ level: 'region', code: initialRegion.code, nom: initialRegion.nom });
    }
    if (initialDepartment) {
      items.push({ level: 'departement', code: initialDepartment.code, nom: initialDepartment.nom });
    }
    if (initialCommune) {
      items.push({ level: 'commune', code: initialCommune.code, nom: initialCommune.nom });
    }
    return items;
  };

  // Navigation state
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>(buildInitialBreadcrumb);

  // Fetch GeoJSON data from API
  const fetchGeoJSON = useCallback(async (
    level: AdminLevelPlural,
    criterionId?: string | null,
    parentCode?: string | null,
    bbox?: string | null
  ) => {
    try {
      const params = new URLSearchParams();
      if (criterionId) {
        params.set('criterion', criterionId);
      }
      if (parentCode) {
        params.set('parent', parentCode);
      }
      if (bbox) {
        params.set('bbox', bbox);
      }

      const url = `/api/geo/${level}${params.toString() ? `?${params.toString()}` : ''}`;
      console.log(`[FranceMap] Fetching GeoJSON: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`[FranceMap] API error for ${level}:`, response.status, errorData);
        throw new Error(errorData.error || `Failed to fetch ${level} data`);
      }
      const data = await response.json();
      console.log(`[FranceMap] Fetched ${level}: ${data.features?.length || 0} features`);
      return data;
    } catch (error) {
      console.error(`[FranceMap] Error fetching ${level}:`, error);
      return null;
    }
  }, []);

  // Get feature properties from map event
  const getFeatureAtPoint = useCallback((e: MapMouseEvent): GeoFeatureProperties | null => {
    if (!map.current) return null;

    const layers = ['regions-fill', 'departements-fill', 'communes-fill'].filter(layerId => {
      return map.current?.getLayer(layerId) !== undefined;
    });

    const features = map.current.queryRenderedFeatures(e.point, { layers });

    if (features.length === 0) return null;

    const feature = features[0];
    return feature.properties as GeoFeatureProperties;
  }, []);

  // Zoom to feature bounds
  const zoomToFeature = useCallback((featureCode: string, sourceId: string) => {
    if (!map.current) return;

    const source = map.current.getSource(sourceId) as GeoJSONSource;
    if (!source) return;

    // Query features from the source
    const features = map.current.querySourceFeatures(sourceId, {
      filter: ['==', ['get', 'code'], featureCode]
    });

    if (features.length === 0) return;

    const bounds = new LngLatBounds();

    features.forEach(f => {
      if (f.geometry.type === 'Polygon') {
        f.geometry.coordinates[0].forEach((coord: number[]) => {
          bounds.extend([coord[0], coord[1]]);
        });
      } else if (f.geometry.type === 'MultiPolygon') {
        f.geometry.coordinates.forEach((polygon: number[][][]) => {
          polygon[0].forEach((coord: number[]) => {
            bounds.extend([coord[0], coord[1]]);
          });
        });
      }
    });

    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, {
        padding: 50,
        duration: 1000,
      });
    }
  }, []);

  // Build choropleth fill-color expression for MapLibre
  const buildFillColor = useCallback((criterionId: string | null): maplibregl.ExpressionSpecification => {
    const noDataColor = '#e2e8f0'; // Gray for missing data
    const hoverColor = '#4CAF50';
    const defaultColor = '#2196F3';

    // If no criterion selected, use simple hover/default colors
    if (!criterionId || !CRITERIA[criterionId]) {
      return [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        hoverColor,
        defaultColor,
      ];
    }

    const criterion = CRITERIA[criterionId];
    const colorStops = generateColorStops(criterion, 10);

    // Build interpolate expression with null check
    // ['case', ['==', ['get', 'criterionScore'], null], noDataColor, interpolate...]
    const interpolateExpr: maplibregl.ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'criterionScore'], -1],
      ...colorStops.flatMap(([score, color]) => [score, color]),
    ];

    return [
      'case',
      // Hover state takes priority
      ['boolean', ['feature-state', 'hover'], false],
      hoverColor,
      // No data (null or missing criterionScore)
      ['any',
        ['==', ['get', 'criterionScore'], null],
        ['!', ['has', 'criterionScore']],
      ],
      noDataColor,
      // Use choropleth interpolation
      interpolateExpr,
    ];
  }, []);

  // Add or update GeoJSON layer
  const updateGeoJSONLayer = useCallback(async (
    level: AdminLevelPlural,
    criterionId?: string | null,
    parentCode?: string | null
  ) => {
    console.log(`[FranceMap] updateGeoJSONLayer called: level=${level}, criterion=${criterionId}, parent=${parentCode}`);
    console.log(`[FranceMap] map.current exists: ${!!map.current}`);

    if (!map.current) {
      console.error('[FranceMap] updateGeoJSONLayer: map.current is null!');
      return;
    }

    // Update current parent code
    if (parentCode !== undefined) {
      currentParentCode.current = parentCode;
    }

    // For communes, require parent code (departement) to prevent timeout
    const geojson = await fetchGeoJSON(level, criterionId, level === 'communes' ? (parentCode ?? currentParentCode.current) : parentCode);
    if (!geojson) {
      console.error('[FranceMap] updateGeoJSONLayer: No GeoJSON data received');
      return;
    }
    console.log(`[FranceMap] GeoJSON received: ${geojson.features?.length} features`);

    const sourceId = `${level}-source`;
    const layerId = `${level}-fill`;
    const lineLayerId = `${level}-line`;
    const highlightLayerId = `${level}-highlight`;

    // Remove existing layers if they exist
    if (map.current.getLayer(highlightLayerId)) {
      map.current.removeLayer(highlightLayerId);
    }
    if (map.current.getLayer(lineLayerId)) {
      map.current.removeLayer(lineLayerId);
    }
    if (map.current.getLayer(layerId)) {
      map.current.removeLayer(layerId);
    }
    if (map.current.getSource(sourceId)) {
      map.current.removeSource(sourceId);
    }

    // Add source
    console.log(`[FranceMap] Adding source: ${sourceId}`);
    map.current.addSource(sourceId, {
      type: 'geojson',
      data: geojson,
      promoteId: 'id',
    });

    // Add fill layer with choropleth coloring
    console.log(`[FranceMap] Adding fill layer: ${layerId}, minzoom: ${ZOOM_THRESHOLDS[level].min}, maxzoom: ${ZOOM_THRESHOLDS[level].max}`);
    map.current.addLayer({
      id: layerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': buildFillColor(criterionId ?? null),
        'fill-opacity': 0.6,
      },
      minzoom: ZOOM_THRESHOLDS[level].min,
      maxzoom: ZOOM_THRESHOLDS[level].max,
    });
    console.log(`[FranceMap] Layer ${layerId} added successfully`);

    // Add line layer for boundaries
    map.current.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': darkMode ? '#ffffff' : '#000000',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5, 0.5,
          10, 1.5,
        ],
        'line-opacity': 0.3,
      },
      minzoom: ZOOM_THRESHOLDS[level].min,
      maxzoom: ZOOM_THRESHOLDS[level].max,
    });

    // Add highlight layer
    map.current.addLayer({
      id: highlightLayerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#FFC107',
        'line-width': 2,
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          1,
          0,
        ],
      },
      minzoom: ZOOM_THRESHOLDS[level].min,
      maxzoom: ZOOM_THRESHOLDS[level].max,
    });

    // Setup hover interactions for feature state
    const mouseEnterHandler = (e: MapLayerMouseEvent) => {
      if (!map.current) return;

      if (e.features && e.features.length > 0) {
        map.current.getCanvas().style.cursor = 'pointer';

        if (hoveredFeatureId.current !== null) {
          map.current.setFeatureState(
            { source: sourceId, id: hoveredFeatureId.current },
            { hover: false }
          );
        }

        const feature = e.features[0];
        hoveredFeatureId.current = feature.id ?? null;

        if (hoveredFeatureId.current !== null) {
          map.current.setFeatureState(
            { source: sourceId, id: hoveredFeatureId.current },
            { hover: true }
          );
        }
      }
    };

    const mouseLeaveHandler = () => {
      if (!map.current) return;

      map.current.getCanvas().style.cursor = '';

      if (hoveredFeatureId.current !== null) {
        map.current.setFeatureState(
          { source: sourceId, id: hoveredFeatureId.current },
          { hover: false }
        );
        hoveredFeatureId.current = null;
      }
    };

    map.current.on('mouseenter', layerId, mouseEnterHandler);
    map.current.on('mouseleave', layerId, mouseLeaveHandler);
  }, [darkMode, buildFillColor, fetchGeoJSON]);

  // Handle click navigation
  const handleClick = useCallback((e: MapMouseEvent) => {
    const feature = getFeatureAtPoint(e);

    if (!feature || !map.current) return;

    const { level, code, nom } = feature;

    // If onNavigate is provided, use URL-based navigation
    if (onNavigate && level !== 'commune') {
      onNavigate(level as 'region' | 'departement', code);
      return;
    }

    if (level === 'region') {
      // Zoom to region and load departements for this region
      zoomToFeature(code, 'regions-source');
      setBreadcrumb([
        { level: 'france', nom: 'France' },
        { level: 'region', code, nom }
      ]);

      // Load departements filtered by this region
      setCurrentLevel('departements');
      updateGeoJSONLayer('departements', selectedCriterion, code);
    } else if (level === 'departement') {
      // Zoom to departement and load communes for this departement
      zoomToFeature(code, 'departements-source');
      setBreadcrumb(prev => {
        const regionItem = prev.find(item => item.level === 'region');
        return [
          { level: 'france', nom: 'France' },
          ...(regionItem ? [regionItem] : []),
          { level: 'departement', code, nom }
        ];
      });

      // Load communes filtered by this departement
      setCurrentLevel('communes');
      updateGeoJSONLayer('communes', selectedCriterion, code);
    } else if (level === 'commune') {
      // For communes, navigate via URL if available, otherwise open detail panel
      if (onNavigate) {
        onNavigate('commune', code);
      } else {
        setSelectedFeature(feature);
      }
    }
  }, [getFeatureAtPoint, zoomToFeature, selectedCriterion, updateGeoJSONLayer, onNavigate]);

  // Handle breadcrumb navigation
  const handleBreadcrumbNavigate = useCallback((index: number) => {
    if (!map.current) return;

    const item = breadcrumb[index];

    if (item.level === 'france') {
      // Reset to France view
      map.current.flyTo({
        center: FRANCE_CENTER,
        zoom: DEFAULT_MAP_OPTIONS.zoom,
        duration: 1000,
      });
      setBreadcrumb([{ level: 'france', nom: 'France' }]);
      setCurrentLevel('regions');
      currentParentCode.current = null;
      updateGeoJSONLayer('regions', selectedCriterion, null);
    } else if (item.level === 'region' && item.code) {
      // Navigate to region - show departements
      setBreadcrumb(breadcrumb.slice(0, index + 1));
      zoomToFeature(item.code, 'regions-source');
      setCurrentLevel('departements');
      updateGeoJSONLayer('departements', selectedCriterion, item.code);
    } else if (item.level === 'departement' && item.code) {
      // Navigate to departement - show communes
      setBreadcrumb(breadcrumb.slice(0, index + 1));
      zoomToFeature(item.code, 'departements-source');
      setCurrentLevel('communes');
      updateGeoJSONLayer('communes', selectedCriterion, item.code);
    }
  }, [breadcrumb, zoomToFeature, selectedCriterion, updateGeoJSONLayer]);

  // Handle mouse move for tooltip
  const handleMouseMove = useCallback((e: MapMouseEvent) => {
    const feature = getFeatureAtPoint(e);

    if (feature) {
      setTooltipFeature(feature);
      setTooltipPosition({ x: e.point.x, y: e.point.y });
    } else {
      setTooltipFeature(null);
    }
  }, [getFeatureAtPoint]);

  // Determine which level to show based on zoom
  const determineLevel = (zoom: number): AdminLevelPlural => {
    if (zoom < ZOOM_THRESHOLDS.departements.min) return 'regions';
    if (zoom < ZOOM_THRESHOLDS.communes.min) return 'departements';
    return 'communes';
  };

  // Handle zoom changes - only update regions/departements, communes require explicit navigation
  const handleZoomChange = useCallback(() => {
    if (!map.current) return;

    const zoom = map.current.getZoom();
    const newLevel = determineLevel(zoom);

    // Only auto-switch for regions and departements
    // Communes require explicit click navigation with parent code
    if (newLevel !== currentLevel) {
      if (newLevel === 'regions') {
        setCurrentLevel('regions');
        currentParentCode.current = null;
        updateGeoJSONLayer('regions', selectedCriterion);
      } else if (newLevel === 'departements' && currentLevel === 'regions') {
        // Zooming from regions to departements - load all departements
        setCurrentLevel('departements');
        updateGeoJSONLayer('departements', selectedCriterion);
      }
      // Don't auto-load communes on zoom - they require parent code
    }
  }, [currentLevel, updateGeoJSONLayer, selectedCriterion]);

  // Initialize map
  useEffect(() => {
    console.log('[FranceMap] Map init useEffect running');
    console.log(`[FranceMap] mapContainer.current: ${!!mapContainer.current}, map.current: ${!!map.current}`);

    if (!mapContainer.current || map.current) {
      console.log('[FranceMap] Skipping map init - already exists or no container');
      return;
    }

    const style = darkMode ? DARK_MAP_STYLE : BASE_MAP_STYLE;
    console.log('[FranceMap] Creating map with style:', style.name);

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style,
      ...DEFAULT_MAP_OPTIONS,
    });

    // Add navigation controls
    map.current.addControl(
      new NavigationControl({ showCompass: true, showZoom: true }),
      'top-right'
    );

    // Add scale control
    map.current.addControl(
      new ScaleControl({ maxWidth: 100, unit: 'metric' }),
      'bottom-left'
    );

    map.current.on('load', () => {
      console.log('[FranceMap] Map "load" event fired');
      console.log(`[FranceMap] Map zoom: ${map.current?.getZoom()}, center: ${map.current?.getCenter()}`);
      setIsLoaded(true);
      if (onMapLoad && map.current) {
        onMapLoad(map.current);
      }
    });

    map.current.on('error', (e) => {
      console.error('[FranceMap] Map error:', e);
    });

    // Listen for zoom changes
    map.current.on('zoom', handleZoomChange);

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Load initial layer when map becomes ready
  useEffect(() => {
    console.log(`[FranceMap] Initial layer useEffect: isLoaded=${isLoaded}, map.current=${!!map.current}, initialNavigationDone=${initialNavigationDone.current}`);

    if (!map.current || !isLoaded) {
      console.log('[FranceMap] Skipping initial layer load - map not ready');
      return;
    }
    if (initialNavigationDone.current) {
      console.log('[FranceMap] Skipping initial layer load - already done');
      return;
    }

    initialNavigationDone.current = true;
    console.log('[FranceMap] Loading initial layer...');

    const loadInitialLayer = async () => {
      try {
        // Load the appropriate layer based on initial navigation state
        if (initialDepartment) {
          console.log(`[FranceMap] Loading communes for department: ${initialDepartment.code}`);
          await updateGeoJSONLayer('communes', selectedCriterion, initialDepartment.code);
          // Zoom to department after layer loads
          setTimeout(() => {
            if (map.current) {
              zoomToFeature(initialDepartment.code, 'communes-source');
            }
          }, 500);
        } else if (initialRegion) {
          console.log(`[FranceMap] Loading departements for region: ${initialRegion.code}`);
          await updateGeoJSONLayer('departements', selectedCriterion, initialRegion.code);
          // Zoom to region after layer loads
          setTimeout(() => {
            if (map.current) {
              zoomToFeature(initialRegion.code, 'departements-source');
            }
          }, 500);
        } else {
          console.log('[FranceMap] Loading regions (default)');
          await updateGeoJSONLayer('regions', selectedCriterion);
        }
        console.log('[FranceMap] Initial layer loaded successfully');
      } catch (error) {
        console.error('[FranceMap] Error loading initial layer:', error);
      }
    };

    loadInitialLayer();
  }, [isLoaded, initialDepartment, initialRegion, selectedCriterion, updateGeoJSONLayer, zoomToFeature]);

  // Setup global map event listeners
  useEffect(() => {
    if (!map.current || !isLoaded) return;

    map.current.on('mousemove', handleMouseMove);
    map.current.on('click', handleClick);

    return () => {
      if (map.current) {
        map.current.off('mousemove', handleMouseMove);
        map.current.off('click', handleClick);
      }
    };
  }, [isLoaded, handleMouseMove, handleClick]);

  // Handle dark mode changes
  useEffect(() => {
    if (!map.current || !isLoaded) return;

    const style = darkMode ? DARK_MAP_STYLE : BASE_MAP_STYLE;
    map.current.setStyle(style);

    // Re-add layers after style change
    map.current.once('styledata', async () => {
      await updateGeoJSONLayer(currentLevel, selectedCriterion);
    });
  }, [darkMode, isLoaded, currentLevel, updateGeoJSONLayer, selectedCriterion]);

  // Handle criterion changes - reload layer with new criterion data
  useEffect(() => {
    if (!map.current || !isLoaded) return;

    // Re-fetch and re-render the current level with the new criterion
    // Pass existing parent code for communes level
    updateGeoJSONLayer(currentLevel, selectedCriterion, currentParentCode.current);
  }, [selectedCriterion, isLoaded, currentLevel, updateGeoJSONLayer]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* Breadcrumb navigation */}
      {isLoaded && (
        <div className="absolute top-0 left-0 right-0 z-20">
          <Breadcrumb items={breadcrumb} onNavigate={handleBreadcrumbNavigate} />
        </div>
      )}

      {/* Map container */}
      <div ref={mapContainer} className="absolute inset-0" />

      {/* Loading indicator */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">Chargement de la carte...</span>
          </div>
        </div>
      )}

      {/* Debug info - current level and state */}
      {isLoaded && (
        <div className="absolute top-20 left-4 bg-background/90 backdrop-blur-sm px-3 py-2 rounded-md shadow-md text-xs z-10 space-y-1">
          <div><span className="font-medium">Niveau:</span> {currentLevel}</div>
          <div><span className="font-medium">Map:</span> {map.current ? 'OK' : 'NULL'}</div>
          <div><span className="font-medium">Loaded:</span> {isLoaded ? 'Yes' : 'No'}</div>
        </div>
      )}

      {/* Legend */}
      <Legend criterionId={selectedCriterion} />

      {/* Tooltip */}
      <Tooltip
        feature={tooltipFeature}
        x={tooltipPosition.x}
        y={tooltipPosition.y}
        criterionId={selectedCriterion}
      />

      {/* Detail panel */}
      <DetailPanel
        feature={selectedFeature}
        onClose={() => setSelectedFeature(null)}
        criterionId={selectedCriterion}
      />
    </div>
  );
}

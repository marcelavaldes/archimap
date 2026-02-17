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

interface FranceMapProps {
  darkMode?: boolean;
  onMapLoad?: (map: Map) => void;
  className?: string;
  selectedCriterion?: string | null;
}

type AdminLevelPlural = 'regions' | 'departements' | 'communes';

export function FranceMap({ darkMode = false, onMapLoad, className = '', selectedCriterion = null }: FranceMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentLevel, setCurrentLevel] = useState<AdminLevelPlural>('regions');
  const hoveredFeatureId = useRef<string | number | null>(null);

  // Tooltip state
  const [tooltipFeature, setTooltipFeature] = useState<GeoFeatureProperties | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Detail panel state
  const [selectedFeature, setSelectedFeature] = useState<GeoFeatureProperties | null>(null);

  // Navigation state
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([
    { level: 'france', nom: 'France' }
  ]);

  // Fetch GeoJSON data from API
  const fetchGeoJSON = async (level: AdminLevelPlural, criterionId?: string | null) => {
    try {
      let url = `/api/geo/${level}`;
      if (criterionId) {
        url += `?criterion=${encodeURIComponent(criterionId)}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${level} data`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching ${level}:`, error);
      return null;
    }
  };

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

  // Handle click navigation
  const handleClick = useCallback((e: MapMouseEvent) => {
    const feature = getFeatureAtPoint(e);

    if (!feature || !map.current) return;

    const { level, code, nom } = feature;

    if (level === 'region') {
      // Zoom to region and prepare to load departements
      zoomToFeature(code, 'regions-source');
      setBreadcrumb([
        { level: 'france', nom: 'France' },
        { level: 'region', code, nom }
      ]);

      // TODO: Load departements for this region
      console.log('Load departements for region:', code);
    } else if (level === 'departement') {
      // Zoom to departement and prepare to load communes
      zoomToFeature(code, 'departements-source');
      setBreadcrumb(prev => {
        const regionItem = prev.find(item => item.level === 'region');
        return [
          { level: 'france', nom: 'France' },
          ...(regionItem ? [regionItem] : []),
          { level: 'departement', code, nom }
        ];
      });

      // TODO: Load communes for this departement
      console.log('Load communes for departement:', code);
    } else if (level === 'commune') {
      // Open detail panel
      setSelectedFeature(feature);
    }
  }, [getFeatureAtPoint, zoomToFeature]);

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
    } else {
      // Navigate to that level
      setBreadcrumb(breadcrumb.slice(0, index + 1));

      if (item.code) {
        // Zoom to the selected item
        const sourceId = item.level === 'region' ? 'regions-source' : 'departements-source';
        zoomToFeature(item.code, sourceId);
      }
    }
  }, [breadcrumb, zoomToFeature]);

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
  const updateGeoJSONLayer = useCallback(async (level: AdminLevelPlural, criterionId?: string | null) => {
    if (!map.current) return;

    const geojson = await fetchGeoJSON(level, criterionId);
    if (!geojson) return;

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
    map.current.addSource(sourceId, {
      type: 'geojson',
      data: geojson,
      promoteId: 'id',
    });

    // Add fill layer with choropleth coloring
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
  }, [darkMode, buildFillColor]);

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

  // Handle zoom changes
  const handleZoomChange = useCallback(() => {
    if (!map.current) return;

    const zoom = map.current.getZoom();
    const newLevel = determineLevel(zoom);

    if (newLevel !== currentLevel) {
      setCurrentLevel(newLevel);
      updateGeoJSONLayer(newLevel, selectedCriterion);
    }
  }, [currentLevel, updateGeoJSONLayer, selectedCriterion]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const style = darkMode ? DARK_MAP_STYLE : BASE_MAP_STYLE;

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

    map.current.on('load', async () => {
      setIsLoaded(true);

      // Load initial regions layer
      await updateGeoJSONLayer('regions', selectedCriterion);

      if (onMapLoad && map.current) {
        onMapLoad(map.current);
      }
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
    updateGeoJSONLayer(currentLevel, selectedCriterion);
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

      {/* Current level indicator */}
      {isLoaded && (
        <div className="absolute top-20 left-4 bg-background/90 backdrop-blur-sm px-3 py-2 rounded-md shadow-md text-sm z-10">
          <span className="font-medium">Niveau:</span> {currentLevel}
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

import type { MapOptions } from 'maplibre-gl';

// France bounding box and center
export const FRANCE_BOUNDS: [[number, number], [number, number]] = [
  [-5.5, 41.2], // Southwest: near Spain
  [9.8, 51.5],  // Northeast: near Belgium
];

export const FRANCE_CENTER: [number, number] = [2.2137, 46.2276];

export const DEFAULT_ZOOM = 5;

// Zoom levels for administrative boundaries
export const ZOOM_THRESHOLDS = {
  regions: { min: 0, max: 6 },
  departements: { min: 6, max: 9 },
  communes: { min: 9, max: 18 },
};

// Free tile sources
export const TILE_SOURCES = {
  // OpenStreetMap Carto (free, no key required)
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  // Stadia Maps free tier
  stadiaAlidadeSmooth: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png',
  stadiaAlidadeSmoothDark: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png',
  // CartoCDN (free for limited use)
  cartoLight: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  cartoDark: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
};

export const DEFAULT_MAP_OPTIONS: Partial<MapOptions> = {
  center: FRANCE_CENTER,
  zoom: DEFAULT_ZOOM,
  minZoom: 4,
  maxZoom: 18,
  maxBounds: [
    [-10, 38], // Southwest with padding
    [15, 54],  // Northeast with padding
  ],
  attributionControl: {},
};

// Base map style (minimal style without data layers)
export const BASE_MAP_STYLE = {
  version: 8 as const,
  name: 'ArchiMap Base',
  sources: {
    'osm-tiles': {
      type: 'raster' as const,
      tiles: [TILE_SOURCES.cartoLight],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster' as const,
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

// Dark mode style
export const DARK_MAP_STYLE = {
  ...BASE_MAP_STYLE,
  name: 'ArchiMap Dark',
  sources: {
    'osm-tiles': {
      type: 'raster' as const,
      tiles: [TILE_SOURCES.cartoDark],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
};

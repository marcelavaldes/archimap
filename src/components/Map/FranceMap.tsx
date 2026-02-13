'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map, NavigationControl, ScaleControl } from 'maplibre-gl';
import { DEFAULT_MAP_OPTIONS, BASE_MAP_STYLE, DARK_MAP_STYLE } from '@/lib/map/config';

interface FranceMapProps {
  darkMode?: boolean;
  onMapLoad?: (map: Map) => void;
  className?: string;
}

export function FranceMap({ darkMode = false, onMapLoad, className = '' }: FranceMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

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

    map.current.on('load', () => {
      setIsLoaded(true);
      if (onMapLoad && map.current) {
        onMapLoad(map.current);
      }
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Handle dark mode changes
  useEffect(() => {
    if (!map.current || !isLoaded) return;

    const style = darkMode ? DARK_MAP_STYLE : BASE_MAP_STYLE;
    map.current.setStyle(style);
  }, [darkMode, isLoaded]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div ref={mapContainer} className="absolute inset-0" />
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">Chargement de la carte...</span>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

const BUILD_TIME = '2026-02-23 22:50 UTC';

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [status, setStatus] = useState('Initialisation...');

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    setStatus('Création de la carte...');

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [2.5, 46.5],
      zoom: 5,
    });

    map.current.addControl(
      new maplibregl.NavigationControl({ showCompass: true, showZoom: true }),
      'top-right'
    );

    map.current.addControl(
      new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }),
      'bottom-left'
    );

    map.current.on('load', async () => {
      setStatus('Chargement des données...');

      try {
        const response = await fetch('/api/geo/regions');
        const geojson = await response.json();

        if (!map.current) return;

        setStatus(`${geojson.features?.length || 0} régions chargées`);

        map.current.addSource('regions', {
          type: 'geojson',
          data: geojson,
          promoteId: 'id',
        });

        map.current.addLayer({
          id: 'regions-fill',
          type: 'fill',
          source: 'regions',
          paint: {
            'fill-color': '#2196F3',
            'fill-opacity': 0.6,
          },
        });

        map.current.addLayer({
          id: 'regions-line',
          type: 'line',
          source: 'regions',
          paint: {
            'line-color': '#000',
            'line-width': 1,
            'line-opacity': 0.3,
          },
        });

        setStatus('Carte prête - ' + (geojson.features?.length || 0) + ' régions');
      } catch (error) {
        setStatus('Erreur: ' + String(error));
      }
    });

    map.current.on('error', (e) => {
      setStatus('Erreur carte: ' + (e.error?.message || String(e)));
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Status indicator */}
      <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 z-30 shadow-sm">
        <div>{status}</div>
        <div className="text-[10px] opacity-60 mt-1">Build: {BUILD_TIME}</div>
      </div>
    </div>
  );
}

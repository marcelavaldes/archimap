'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function TestPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [status, setStatus] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      setStatus('Creating map...');

      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [2.5, 46.5],
        zoom: 5,
      });

      map.current.on('load', async () => {
        setStatus('Map loaded, fetching data...');

        try {
          const response = await fetch('/api/geo/regions');
          const geojson = await response.json();

          if (!map.current) return;

          setStatus(`Got ${geojson.features?.length || 0} features, adding layer...`);

          map.current.addSource('regions', {
            type: 'geojson',
            data: geojson,
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
            },
          });

          setStatus('SUCCESS: Map with ' + (geojson.features?.length || 0) + ' regions');
        } catch (fetchError) {
          setError('Fetch error: ' + String(fetchError));
          setStatus('FAILED');
        }
      });

      map.current.on('error', (e) => {
        setError('Map error: ' + e.error?.message || String(e));
      });

    } catch (initError) {
      setError('Init error: ' + String(initError));
      setStatus('FAILED');
    }

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col">
      <div className="p-4 bg-gray-100 border-b">
        <h1 className="text-xl font-bold">MapLibre Test Page</h1>
        <p className="text-sm">Status: <span className={status.includes('SUCCESS') ? 'text-green-600' : status.includes('FAILED') ? 'text-red-600' : 'text-blue-600'}>{status}</span></p>
        {error && <p className="text-sm text-red-600">Error: {error}</p>}
      </div>
      <div ref={mapContainer} className="flex-1" />
    </div>
  );
}

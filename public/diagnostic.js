/**
 * ArchiMap Diagnostic Script
 * Run this in the browser console to debug the black map issue
 *
 * Usage:
 * 1. Open https://archimap-eight.vercel.app/map
 * 2. Open DevTools Console (F12)
 * 3. Paste this entire script and press Enter
 */

(async function archiMapDiagnostic() {
  console.clear();
  console.log('%c🔍 ArchiMap Diagnostic Tool', 'font-size: 20px; font-weight: bold; color: #4ec9b0;');
  console.log('%c' + '='.repeat(60), 'color: #666;');
  console.log('');

  const results = {
    timestamp: new Date().toISOString(),
    environment: {},
    mapLibre: {},
    dom: {},
    api: {},
    network: {},
    errors: []
  };

  // Helper functions
  const logSection = (title) => {
    console.log('');
    console.log('%c' + title, 'font-size: 16px; font-weight: bold; color: #dcdcaa;');
    console.log('%c' + '-'.repeat(60), 'color: #666;');
  };

  const logSuccess = (message) => {
    console.log('%c✅ ' + message, 'color: #4ec9b0;');
  };

  const logError = (message) => {
    console.log('%c❌ ' + message, 'color: #f48771;');
    results.errors.push(message);
  };

  const logWarning = (message) => {
    console.log('%c⚠️  ' + message, 'color: #dcdcaa;');
  };

  const logInfo = (message) => {
    console.log('%c   ' + message, 'color: #9cdcfe;');
  };

  // 1. Environment Check
  logSection('1. Environment Check');

  results.environment = {
    userAgent: navigator.userAgent,
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    pixelRatio: window.devicePixelRatio
  };

  logInfo(`URL: ${results.environment.url}`);
  logInfo(`Viewport: ${results.environment.viewport.width}x${results.environment.viewport.height}`);
  logInfo(`Pixel Ratio: ${results.environment.pixelRatio}`);

  // 2. MapLibre GL Check
  logSection('2. MapLibre GL Library');

  if (typeof window.maplibregl !== 'undefined') {
    logSuccess('MapLibre GL is loaded');
    results.mapLibre.loaded = true;
    results.mapLibre.version = window.maplibregl.version || 'unknown';
    logInfo(`Version: ${results.mapLibre.version}`);

    // Check WebGL support
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      logSuccess('WebGL is supported');
      results.mapLibre.webgl = true;
      logInfo(`Renderer: ${gl.getParameter(gl.RENDERER)}`);
    } else {
      logError('WebGL is NOT supported - this will prevent the map from rendering!');
      results.mapLibre.webgl = false;
    }
  } else {
    logError('MapLibre GL is NOT loaded');
    results.mapLibre.loaded = false;
  }

  // 3. DOM Elements Check
  logSection('3. DOM Elements');

  // Check map container
  const mapContainer = document.querySelector('[class*="mapContainer"]') ||
                       document.querySelector('.relative.w-full.h-full');

  if (mapContainer) {
    logSuccess('Map container found');
    const rect = mapContainer.getBoundingClientRect();
    results.dom.container = {
      exists: true,
      width: rect.width,
      height: rect.height,
      display: getComputedStyle(mapContainer).display,
      position: getComputedStyle(mapContainer).position
    };

    logInfo(`Dimensions: ${rect.width}x${rect.height}`);
    logInfo(`Display: ${results.dom.container.display}`);
    logInfo(`Position: ${results.dom.container.position}`);

    if (rect.width === 0 || rect.height === 0) {
      logError('Container has zero dimensions! This will prevent map rendering.');
    }
  } else {
    logError('Map container NOT found');
    results.dom.container = { exists: false };
  }

  // Check MapLibre canvas
  const canvas = document.querySelector('.maplibregl-canvas');
  if (canvas) {
    logSuccess('MapLibre canvas found');
    results.dom.canvas = {
      exists: true,
      width: canvas.width,
      height: canvas.height,
      style: {
        width: canvas.style.width,
        height: canvas.style.height
      }
    };
    logInfo(`Canvas size: ${canvas.width}x${canvas.height}`);
    logInfo(`Canvas style: ${canvas.style.width} x ${canvas.style.height}`);
  } else {
    logWarning('MapLibre canvas NOT found (might not be initialized yet)');
    results.dom.canvas = { exists: false };
  }

  // Check for MapLibre map instance
  const mapElement = document.querySelector('[class*="mapContainer"]');
  if (mapElement && mapElement._maplibreMap) {
    logSuccess('MapLibre map instance found');
    results.mapLibre.instance = true;
    logInfo(`Map loaded: ${mapElement._maplibreMap.loaded()}`);
  }

  // 4. API Check
  logSection('4. API Endpoints');

  try {
    logInfo('Testing /api/geo/regions...');
    const response = await fetch('/api/geo/regions');
    results.api.regions = {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type')
    };

    if (response.ok) {
      const data = await response.json();
      results.api.regions.featureCount = data.features?.length || 0;

      if (results.api.regions.featureCount > 0) {
        logSuccess(`Regions API working: ${results.api.regions.featureCount} features`);
        results.api.regions.sampleFeature = data.features[0];
        logInfo(`Sample region: ${data.features[0]?.properties?.nom}`);

        // Validate GeoJSON structure
        const firstFeature = data.features[0];
        if (firstFeature.type === 'Feature' &&
            firstFeature.geometry &&
            firstFeature.properties) {
          logSuccess('GeoJSON structure is valid');
          results.api.regions.validStructure = true;
        } else {
          logError('Invalid GeoJSON structure');
          results.api.regions.validStructure = false;
        }
      } else {
        logError('Regions API returned 0 features!');
      }
    } else {
      logError(`Regions API failed: ${response.status}`);
    }
  } catch (error) {
    logError(`API test failed: ${error.message}`);
    results.api.error = error.message;
  }

  // 5. Console Log Analysis
  logSection('5. Console Logs');

  logInfo('Looking for [FranceMap] logs in console history...');
  logWarning('Note: This script cannot read past console logs.');
  logInfo('Please manually check for [FranceMap] logs above.');

  // Set up console interceptor for future logs
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];

  console.log = function(...args) {
    const message = args.map(a =>
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ');

    if (message.includes('[FranceMap]')) {
      logs.push({ type: 'log', message, timestamp: Date.now() });
    }
    originalLog.apply(console, args);
  };

  console.error = function(...args) {
    const message = args.map(a =>
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ');

    logs.push({ type: 'error', message, timestamp: Date.now() });
    originalError.apply(console, args);
  };

  logSuccess('Console interceptor installed for future [FranceMap] logs');
  results.consoleInterceptor = true;

  // 6. Network Performance
  logSection('6. Network Performance');

  if (window.performance && window.performance.getEntriesByType) {
    const resources = window.performance.getEntriesByType('resource');
    const geoRequests = resources.filter(r => r.name.includes('/api/geo/'));

    if (geoRequests.length > 0) {
      logSuccess(`Found ${geoRequests.length} geo API requests`);
      geoRequests.forEach(req => {
        const url = new URL(req.name);
        logInfo(`${url.pathname}: ${req.duration.toFixed(2)}ms`);
      });
      results.network.requests = geoRequests.map(r => ({
        url: r.name,
        duration: r.duration,
        size: r.transferSize
      }));
    } else {
      logWarning('No geo API requests found in performance data');
      results.network.requests = [];
    }
  }

  // 7. Summary and Recommendations
  logSection('7. Summary & Recommendations');

  const issues = [];

  if (!results.mapLibre.loaded) {
    issues.push('MapLibre GL library not loaded');
  }

  if (results.mapLibre.webgl === false) {
    issues.push('WebGL not supported (CRITICAL - map cannot render)');
  }

  if (results.dom.container && (results.dom.container.width === 0 || results.dom.container.height === 0)) {
    issues.push('Map container has zero dimensions');
  }

  if (!results.dom.canvas?.exists) {
    issues.push('MapLibre canvas not initialized');
  }

  if (results.api.regions && results.api.regions.featureCount === 0) {
    issues.push('Regions API returned no features');
  }

  if (!results.api.regions?.ok) {
    issues.push('Regions API request failed');
  }

  if (issues.length === 0) {
    logSuccess('No critical issues detected!');
    logInfo('');
    logInfo('If the map is still black, check:');
    logInfo('  • Look for [FranceMap] error logs above');
    logInfo('  • Check Network tab for failed tile requests');
    logInfo('  • Verify base map tiles are loading from CartoCDN');
    logInfo('  • Check if layers are added with correct zoom levels');
  } else {
    logError(`Found ${issues.length} issue(s):`);
    issues.forEach(issue => {
      logError(`  • ${issue}`);
    });
  }

  // 8. Export Results
  logSection('8. Diagnostic Results');

  console.log('Full diagnostic results:', results);
  logInfo('');
  logInfo('To export results, run:');
  logInfo('  JSON.stringify(archiMapDiagnosticResults, null, 2)');
  logInfo('');

  window.archiMapDiagnosticResults = results;

  console.log('%c' + '='.repeat(60), 'color: #666;');
  console.log('%c✅ Diagnostic complete!', 'font-size: 16px; color: #4ec9b0;');
  console.log('%cResults saved to: window.archiMapDiagnosticResults', 'color: #9cdcfe;');
  console.log('');

  return results;
})();

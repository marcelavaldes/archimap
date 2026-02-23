# ArchiMap Debugging Guide - Black Map Issue

## 🔍 Issue Summary
The map appears completely black (no features visible) at https://archimap-eight.vercel.app/map

## ✅ What I Tested (2026-02-23)

### API Endpoints Status
| Endpoint | Status | Features | Notes |
|----------|--------|----------|-------|
| `/api/geo/regions` | ✅ 200 | 13 | All France regions loading correctly |
| `/api/geo/departements` | ✅ 200 | 96 | All départements loading correctly |
| `/api/geo/communes?parent=01` | ✅ 200 | 266 | Communes data exists (tested with Ain) |
| `/api/geo/communes` (no parent) | ⚠️ 400 | N/A | Expected error - requires parent code |

### Region Data Confirmed
All 13 French regions are present:
- 11: Île-de-France
- 24: Centre-Val de Loire
- 27: Bourgogne-Franche-Comté
- 28: Normandie
- 32: Hauts-de-France
- 44: Grand Est
- 52: Pays de la Loire
- 53: Bretagne
- 75: Nouvelle-Aquitaine
- 76: Occitanie
- 84: Auvergne-Rhône-Alpes
- 93: Provence-Alpes-Côte d'Azur
- 94: Corse

## 🐛 Likely Causes of Black Map

### 1. **MapLibre GL Initialization Issue**
The map container or MapLibre library might not be initializing properly.

**Check in Browser Console:**
```javascript
// Open DevTools Console (F12) and run:
console.log(window.maplibregl);
```

Expected: Should show MapLibre GL object, not `undefined`

### 2. **Console Errors**
Look for `[FranceMap]` debug logs in the browser console.

**Expected Flow:**
```
[FranceMap] Map init useEffect running
[FranceMap] Creating map with style: ArchiMap Base
[FranceMap] Map "load" event fired
[FranceMap] Initial layer useEffect: isLoaded=true
[FranceMap] Loading regions (default)
[FranceMap] Fetching GeoJSON: /api/geo/regions
[FranceMap] Fetched regions: 13 features
[FranceMap] Adding source: regions-source
[FranceMap] Adding fill layer: regions-fill
```

### 3. **CSS/Styling Issue**
The map container might have incorrect dimensions or z-index issues.

**Check in Browser Console:**
```javascript
// Check map container dimensions
const container = document.querySelector('.absolute.inset-0');
console.log('Container dimensions:', {
  width: container?.offsetWidth,
  height: container?.offsetHeight,
  display: getComputedStyle(container).display
});
```

### 4. **MapLibre Style Not Loading**
The base map tiles might not be loading from CartoCDN.

**Base tile source:** `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`

### 5. **Layer Visibility/Zoom Issue**
The map might be at the wrong zoom level or the layers have incorrect minzoom/maxzoom.

**Current zoom thresholds:**
- Regions: zoom 0-6
- Départements: zoom 6-9
- Communes: zoom 9-18

Default zoom: 5 (should show regions)

## 🔧 Manual Browser Debugging Steps

### Step 1: Open Browser DevTools
1. Navigate to: https://archimap-eight.vercel.app/map
2. Press F12 (or Ctrl+Shift+I)
3. Go to Console tab

### Step 2: Check for Errors
Look for:
- ❌ Red error messages
- ⚠️ Yellow warnings
- 🔍 `[FranceMap]` debug logs

### Step 3: Test API Directly in Console
```javascript
// Test regions API
fetch('/api/geo/regions')
  .then(r => r.json())
  .then(d => console.log('Regions:', d.features?.length, 'features'))
  .catch(e => console.error('API Error:', e));
```

Expected output: `Regions: 13 features`

### Step 4: Check Network Tab
1. Go to Network tab in DevTools
2. Filter by: `geo`
3. Look for `/api/geo/regions` request
4. Check:
   - Status: Should be 200
   - Response: Should contain 13 features
   - Time: Should be < 5 seconds

### Step 5: Check Elements Tab
1. Go to Elements tab
2. Find the map container: `<div class="absolute inset-0">`
3. Check computed styles:
   - Width and height should be > 0
   - Position should be absolute
   - Should have a canvas child element from MapLibre

### Step 6: Check MapLibre Canvas
```javascript
// Find the MapLibre canvas
const canvas = document.querySelector('.maplibregl-canvas');
console.log('Canvas:', {
  exists: !!canvas,
  width: canvas?.width,
  height: canvas?.height,
  context: canvas?.getContext('2d')
});
```

## 🛠️ Quick Fixes to Try

### Fix 1: Hard Refresh
Press `Ctrl + Shift + R` (Windows/Linux) or `Cmd + Shift + R` (Mac)

### Fix 2: Clear Cache
1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

### Fix 3: Check Browser Console
Open DevTools Console and paste this diagnostic:
```javascript
console.log('=== ArchiMap Diagnostic ===');
console.log('MapLibre GL:', typeof window.maplibregl);
console.log('Map Container:', document.querySelector('[class*="mapContainer"]'));
console.log('Canvas:', document.querySelector('.maplibregl-canvas'));

// Test API
fetch('/api/geo/regions')
  .then(r => r.json())
  .then(d => {
    console.log('✅ API Working:', d.features?.length, 'regions');
    console.log('Sample region:', d.features[0]?.properties);
  })
  .catch(e => console.error('❌ API Error:', e));
```

### Fix 4: Use Debug HTML Tool
Open the debug tool at: `https://archimap-eight.vercel.app/debug-map.html`
(Note: Upload the `debug-map.html` file to your deployment first)

## 🔍 Advanced Debugging

### Check Supabase Connection
The API uses Supabase. Verify environment variables are set in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Check Database Functions
The API calls: `supabase.rpc('get_geojson_by_level', ...)`

This function must exist in your Supabase database.

### Verify MapLibre GL CSS
Check that MapLibre GL CSS is loaded:
```javascript
// Check for MapLibre styles
const styles = Array.from(document.styleSheets)
  .map(s => s.href)
  .filter(h => h?.includes('maplibre'));
console.log('MapLibre styles:', styles);
```

## 📊 Expected Console Output (Working Map)

```
[FranceMap] Map init useEffect running
[FranceMap] mapContainer.current: true, map.current: false
[FranceMap] Creating map with style: ArchiMap Base
[FranceMap] Map "load" event fired
[FranceMap] Map zoom: 5, center: LngLat(2.2137, 46.2276)
[FranceMap] Initial layer useEffect: isLoaded=true, map.current=true
[FranceMap] Loading initial layer...
[FranceMap] Loading regions (default)
[FranceMap] updateGeoJSONLayer called: level=regions, criterion=null, parent=null
[FranceMap] map.current exists: true
[FranceMap] Fetching GeoJSON: /api/geo/regions
[FranceMap] Fetched regions: 13 features
[FranceMap] GeoJSON received: 13 features
[FranceMap] Adding source: regions-source
[FranceMap] Adding fill layer: regions-fill, minzoom: 0, maxzoom: 6
[FranceMap] Layer regions-fill added successfully
[FranceMap] Initial layer loaded successfully
```

## 🎯 Most Likely Issues (Priority Order)

1. **MapLibre GL not loaded** - Check if `maplibre-gl` package is properly imported
2. **Container dimensions** - Map container has zero height/width
3. **Base map tiles failing** - CartoCDN tiles not loading (network issue)
4. **Style not loading** - MapLibre style object has errors
5. **Canvas rendering** - WebGL context issues

## 📝 Information to Provide

When reporting the issue, please provide:

1. **Browser Console Errors** - Any red errors
2. **[FranceMap] Logs** - All console logs starting with [FranceMap]
3. **Network Tab** - Screenshot of `/api/geo/regions` request
4. **Canvas Element** - Does it exist? What are its dimensions?
5. **Browser Info** - Browser name, version, OS

## 🚀 Next Steps

1. Open https://archimap-eight.vercel.app/map
2. Open DevTools (F12)
3. Run the diagnostic script from "Fix 3" above
4. Copy all console output
5. Check Network tab for `/api/geo/regions` request
6. Report findings

---

**Last Updated:** 2026-02-23
**Tested By:** Perplexity-Researcher Agent
**API Status:** ✅ All endpoints working correctly
**Data Status:** ✅ 13 regions, 96 départements, communes data verified

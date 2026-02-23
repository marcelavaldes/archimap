# ArchiMap - AgentSim Test Profile

## Application Overview

French territorial analysis platform. Interactive choropleth maps showing quality-of-life criteria across regions, departements, and communes of France.

- **Production URL:** https://archimap-eight.vercel.app
- **Stack:** Next.js 16.1.6 (App Router, Edge Runtime), React 19, MapLibre GL 5.18, Supabase (PostGIS), Tailwind CSS 4, Recharts 3
- **Package manager:** bun

## Routes & Pages

| Route | Type | Description |
|-------|------|-------------|
| `/` | Redirect | Redirects to `/map` |
| `/map` | Client | Main map page — simplified inline MapLibre init, criteria selection via sidebar context |
| `/map/region/[code]` | Server + Client | Region deep-link (metadata works, map zoom not wired yet) |
| `/map/department/[code]` | Server + Client | Department deep-link (metadata works, map zoom not wired yet) |
| `/map/commune/[insee]` | Server + Client | Commune deep-link (metadata works, map zoom not wired yet) |
| `/test` | Client | Standalone MapLibre debug page — no sidebar/header |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/geo/regions` | GET | GeoJSON FeatureCollection of 13 French regions |
| `/api/geo/departements?parent={regionCode}` | GET | GeoJSON departements, optionally filtered by region |
| `/api/geo/communes?parent={deptCode}` | GET | GeoJSON communes for a departement (parent required) |
| `/api/geo/communes?bbox=minLng,minLat,maxLng,maxLat` | GET | Spatial viewport query for communes |
| `/api/geo/{level}?criterion={id}` | GET | Enriches features with criterionValue, criterionScore, criterionRank |
| `/api/commune/{inseeCode}` | GET | Full commune detail with all criteria values |
| `/api/search?q={term}` | GET | Fuzzy commune search (min 2 chars, max 20 results, pg_trgm) |

## Test Scenarios

### 1. Map Renders (Critical Path)

**Goal:** Verify the map loads and shows France with colored regions.

- Navigate to `/map`
- Wait for MapLibre canvas to appear (check for `<canvas>` inside map container)
- Verify status indicator shows "13 régions" (bottom-right corner)
- Verify 13 blue polygons are visible (France metropolitan regions)
- Verify NavigationControl (zoom +/- buttons) appears top-right
- Verify ScaleControl appears bottom-left

### 2. Sidebar Criteria Selection

**Goal:** Verify selecting a criterion reloads the map with choropleth colors.

- Click "Climat" category in sidebar (should be expanded by default)
- Click "Température moyenne" criterion
- Wait for status to update — should show commune count + criterion name
- Verify map zooms to Occitanie region (lat ~43.5)
- Verify polygons change from flat blue to multi-color gradient
- Verify legend appears bottom-left with gradient bar and criterion name
- Click same criterion again to deselect
- Verify map returns to blue regions view at France zoom level

**Available criteria with data:** `localTax`, `culturalVenues`, `internetSpeed`
**Criteria without data (will show gray):** `temperature`, `sunshine`, `rainfall`, `propertyPrice`, `hospitalAccess`, `publicTransport`, `crimeRate`, `employmentRate`, `medianIncome`

### 3. Sidebar Category Accordion

**Goal:** Verify accordion expand/collapse behavior.

- "Climat" category should be expanded by default
- Click "Coût de la vie" — should expand, "Climat" should collapse
- Click "Coût de la vie" again — should collapse (nothing expanded)
- Verify each category contains its criteria:
  - Climat: Température, Ensoleillement, Précipitations
  - Coût de la vie: Prix immobilier, Taxe foncière
  - Services: Accès hôpital, Transport en commun, Débit internet
  - Qualité de vie: Taux de criminalité, Équipements culturels
  - Emploi: Taux d'emploi, Revenu médian

### 4. Dark Mode Toggle

**Goal:** Verify dark mode button toggles theme.

- Click moon icon in header (top-right area)
- Icon should switch to sun
- `document.documentElement` should have `.dark` class
- Click sun icon to switch back
- Note: CSS theme doesn't fully respond to `.dark` class (known gap — only `prefers-color-scheme` works). Map tiles DO change in FranceMap component.

### 5. API: Regions GeoJSON

**Goal:** Verify API returns valid GeoJSON.

- `GET /api/geo/regions`
- Response: 200, Content-Type: application/json
- Body: `{ "type": "FeatureCollection", "features": [...] }`
- `features.length === 13`
- Each feature has: `id`, `type: "Feature"`, `geometry` (MultiPolygon), `properties.code`, `properties.nom`, `properties.level === "region"`
- Cache-Control header: `public, max-age=3600, stale-while-revalidate=86400`

### 6. API: Communes with Criterion

**Goal:** Verify criterion enrichment works.

- `GET /api/geo/communes?parent=34&criterion=localTax`
- Response: 200
- Features should include `properties.criterionValue`, `properties.criterionScore`, `properties.criterionRank` for communes that have data
- Some communes may have null values (no data)

### 7. API: Communes Require Parent or BBox

**Goal:** Verify the safety guard against timeouts.

- `GET /api/geo/communes` (no parent, no bbox)
- Response: 400
- Body: `{ "error": "Communes level requires either \"parent\" ... or \"bbox\" ..." }`

### 8. API: Search

**Goal:** Verify fuzzy commune search.

- `GET /api/search?q=montpel`
- Response: 200
- Body: `{ "results": [...] }` — should include Montpellier
- Each result: `{ code, nom, code_departement, nom_departement, lng, lat }`
- `GET /api/search?q=a` → 400 (min 2 chars)

### 9. API: Commune Detail

**Goal:** Verify single commune endpoint.

- `GET /api/commune/34172` (Montpellier)
- Response: 200
- Body includes: `code`, `nom`, `population`, `departement.code`, `departement.nom`, `region.code`, `region.nom`, `criteria` object
- `GET /api/commune/99999` → 404

### 10. API: Invalid Level

**Goal:** Verify input validation.

- `GET /api/geo/invalid`
- Response: 400
- Body: `{ "error": "Invalid level. Must be one of: regions, departements, communes" }`

### 11. Deep-Link Pages (Metadata Only)

**Goal:** Verify server-side metadata generation.

- `GET /map/region/76` — HTML should contain `<title>` with "Occitanie"
- `GET /map/department/34` — HTML should contain `<title>` with "Hérault"
- `GET /map/commune/34172` — HTML should contain `<title>` with "Montpellier"
- Map renders but does NOT zoom to the entity (known limitation)

### 12. Test Page

**Goal:** Verify standalone map debug page works.

- Navigate to `/test`
- No sidebar or header should be visible
- Status should progress: "Initializing..." → "Creating map..." → "Map loaded..." → "SUCCESS: Map with 13 regions"
- MapLibre canvas should render with blue regions

## UI Component Inventory

| Component | Location | Status |
|-----------|----------|--------|
| Header | Top bar | Working — title, dark mode toggle, search placeholder |
| Sidebar | Left panel (w-72) | Working — accordion, criterion select, detail card |
| Map (inline) | Main area | Working — regions + commune choropleth |
| FranceMap | Used by deep-link pages | Working but drill-down navigation bypassed on /map |
| SearchBar | Not mounted | Built but header shows placeholder instead |
| Breadcrumb | Inside FranceMap | Only visible on deep-link pages |
| Tooltip | Inside FranceMap | Only visible on deep-link pages |
| DetailPanel | Inside FranceMap | Only visible on deep-link pages |
| Legend (inline) | Bottom-left of /map | Shows when criterion selected |
| CriteriaRadar | Inside DetailPanel | Recharts radar chart for commune |

## Known Limitations

1. **Search not wired** — SearchBar component exists but Header renders a placeholder "Recherche (bientôt)"
2. **Deep-link pages don't zoom** — `/map/region/76` renders full map, doesn't focus on Occitanie
3. **Criterion data only in Occitanie** — Departements 34, 30, 11, 66, 09, 31, 81, 12, 48, 07 have data
4. **activeLayers checkbox is cosmetic** — tracked in context but map only uses selectedCriterion
5. **Dark mode CSS gap** — toggle sets `.dark` class but CSS uses `prefers-color-scheme` media query
6. **No automated tests** — only `/test` browser debug page exists

## Environment

- **Supabase:** Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`
- **Vercel:** Deployed to cdg1 (Paris) region
- **No API keys** needed for map tiles (CartoCDN public)

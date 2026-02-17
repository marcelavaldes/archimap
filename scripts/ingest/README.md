# ArchiMap Data Ingestion Scripts

## Overview

This directory contains scripts for ingesting French geographic data (regions, departements, communes) into the ArchiMap Supabase database with PostGIS geometries.

## Scripts

### `geo.ts`
Ingests regions and departements from the official geo.api.gouv.fr API. This was used for the initial Phase 1 setup.

### `generate-communes-sql.ts`
Downloads the simplified communes GeoJSON (~50MB) from gregoiredavid/france-geojson and generates batched SQL files for insertion into Supabase.

**Key Features:**
- Downloads all 35,228 communes from the source GeoJSON
- Filters to metropolitan France only (matches departements in database)
- Fetches departement→region mapping from geo.api.gouv.fr
- Generates 71 SQL batch files (500 communes each)
- Converts geometries to MultiPolygon using ST_Multi()
- Includes code_region directly in INSERT (no separate update needed)

**Usage:**
```bash
bun run scripts/ingest/generate-communes-sql.ts
```

### `execute-communes-sql.sh`
Bash script that executes all generated SQL batch files sequentially via psql.

**Usage:**
```bash
bash scripts/ingest/execute-communes-sql.sh
```

## Database Coverage

After successful ingestion:

- **Regions:** 13 (metropolitan France)
- **Départements:** 95 (metropolitan France, includes 2A and 2B for Corsica)
- **Communes:** 22,000 (metropolitan France only)

The ~13,000 communes not loaded are overseas territories (Guadeloupe, Martinique, Guyane, Réunion, Mayotte) whose départements are not included in the metropolitan France database.

## Data Sources

- **Regions & Départements:** https://geo.api.gouv.fr (official French government API)
- **Communes GeoJSON:** https://github.com/gregoiredavid/france-geojson (simplified version for performance)

## Notes

- All geometries are stored as MultiPolygon in SRID 4326 (WGS84)
- The simplified GeoJSON reduces file size while maintaining sufficient detail for choropleth maps
- Each commune includes: code, nom, code_departement, code_region, geometry, and auto-generated centroid
- Population and superficie fields are present but not populated by the GeoJSON source (can be added later from official data)

## Verification

To verify the ingestion:

```sql
-- Check total counts
SELECT COUNT(*) as total_communes,
       COUNT(DISTINCT code_region) as regions,
       COUNT(DISTINCT code_departement) as departements
FROM communes;

-- Check geometry validity
SELECT COUNT(*) FROM communes WHERE geometry IS NOT NULL;

-- Sample communes with all fields
SELECT code, nom, code_departement, code_region,
       ST_GeometryType(geometry) as geom_type,
       ST_NumGeometries(geometry) as num_parts
FROM communes
WHERE code IN ('75056', '13055', '33063', '69123')
ORDER BY code;
```

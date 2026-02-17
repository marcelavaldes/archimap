/**
 * Communes GeoJSON Batch SQL Generator
 *
 * Downloads the simplified communes GeoJSON (~50MB) and generates
 * batched SQL files for insertion into Supabase with PostGIS geometries.
 *
 * Source: https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson
 *
 * Usage: bun run scripts/ingest/generate-communes-sql.ts
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

interface CommuneProperties {
  code: string;
  nom: string;
  // We'll derive departement from the code
}

interface CommuneFeature {
  type: 'Feature';
  properties: CommuneProperties;
  geometry: GeoJSON.Geometry;
}

interface CommunesGeoJSON {
  type: 'FeatureCollection';
  features: CommuneFeature[];
}

const SOURCE_URL =
  'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson';
const BATCH_SIZE = 500;
const OUTPUT_DIR = join(process.cwd(), 'scripts/ingest/sql');

/**
 * Extract departement code from commune code
 * Most communes: first 2 digits (e.g., 01001 -> 01)
 * Corsica: first 2 chars (e.g., 2A001 -> 2A)
 */
function extractDepartementCode(communeCode: string): string {
  if (communeCode.startsWith('2A') || communeCode.startsWith('2B')) {
    return communeCode.substring(0, 2);
  }
  return communeCode.substring(0, 2);
}

/**
 * Generate SQL INSERT statement with PostGIS geometry conversion
 */
function generateInsertSQL(features: CommuneFeature[], deptToRegion: Map<string, string>): string {
  const values: string[] = [];

  for (const feature of features) {
    const { code, nom } = feature.properties;
    const codeDepartement = extractDepartementCode(code);
    const codeRegion = deptToRegion.get(codeDepartement);

    if (!codeRegion) {
      console.warn(`  Warning: No region found for departement ${codeDepartement} (commune ${code})`);
      continue;
    }

    // Escape single quotes in names
    const escapedNom = nom.replace(/'/g, "''");

    // Convert geometry to GeoJSON string for ST_GeomFromGeoJSON
    const geomJSON = JSON.stringify(feature.geometry);
    const escapedGeomJSON = geomJSON.replace(/'/g, "''");

    // Use ST_Multi to ensure MultiPolygon type, wrapped in try-catch equivalent
    values.push(
      `('${code}', '${escapedNom}', '${codeDepartement}', '${codeRegion}', ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('${escapedGeomJSON}'), 4326)))`
    );
  }

  const sql = `
-- Batch INSERT for communes
-- Generated: ${new Date().toISOString()}

INSERT INTO communes (code, nom, code_departement, code_region, geometry)
VALUES
${values.join(',\n')}
ON CONFLICT (code) DO UPDATE SET
  nom = EXCLUDED.nom,
  code_departement = EXCLUDED.code_departement,
  code_region = EXCLUDED.code_region,
  geometry = EXCLUDED.geometry;
`;

  return sql;
}


async function main(): Promise<void> {
  console.log('ArchiMap Communes SQL Generator');
  console.log('================================\n');

  console.log('Step 1: Fetching departement -> region mapping from database...');

  // Fetch departement -> region mapping
  const DB_URL = 'postgresql://postgres:M1cK6C9f7dLjkxBi@db.jquglrlwicryiajgfbel.supabase.co:5432/postgres';

  const deptResponse = await fetch('https://geo.api.gouv.fr/departements?fields=code,codeRegion');
  const departements: Array<{ code: string; codeRegion: string }> = await deptResponse.json();

  const deptToRegion = new Map<string, string>();
  for (const dept of departements) {
    deptToRegion.set(dept.code, dept.codeRegion);
  }

  console.log(`  Loaded ${deptToRegion.size} departement mappings`);

  console.log('Step 2: Downloading communes GeoJSON...');
  console.log(`Source: ${SOURCE_URL}`);

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  console.log('Step 3: Parsing GeoJSON (this may take a moment)...');
  const geojson: CommunesGeoJSON = await response.json();

  console.log(`Step 4: Found ${geojson.features.length} communes`);

  // Create output directory
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Generate batch SQL files
  const totalBatches = Math.ceil(geojson.features.length / BATCH_SIZE);
  console.log(`Step 5: Generating ${totalBatches} SQL batch files...`);

  for (let i = 0; i < totalBatches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, geojson.features.length);
    const batch = geojson.features.slice(start, end);

    const sql = generateInsertSQL(batch, deptToRegion);
    const filename = join(OUTPUT_DIR, `communes-batch-${String(i + 1).padStart(3, '0')}.sql`);

    await writeFile(filename, sql, 'utf-8');
    console.log(`  Generated batch ${i + 1}/${totalBatches} (${batch.length} communes)`);
  }

  console.log('\nStep 6: SQL files ready for execution');
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log('\nNext steps:');
  console.log('Execute batch files with: bash scripts/ingest/execute-communes-sql.sh');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

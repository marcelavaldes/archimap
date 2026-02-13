/**
 * Generate SQL for importing French geographic data
 *
 * Downloads data from france-geojson GitHub repo and generates SQL files
 * that can be executed in Supabase SQL Editor.
 *
 * Usage: bun run scripts/ingest/generate-sql.ts
 */

import { writeFileSync, mkdirSync } from 'fs';

const OUTPUT_DIR = 'scripts/ingest/sql';

const GEOJSON_BASE = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master';

interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    code: string;
    nom: string;
    [key: string]: unknown;
  };
  geometry: GeoJSON.Geometry;
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function fetchJSON<T>(url: string): Promise<T> {
  console.log(`  Downloading ${url.split('/').pop()}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

async function generateRegionsSQL(): Promise<string> {
  console.log('Fetching regions GeoJSON...');

  const data = await fetchJSON<GeoJSONCollection>(
    `${GEOJSON_BASE}/regions-version-simplifiee.geojson`
  );

  console.log(`Found ${data.features.length} regions`);

  let sql = `-- Regions of France
-- Generated: ${new Date().toISOString()}
-- Source: github.com/gregoiredavid/france-geojson

SET search_path TO public, extensions;

`;

  // Metro France region codes
  const metroRegionCodes = ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94'];

  for (const feature of data.features) {
    const code = feature.properties.code;
    if (!metroRegionCodes.includes(code)) continue;

    const nom = feature.properties.nom;
    const geojson = JSON.stringify(feature.geometry);

    sql += `INSERT INTO regions (code, nom, geometry) VALUES (
  '${code}',
  '${escapeSql(nom)}',
  ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('${escapeSql(geojson)}'), 4326))
) ON CONFLICT (code) DO UPDATE SET
  nom = EXCLUDED.nom,
  geometry = EXCLUDED.geometry,
  updated_at = NOW();

`;
  }

  return sql;
}

async function generateDepartementsSQL(): Promise<string> {
  console.log('Fetching departements GeoJSON...');

  const data = await fetchJSON<GeoJSONCollection>(
    `${GEOJSON_BASE}/departements-version-simplifiee.geojson`
  );

  console.log(`Found ${data.features.length} departements`);

  let sql = `-- Departements of France
-- Generated: ${new Date().toISOString()}
-- Source: github.com/gregoiredavid/france-geojson

SET search_path TO public, extensions;

`;

  for (const feature of data.features) {
    const code = feature.properties.code;

    // Metro France departements: 01-95, 2A, 2B
    if (code !== '2A' && code !== '2B') {
      const num = parseInt(code, 10);
      if (isNaN(num) || num < 1 || num > 95) continue;
    }

    const nom = feature.properties.nom;
    // Need to get code_region from the API or hardcode it
    const codeRegion = getRegionForDepartement(code);
    const geojson = JSON.stringify(feature.geometry);

    sql += `INSERT INTO departements (code, nom, code_region, geometry) VALUES (
  '${code}',
  '${escapeSql(nom)}',
  '${codeRegion}',
  ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('${escapeSql(geojson)}'), 4326))
) ON CONFLICT (code) DO UPDATE SET
  nom = EXCLUDED.nom,
  code_region = EXCLUDED.code_region,
  geometry = EXCLUDED.geometry,
  updated_at = NOW();

`;
  }

  return sql;
}

// Mapping departement codes to region codes (2016 regions)
function getRegionForDepartement(deptCode: string): string {
  const mapping: Record<string, string> = {
    // Île-de-France (11)
    '75': '11', '77': '11', '78': '11', '91': '11', '92': '11', '93': '11', '94': '11', '95': '11',
    // Centre-Val de Loire (24)
    '18': '24', '28': '24', '36': '24', '37': '24', '41': '24', '45': '24',
    // Bourgogne-Franche-Comté (27)
    '21': '27', '25': '27', '39': '27', '58': '27', '70': '27', '71': '27', '89': '27', '90': '27',
    // Normandie (28)
    '14': '28', '27': '28', '50': '28', '61': '28', '76': '28',
    // Hauts-de-France (32)
    '02': '32', '59': '32', '60': '32', '62': '32', '80': '32',
    // Grand Est (44)
    '08': '44', '10': '44', '51': '44', '52': '44', '54': '44', '55': '44', '57': '44', '67': '44', '68': '44', '88': '44',
    // Pays de la Loire (52)
    '44': '52', '49': '52', '53': '52', '72': '52', '85': '52',
    // Bretagne (53)
    '22': '53', '29': '53', '35': '53', '56': '53',
    // Nouvelle-Aquitaine (75)
    '16': '75', '17': '75', '19': '75', '23': '75', '24': '75', '33': '75', '40': '75', '47': '75', '64': '75', '79': '75', '86': '75', '87': '75',
    // Occitanie (76)
    '09': '76', '11': '76', '12': '76', '30': '76', '31': '76', '32': '76', '34': '76', '46': '76', '48': '76', '65': '76', '66': '76', '81': '76', '82': '76',
    // Auvergne-Rhône-Alpes (84)
    '01': '84', '03': '84', '07': '84', '15': '84', '26': '84', '38': '84', '42': '84', '43': '84', '63': '84', '69': '84', '73': '84', '74': '84',
    // Provence-Alpes-Côte d'Azur (93)
    '04': '93', '05': '93', '06': '93', '13': '93', '83': '93', '84': '93',
    // Corse (94)
    '2A': '94', '2B': '94',
  };
  return mapping[deptCode] || '00';
}

async function main() {
  console.log('ArchiMap SQL Generator');
  console.log('=====================\n');

  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Generate regions SQL
  const regionsSQL = await generateRegionsSQL();
  writeFileSync(`${OUTPUT_DIR}/01_regions.sql`, regionsSQL);
  console.log(`Saved: ${OUTPUT_DIR}/01_regions.sql (${(regionsSQL.length / 1024).toFixed(1)} KB)`);

  // Generate departements SQL
  const departementsSQL = await generateDepartementsSQL();
  writeFileSync(`${OUTPUT_DIR}/02_departements.sql`, departementsSQL);
  console.log(`Saved: ${OUTPUT_DIR}/02_departements.sql (${(departementsSQL.length / 1024).toFixed(1)} KB)`);

  console.log('\n✅ SQL files generated!');
  console.log('\nNext steps:');
  console.log('1. Go to Supabase Dashboard > SQL Editor');
  console.log('2. Run 01_regions.sql');
  console.log('3. Run 02_departements.sql');
  console.log('\nOr use: npx supabase db execute --file scripts/ingest/sql/01_regions.sql');
}

main().catch(console.error);

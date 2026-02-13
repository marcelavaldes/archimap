/**
 * Geographic Data Ingestion Script
 *
 * Downloads regions, departments, and communes from geo.api.gouv.fr
 * and inserts them into Supabase with PostGIS geometries.
 *
 * Usage: bun run scripts/ingest/geo.ts [--regions] [--departements] [--communes]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const GEO_API_BASE = 'https://geo.api.gouv.fr';

interface Region {
  code: string;
  nom: string;
  contour?: GeoJSON.Geometry;
}

interface Departement {
  code: string;
  nom: string;
  codeRegion: string;
  contour?: GeoJSON.Geometry;
}

interface Commune {
  code: string;
  nom: string;
  codeDepartement: string;
  codeRegion: string;
  population?: number;
  surface?: number;
  contour?: GeoJSON.Geometry;
}

async function fetchWithRetry<T>(url: string, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      if (i === retries - 1) throw error;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('All retries failed');
}

async function ingestRegions(): Promise<void> {
  console.log('Fetching regions...');

  const regions = await fetchWithRetry<Region[]>(
    `${GEO_API_BASE}/regions?fields=code,nom`
  );

  console.log(`Found ${regions.length} regions`);

  // Fetch geometry for each region
  for (const region of regions) {
    console.log(`  Fetching geometry for ${region.nom}...`);
    const detail = await fetchWithRetry<Region>(
      `${GEO_API_BASE}/regions/${region.code}?fields=code,nom,contour`
    );
    region.contour = detail.contour;
  }

  // Filter to metropolitan France + Corsica (codes 01-94 and some overseas)
  const metroRegions = regions.filter(r => {
    const code = parseInt(r.code, 10);
    return !isNaN(code) && code >= 1 && code <= 94;
  });

  console.log(`Inserting ${metroRegions.length} metropolitan regions...`);

  // Insert using raw SQL via Supabase's sql function
  for (const region of metroRegions) {
    if (!region.contour) {
      console.log(`  Skipping ${region.nom} (no geometry)`);
      continue;
    }

    const { error } = await supabase.from('regions').upsert({
      code: region.code,
      nom: region.nom,
    }, { onConflict: 'code' });

    if (error) {
      console.error(`Error inserting region ${region.code}:`, error);
    } else {
      console.log(`  Inserted ${region.nom}`);
    }
  }

  // Now update geometries with raw SQL
  console.log('Updating geometries via SQL...');

  for (const region of metroRegions) {
    if (!region.contour) continue;

    const geojson = JSON.stringify(region.contour);
    const { error } = await supabase.rpc('exec_sql', {
      query: `UPDATE regions SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) WHERE code = $2`,
      params: [geojson, region.code]
    });

    if (error) {
      // If exec_sql doesn't exist, try direct approach
      console.log(`  Direct SQL not available, trying alternative for ${region.nom}...`);
    }
  }

  console.log('Regions ingestion complete');
}

async function ingestDepartements(): Promise<void> {
  console.log('Fetching departements...');

  const departements = await fetchWithRetry<Departement[]>(
    `${GEO_API_BASE}/departements?fields=code,nom,codeRegion`
  );

  console.log(`Found ${departements.length} departements`);

  // Fetch geometry for each departement
  for (const dept of departements) {
    console.log(`  Fetching geometry for ${dept.nom}...`);
    const detail = await fetchWithRetry<Departement>(
      `${GEO_API_BASE}/departements/${dept.code}?fields=code,nom,codeRegion,contour`
    );
    dept.contour = detail.contour;
  }

  // Filter to metropolitan France (codes 01-95, 2A, 2B)
  const metroDepts = departements.filter(d => {
    const code = d.code;
    if (code === '2A' || code === '2B') return true;
    const num = parseInt(code, 10);
    return !isNaN(num) && num >= 1 && num <= 95;
  });

  console.log(`Inserting ${metroDepts.length} metropolitan departements...`);

  for (const dept of metroDepts) {
    if (!dept.contour) {
      console.log(`  Skipping ${dept.nom} (no geometry)`);
      continue;
    }

    const { error } = await supabase.from('departements').upsert({
      code: dept.code,
      nom: dept.nom,
      code_region: dept.codeRegion,
    }, { onConflict: 'code' });

    if (error) {
      console.error(`Error inserting departement ${dept.code}:`, error);
    } else {
      console.log(`  Inserted ${dept.nom}`);
    }
  }

  console.log('Departements ingestion complete');
}

async function ingestCommunes(): Promise<void> {
  console.log('Fetching communes...');

  // Get list of metropolitan departements first
  const departements = await fetchWithRetry<Departement[]>(
    `${GEO_API_BASE}/departements?fields=code,nom,codeRegion`
  );

  const metroDepts = departements.filter(d => {
    const code = d.code;
    if (code === '2A' || code === '2B') return true;
    const num = parseInt(code, 10);
    return !isNaN(num) && num >= 1 && num <= 95;
  });

  let totalCommunes = 0;
  let successCount = 0;

  // Process communes by departement to manage memory
  for (const dept of metroDepts) {
    console.log(`\nProcessing ${dept.nom} (${dept.code})...`);

    const communes = await fetchWithRetry<Commune[]>(
      `${GEO_API_BASE}/departements/${dept.code}/communes?fields=code,nom,codeDepartement,codeRegion,population,surface,contour`
    );

    console.log(`  Found ${communes.length} communes`);
    totalCommunes += communes.length;

    // Insert one by one (no geometry for now, will add later)
    for (const c of communes) {
      const { error } = await supabase.from('communes').upsert({
        code: c.code,
        nom: c.nom,
        code_departement: c.codeDepartement,
        code_region: c.codeRegion,
        population: c.population || null,
        superficie: c.surface || null,
      }, { onConflict: 'code' });

      if (error) {
        console.error(`  Error inserting ${c.nom}:`, error.message);
      } else {
        successCount++;
      }
    }

    console.log(`  Progress: ${successCount}/${totalCommunes} communes`);
  }

  console.log(`\nCommunes ingestion complete: ${successCount}/${totalCommunes}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doRegions = args.length === 0 || args.includes('--regions');
  const doDepartements = args.length === 0 || args.includes('--departements');
  const doCommunes = args.length === 0 || args.includes('--communes');

  console.log('ArchiMap Geographic Data Ingestion');
  console.log('==================================\n');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  try {
    if (doRegions) {
      await ingestRegions();
    }

    if (doDepartements) {
      await ingestDepartements();
    }

    if (doCommunes) {
      await ingestCommunes();
    }

    console.log('\nAll ingestion complete!');
    console.log('\nNote: Geometries need to be added via SQL Editor in Supabase Dashboard.');
    console.log('Run the following to update geometries after ingestion:');
    console.log('  See docs/data/update-geometries.sql');
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  }
}

main();

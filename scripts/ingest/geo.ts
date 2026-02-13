/**
 * Geographic Data Ingestion Script
 *
 * Downloads regions, departments, and communes from geo.api.gouv.fr
 * and inserts them into Supabase with PostGIS geometries.
 *
 * Usage: bun run scripts/ingest/geo.ts [--regions] [--departements] [--communes]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
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

  // Insert into database
  console.log('Inserting regions into database...');

  for (const region of regions) {
    const { error } = await supabase.rpc('insert_region', {
      p_code: region.code,
      p_nom: region.nom,
      p_geometry: JSON.stringify(region.contour),
    });

    if (error) {
      console.error(`Error inserting region ${region.code}:`, error);
    } else {
      console.log(`  Inserted ${region.nom}`);
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

  // Insert into database
  console.log('Inserting departements into database...');

  for (const dept of departements) {
    const { error } = await supabase.rpc('insert_departement', {
      p_code: dept.code,
      p_nom: dept.nom,
      p_code_region: dept.codeRegion,
      p_geometry: JSON.stringify(dept.contour),
    });

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

  // Get list of departements first
  const departements = await fetchWithRetry<Departement[]>(
    `${GEO_API_BASE}/departements?fields=code,nom,codeRegion`
  );

  let totalCommunes = 0;
  let successCount = 0;

  // Process communes by departement to manage memory
  for (const dept of departements) {
    console.log(`\nProcessing ${dept.nom} (${dept.code})...`);

    const communes = await fetchWithRetry<Commune[]>(
      `${GEO_API_BASE}/departements/${dept.code}/communes?fields=code,nom,codeDepartement,codeRegion,population,surface,contour`
    );

    console.log(`  Found ${communes.length} communes`);
    totalCommunes += communes.length;

    // Batch insert (100 at a time)
    const batchSize = 100;
    for (let i = 0; i < communes.length; i += batchSize) {
      const batch = communes.slice(i, i + batchSize);

      const insertData = batch.map((c) => ({
        code: c.code,
        nom: c.nom,
        code_departement: c.codeDepartement,
        code_region: c.codeRegion,
        population: c.population || null,
        superficie: c.surface || null,
        geometry: c.contour,
      }));

      const { error } = await supabase.from('communes').upsert(
        insertData.map((d) => ({
          ...d,
          geometry: `SRID=4326;${JSON.stringify(d.geometry)}`,
        })),
        { onConflict: 'code' }
      );

      if (error) {
        console.error(`  Batch error:`, error);
      } else {
        successCount += batch.length;
        process.stdout.write(
          `\r  Progress: ${successCount}/${totalCommunes} communes`
        );
      }
    }
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
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  }
}

main();

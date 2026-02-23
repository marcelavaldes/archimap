#!/usr/bin/env bun
/**
 * Apply SQL migration to Supabase
 *
 * Since we can't execute raw SQL via JS client, this script:
 * 1. Outputs the SQL to run manually in Supabase Dashboard
 * 2. Tests if the functions work after manual execution
 *
 * Usage: bun run scripts/apply-migration.ts [--test-only]
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const testOnly = process.argv.includes('--test-only');

async function testFunctions() {
  console.log('\n🧪 Testing functions...\n');

  // Test search_communes
  console.log('1. Testing search_communes("Lyon")...');
  const { data: searchData, error: searchError } = await supabase
    .rpc('search_communes', { search_term: 'Lyon' });

  if (searchError) {
    console.error('   ❌ Failed:', searchError.message);
    return false;
  } else {
    console.log('   ✅ Passed! Found', searchData?.length, 'results');
    if (searchData?.[0]) {
      console.log('   First result:', searchData[0].nom, `(${searchData[0].code})`);
    }
  }

  // Test get_communes_in_viewport
  console.log('\n2. Testing get_communes_in_viewport (Hérault bbox)...');
  const { data: viewportData, error: viewportError } = await supabase
    .rpc('get_communes_in_viewport', {
      min_lng: 3.5,
      min_lat: 43.5,
      max_lng: 4.0,
      max_lat: 44.0,
      p_criterion: null
    });

  if (viewportError) {
    console.error('   ❌ Failed:', viewportError.message);
    return false;
  } else {
    console.log('   ✅ Passed! Found', viewportData?.length, 'communes in viewport');
  }

  return true;
}

async function main() {
  if (testOnly) {
    const success = await testFunctions();
    process.exit(success ? 0 : 1);
  }

  // Show migration SQL
  const migrationPath = join(
    process.cwd(),
    'supabase/migrations/20260223200000_fix_viewport_search_functions.sql'
  );

  const sql = readFileSync(migrationPath, 'utf-8');

  console.log('═'.repeat(60));
  console.log('SUPABASE MIGRATION - Manual Execution Required');
  console.log('═'.repeat(60));
  console.log('\n📋 Steps to apply this migration:\n');
  console.log('1. Go to: https://supabase.com/dashboard/project/jquglrlwicryiajgfbel/sql');
  console.log('2. Copy the SQL below and paste it in the SQL Editor');
  console.log('3. Click "Run" to execute');
  console.log('4. Run this script again with --test-only to verify');
  console.log('\n' + '─'.repeat(60));
  console.log('SQL TO EXECUTE:');
  console.log('─'.repeat(60) + '\n');
  console.log(sql);
  console.log('\n' + '─'.repeat(60));
  console.log('\nAfter executing, test with:');
  console.log('  bun run scripts/apply-migration.ts --test-only');
  console.log('─'.repeat(60));

  // Also test current state
  console.log('\n📊 Current function status:');
  await testFunctions();
}

main().catch(console.error);

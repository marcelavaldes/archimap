-- Enable row-level security on every public table.
--
-- Without RLS, PostgREST honours the default Supabase grants that give `anon`
-- and `authenticated` full DML on `public` tables — so the anon key, which ships
-- in the browser bundle by design, could INSERT/UPDATE/DELETE reference data.
--
-- Policy model: these five tables are public reference data.
--   * anyone may SELECT
--   * nobody may write through PostgREST
--
-- Writes happen only through the service-role key, which carries BYPASSRLS and
-- is used exclusively by authenticated admin routes. There is deliberately NO
-- INSERT/UPDATE/DELETE policy: with RLS enabled and no permissive policy for a
-- command, that command is denied. Adding one would reopen the hole.
--
-- Idempotent: safe to re-run against a database where it has already been applied.

-- ============================================
-- regions
-- ============================================
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regions_public_read" ON regions;
CREATE POLICY "regions_public_read" ON regions
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================
-- departements
-- ============================================
ALTER TABLE departements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departements_public_read" ON departements;
CREATE POLICY "departements_public_read" ON departements
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================
-- communes
-- ============================================
ALTER TABLE communes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "communes_public_read" ON communes;
CREATE POLICY "communes_public_read" ON communes
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================
-- criteria
-- ============================================
ALTER TABLE criteria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "criteria_public_read" ON criteria;
CREATE POLICY "criteria_public_read" ON criteria
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================
-- criterion_values
-- ============================================
ALTER TABLE criterion_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "criterion_values_public_read" ON criterion_values;
CREATE POLICY "criterion_values_public_read" ON criterion_values
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================
-- criterion_coverage view
-- ============================================
-- `criterion_coverage` (20260226000000_create_criteria_table.sql) is a view over
-- `criteria` and `communes`. By default a view runs with its OWNER's privileges,
-- which would let it read straight past the policies above. `security_invoker`
-- makes it execute as the caller so the same policies apply. Today that changes
-- nothing observable — the policies allow public read — but it means the view
-- cannot become a bypass if those policies are ever tightened.
--
-- Declared here rather than in the create-view migration because that migration
-- has already been applied by hand to the live database and would not be replayed.
ALTER VIEW criterion_coverage SET (security_invoker = on);

-- ============================================
-- Note on RPCs
-- ============================================
-- get_geojson_by_level, get_communes_in_viewport and search_communes are
-- LANGUAGE plpgsql with the default SECURITY INVOKER, so they execute as the
-- caller and the SELECT policies above keep them working for anon.
-- The insert_region / insert_departement / insert_commune / insert_criterion_value
-- RPCs are also SECURITY INVOKER, so RLS now denies them to anon — which is the
-- intent. Do NOT add SECURITY DEFINER to any of these to work around a policy.

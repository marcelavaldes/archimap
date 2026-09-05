-- Function to return GeoJSON by administrative level
-- Created: 2026-02-13

SET search_path TO public, extensions;

-- The initial schema created a (VARCHAR, VARCHAR) -> JSON version of this
-- function. CREATE OR REPLACE below does not replace it: a different argument
-- type list makes a new overload. Without this DROP a fresh replay ends up with
-- both, and PostgREST cannot choose between them — every call to
-- /api/geo/[level] fails with PGRST203. Mirrors the DROP-then-CREATE pattern
-- 20260223200000_fix_viewport_search_functions.sql uses for the other two RPCs.
DROP FUNCTION IF EXISTS get_geojson_by_level(VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION get_geojson_by_level(
  p_level TEXT,
  p_parent_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_level = 'region' THEN
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'id', code,
          'properties', jsonb_build_object(
            'code', code,
            'nom', nom,
            'level', 'region'
          ),
          'geometry', ST_AsGeoJSON(geometry)::jsonb
        )
      ), '[]'::jsonb)
    ) INTO result
    FROM regions;
  ELSIF p_level = 'departement' THEN
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'id', code,
          'properties', jsonb_build_object(
            'code', code,
            'nom', nom,
            'code_region', code_region,
            'level', 'departement'
          ),
          'geometry', ST_AsGeoJSON(geometry)::jsonb
        )
      ), '[]'::jsonb)
    ) INTO result
    FROM departements
    WHERE (p_parent_code IS NULL OR code_region = p_parent_code);
  ELSIF p_level = 'commune' THEN
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'id', code,
          'properties', jsonb_build_object(
            'code', code,
            'nom', nom,
            'code_departement', code_departement,
            'code_region', code_region,
            'population', population,
            'level', 'commune'
          ),
          'geometry', ST_AsGeoJSON(geometry)::jsonb
        )
      ), '[]'::jsonb)
    ) INTO result
    FROM communes
    WHERE (p_parent_code IS NULL OR code_departement = p_parent_code);
  ELSE
    result := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  END IF;

  RETURN result;
END;
$$;

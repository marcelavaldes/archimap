-- Fix viewport and search functions
-- Created: 2026-02-23
-- Issue: Functions exist but PostgREST schema cache doesn't see them

SET search_path TO public, extensions;

-- Ensure pg_trgm extension is enabled for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop and recreate get_communes_in_viewport to ensure it's registered
DROP FUNCTION IF EXISTS get_communes_in_viewport(DECIMAL, DECIMAL, DECIMAL, DECIMAL, VARCHAR);

CREATE FUNCTION get_communes_in_viewport(
  min_lng DECIMAL,
  min_lat DECIMAL,
  max_lng DECIMAL,
  max_lat DECIMAL,
  p_criterion VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE (
  code VARCHAR(5),
  nom VARCHAR(200),
  geometry JSON,
  criterion_value DECIMAL,
  criterion_score INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.code,
    c.nom,
    ST_AsGeoJSON(c.geometry)::JSON,
    cv.value,
    cv.score
  FROM communes c
  LEFT JOIN criterion_values cv
    ON c.code = cv.commune_code
    AND cv.criterion_id = p_criterion
  WHERE c.geometry && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326);
END;
$$;

-- Drop and recreate search_communes to ensure it's registered
DROP FUNCTION IF EXISTS search_communes(VARCHAR);

CREATE FUNCTION search_communes(search_term VARCHAR)
RETURNS TABLE (
  code VARCHAR(5),
  nom VARCHAR(200),
  code_departement VARCHAR(3),
  nom_departement VARCHAR(100),
  lng DECIMAL,
  lat DECIMAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.code,
    c.nom,
    c.code_departement,
    d.nom,
    ST_X(c.centroid)::DECIMAL,
    ST_Y(c.centroid)::DECIMAL
  FROM communes c
  JOIN departements d ON c.code_departement = d.code
  WHERE c.nom ILIKE '%' || search_term || '%'
  ORDER BY
    CASE WHEN c.nom ILIKE search_term || '%' THEN 0 ELSE 1 END,
    similarity(c.nom, search_term) DESC,
    c.population DESC NULLS LAST
  LIMIT 20;
END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

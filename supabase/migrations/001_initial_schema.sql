-- ArchiMap Initial Schema
-- PostgreSQL with PostGIS extension

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================
-- GEOGRAPHIC TABLES
-- ============================================

-- Regions (13 in metropolitan France)
CREATE TABLE regions (
  code VARCHAR(3) PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_regions_geometry ON regions USING GIST(geometry);

-- Departments (101 total)
CREATE TABLE departements (
  code VARCHAR(3) PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  code_region VARCHAR(3) NOT NULL REFERENCES regions(code),
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_departements_geometry ON departements USING GIST(geometry);
CREATE INDEX idx_departements_region ON departements(code_region);

-- Communes (~35,000)
CREATE TABLE communes (
  code VARCHAR(5) PRIMARY KEY, -- INSEE code
  nom VARCHAR(200) NOT NULL,
  code_departement VARCHAR(3) NOT NULL REFERENCES departements(code),
  code_region VARCHAR(3) NOT NULL REFERENCES regions(code),
  population INTEGER,
  superficie DECIMAL(10,2), -- km²
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
  centroid GEOMETRY(Point, 4326) GENERATED ALWAYS AS (ST_Centroid(geometry)) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_communes_geometry ON communes USING GIST(geometry);
CREATE INDEX idx_communes_centroid ON communes USING GIST(centroid);
CREATE INDEX idx_communes_departement ON communes(code_departement);
CREATE INDEX idx_communes_region ON communes(code_region);
CREATE INDEX idx_communes_nom ON communes(nom);
CREATE INDEX idx_communes_nom_trgm ON communes USING GIN(nom gin_trgm_ops);

-- Enable trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- CRITERION DATA
-- ============================================

-- Criterion values per commune
CREATE TABLE criterion_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commune_code VARCHAR(5) NOT NULL REFERENCES communes(code) ON DELETE CASCADE,
  criterion_id VARCHAR(50) NOT NULL,
  value DECIMAL(12,4) NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  rank_national INTEGER,
  rank_departement INTEGER,
  source VARCHAR(100),
  source_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(commune_code, criterion_id)
);

CREATE INDEX idx_criterion_values_commune ON criterion_values(commune_code);
CREATE INDEX idx_criterion_values_criterion ON criterion_values(criterion_id);
CREATE INDEX idx_criterion_values_score ON criterion_values(criterion_id, score);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Get communes in viewport with optional criterion data
CREATE OR REPLACE FUNCTION get_communes_in_viewport(
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
) AS $$
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
$$ LANGUAGE plpgsql;

-- Search communes by name
CREATE OR REPLACE FUNCTION search_communes(search_term VARCHAR)
RETURNS TABLE (
  code VARCHAR(5),
  nom VARCHAR(200),
  code_departement VARCHAR(3),
  nom_departement VARCHAR(100),
  lng DECIMAL,
  lat DECIMAL
) AS $$
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
$$ LANGUAGE plpgsql;

-- Get GeoJSON for a specific administrative level
CREATE OR REPLACE FUNCTION get_geojson_by_level(
  p_level VARCHAR(20),
  p_parent_code VARCHAR(5) DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  IF p_level = 'region' THEN
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', json_agg(
        json_build_object(
          'type', 'Feature',
          'id', code,
          'properties', json_build_object('code', code, 'nom', nom, 'level', 'region'),
          'geometry', ST_AsGeoJSON(geometry)::JSON
        )
      )
    ) INTO result FROM regions;
  ELSIF p_level = 'departement' THEN
    IF p_parent_code IS NOT NULL THEN
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'id', code,
            'properties', json_build_object('code', code, 'nom', nom, 'level', 'departement', 'codeRegion', code_region),
            'geometry', ST_AsGeoJSON(geometry)::JSON
          )
        )
      ) INTO result FROM departements WHERE code_region = p_parent_code;
    ELSE
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'id', code,
            'properties', json_build_object('code', code, 'nom', nom, 'level', 'departement', 'codeRegion', code_region),
            'geometry', ST_AsGeoJSON(geometry)::JSON
          )
        )
      ) INTO result FROM departements;
    END IF;
  ELSIF p_level = 'commune' THEN
    IF p_parent_code IS NOT NULL THEN
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'id', code,
            'properties', json_build_object('code', code, 'nom', nom, 'level', 'commune', 'codeDepartement', code_departement, 'population', population),
            'geometry', ST_AsGeoJSON(geometry)::JSON
          )
        )
      ) INTO result FROM communes WHERE code_departement = p_parent_code;
    ELSE
      -- Return simplified version for all communes (expensive!)
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'id', code,
            'properties', json_build_object('code', code, 'nom', nom, 'level', 'commune', 'codeDepartement', code_departement),
            'geometry', ST_AsGeoJSON(ST_Simplify(geometry, 0.01))::JSON
          )
        )
      ) INTO result FROM communes;
    END IF;
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_regions_updated_at
  BEFORE UPDATE ON regions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_departements_updated_at
  BEFORE UPDATE ON departements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_communes_updated_at
  BEFORE UPDATE ON communes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_criterion_values_updated_at
  BEFORE UPDATE ON criterion_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

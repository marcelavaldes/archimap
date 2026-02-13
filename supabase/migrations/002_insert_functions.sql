-- Insert functions for data ingestion
-- These allow inserting geometries from GeoJSON strings

CREATE OR REPLACE FUNCTION insert_region(
  p_code VARCHAR(3),
  p_nom VARCHAR(100),
  p_geometry TEXT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO regions (code, nom, geometry)
  VALUES (
    p_code,
    p_nom,
    ST_SetSRID(ST_GeomFromGeoJSON(p_geometry), 4326)
  )
  ON CONFLICT (code) DO UPDATE SET
    nom = EXCLUDED.nom,
    geometry = EXCLUDED.geometry,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION insert_departement(
  p_code VARCHAR(3),
  p_nom VARCHAR(100),
  p_code_region VARCHAR(3),
  p_geometry TEXT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO departements (code, nom, code_region, geometry)
  VALUES (
    p_code,
    p_nom,
    p_code_region,
    ST_SetSRID(ST_GeomFromGeoJSON(p_geometry), 4326)
  )
  ON CONFLICT (code) DO UPDATE SET
    nom = EXCLUDED.nom,
    code_region = EXCLUDED.code_region,
    geometry = EXCLUDED.geometry,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION insert_commune(
  p_code VARCHAR(5),
  p_nom VARCHAR(200),
  p_code_departement VARCHAR(3),
  p_code_region VARCHAR(3),
  p_population INTEGER,
  p_superficie DECIMAL(10,2),
  p_geometry TEXT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO communes (code, nom, code_departement, code_region, population, superficie, geometry)
  VALUES (
    p_code,
    p_nom,
    p_code_departement,
    p_code_region,
    p_population,
    p_superficie,
    ST_SetSRID(ST_GeomFromGeoJSON(p_geometry), 4326)
  )
  ON CONFLICT (code) DO UPDATE SET
    nom = EXCLUDED.nom,
    code_departement = EXCLUDED.code_departement,
    code_region = EXCLUDED.code_region,
    population = EXCLUDED.population,
    superficie = EXCLUDED.superficie,
    geometry = EXCLUDED.geometry,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

# Database Schema - ArchiMap

## Overview

ArchiMap uses PostgreSQL with PostGIS extension for spatial data handling.

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
```

## Tables

### Geographic Entities

#### `regions`
French administrative regions (13 in metropolitan France).

```sql
CREATE TABLE regions (
  code VARCHAR(3) PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_regions_geometry ON regions USING GIST(geometry);
```

#### `departements`
French departments (101 total).

```sql
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
```

#### `communes`
French communes (~35,000).

```sql
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
```

### Criterion Data

#### `criterion_values`
Stores values for each criterion per commune.

```sql
CREATE TABLE criterion_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commune_code VARCHAR(5) NOT NULL REFERENCES communes(code),
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
```

#### `criteria`
Criterion definitions (name, category, unit, color scale, ingestion config). Replaces what was
originally a hardcoded constant.

```sql
CREATE TABLE criteria (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('climate','cost','services','quality','employment')),
  description TEXT NOT NULL,
  unit VARCHAR(50) NOT NULL,
  source VARCHAR(200) NOT NULL,
  last_updated DATE,
  higher_is_better BOOLEAN NOT NULL DEFAULT true,
  color_scale_low VARCHAR(7) NOT NULL,
  color_scale_mid VARCHAR(7) NOT NULL,
  color_scale_high VARCHAR(7) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  ingestion_type VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (ingestion_type IN ('manual','api','csv')),
  api_config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_criteria_category ON criteria(category);
CREATE INDEX idx_criteria_enabled ON criteria(enabled);
```

A `criterion_coverage` view over `criteria` and `criterion_values` reports how many communes have
data per criterion — see `supabase/migrations/20260226000000_create_criteria_table.sql`.

> A consultant SaaS tier (`organizations`, `users`, `client_profiles`, `saved_comparisons`,
> `reports`, `custom_criteria`, `custom_criterion_values`) was documented here in an earlier draft.
> None of those tables were ever created — cut on 2026-08-26, see
> [`docs/product/DEFERRED.md`](../product/DEFERRED.md).

## Row Level Security Policies

Every table above is public reference data: anyone may `SELECT`, nobody may write through
PostgREST. Writes happen only through the service-role key (which carries `BYPASSRLS`) from
authenticated admin routes — there is deliberately no `INSERT`/`UPDATE`/`DELETE` policy, and with
RLS enabled and no permissive policy for a command, that command is denied.

```sql
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "regions_public_read" ON regions
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE departements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "departements_public_read" ON departements
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE communes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "communes_public_read" ON communes
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE criteria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "criteria_public_read" ON criteria
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE criterion_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "criterion_values_public_read" ON criterion_values
  FOR SELECT TO anon, authenticated USING (true);
```

The `criterion_coverage` view is declared `security_invoker = on` so it runs as the caller and
stays subject to the same policies, rather than bypassing them under its owner's privileges.

Full policy set, with rationale: `supabase/migrations/20260826120000_enable_rls.sql`.

## Functions

### `get_communes_in_viewport`
Efficiently fetch communes within a map viewport.

```sql
CREATE OR REPLACE FUNCTION get_communes_in_viewport(
  min_lng DECIMAL,
  min_lat DECIMAL,
  max_lng DECIMAL,
  max_lat DECIMAL,
  criterion VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE (
  code VARCHAR(5),
  nom VARCHAR(200),
  geometry GEOMETRY,
  criterion_value DECIMAL,
  criterion_score INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.code,
    c.nom,
    c.geometry,
    cv.value,
    cv.score
  FROM communes c
  LEFT JOIN criterion_values cv ON c.code = cv.commune_code AND cv.criterion_id = criterion
  WHERE c.geometry && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326);
END;
$$ LANGUAGE plpgsql;
```

### `search_communes`
Full-text search on commune names.

```sql
CREATE OR REPLACE FUNCTION search_communes(search_term VARCHAR)
RETURNS TABLE (
  code VARCHAR(5),
  nom VARCHAR(200),
  code_departement VARCHAR(3),
  centroid GEOMETRY
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.code,
    c.nom,
    c.code_departement,
    c.centroid
  FROM communes c
  WHERE c.nom ILIKE '%' || search_term || '%'
  ORDER BY
    CASE WHEN c.nom ILIKE search_term || '%' THEN 0 ELSE 1 END,
    c.population DESC NULLS LAST
  LIMIT 20;
END;
$$ LANGUAGE plpgsql;
```

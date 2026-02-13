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

### User & Organization Data (Consultant Features)

#### `organizations`
Multi-tenant support for consultants.

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_org_id VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  plan VARCHAR(50) DEFAULT 'free', -- free, pro, enterprise
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `users`
User profiles linked to Clerk.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id VARCHAR(100) UNIQUE NOT NULL,
  organization_id UUID REFERENCES organizations(id),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(200),
  role VARCHAR(50) DEFAULT 'viewer', -- admin, editor, viewer
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_clerk ON users(clerk_user_id);
```

#### `client_profiles`
Consultant clients with their preferences.

```sql
CREATE TABLE client_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  created_by UUID NOT NULL REFERENCES users(id),
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255),
  budget_max INTEGER,
  preferences JSONB DEFAULT '{}',
  -- preferences structure:
  -- {
  --   "weights": { "climate": 30, "cost": 40, ... },
  --   "constraints": ["near_airport", "coast", ...]
  -- }
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_client_profiles_org ON client_profiles(organization_id);
```

#### `saved_comparisons`
Saved commune comparisons for clients.

```sql
CREATE TABLE saved_comparisons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_profile_id UUID NOT NULL REFERENCES client_profiles(id),
  commune_codes VARCHAR(5)[] NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saved_comparisons_client ON saved_comparisons(client_profile_id);
```

#### `reports`
Generated PDF reports.

```sql
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_profile_id UUID NOT NULL REFERENCES client_profiles(id),
  comparison_id UUID REFERENCES saved_comparisons(id),
  storage_path VARCHAR(500) NOT NULL, -- Supabase Storage path
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_client ON reports(client_profile_id);
```

#### `custom_criteria`
Organization-specific criteria.

```sql
CREATE TABLE custom_criteria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  criterion_id VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  unit VARCHAR(50),
  higher_is_better BOOLEAN DEFAULT true,
  color_scale JSONB DEFAULT '{"low": "#ef4444", "mid": "#fbbf24", "high": "#22c55e"}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, criterion_id)
);

CREATE INDEX idx_custom_criteria_org ON custom_criteria(organization_id);
```

#### `custom_criterion_values`
Values for custom criteria.

```sql
CREATE TABLE custom_criterion_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  custom_criterion_id UUID NOT NULL REFERENCES custom_criteria(id),
  commune_code VARCHAR(5) NOT NULL REFERENCES communes(code),
  value DECIMAL(12,4) NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(custom_criterion_id, commune_code)
);

CREATE INDEX idx_custom_values_criterion ON custom_criterion_values(custom_criterion_id);
```

## Row Level Security Policies

```sql
-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_criterion_values ENABLE ROW LEVEL SECURITY;

-- Public tables (no RLS needed for read)
-- regions, departements, communes, criterion_values

-- Example policy for client_profiles
CREATE POLICY "Users can view their org's client profiles"
  ON client_profiles FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE clerk_user_id = auth.jwt() ->> 'sub'
  ));

CREATE POLICY "Editors can insert client profiles"
  ON client_profiles FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM users
    WHERE clerk_user_id = auth.jwt() ->> 'sub'
    AND role IN ('admin', 'editor')
  ));
```

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

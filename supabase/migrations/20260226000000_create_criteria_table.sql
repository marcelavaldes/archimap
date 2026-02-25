-- Create criteria table to manage criterion definitions dynamically
-- Replaces the hardcoded CRITERIA constant in src/types/criteria.ts

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

CREATE TRIGGER tr_criteria_updated_at
  BEFORE UPDATE ON criteria
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Coverage view: how much data each criterion has
CREATE OR REPLACE VIEW criterion_coverage AS
SELECT
  c.id AS criterion_id,
  c.name,
  c.enabled,
  COUNT(DISTINCT cv.commune_code) AS communes_with_data,
  (SELECT COUNT(*) FROM communes) AS total_communes,
  ROUND(
    COUNT(DISTINCT cv.commune_code)::NUMERIC /
    NULLIF((SELECT COUNT(*) FROM communes), 0) * 100,
    2
  ) AS coverage_percent,
  MIN(cv.source_date) AS oldest_data,
  MAX(cv.source_date) AS newest_data
FROM criteria c
LEFT JOIN criterion_values cv ON c.id = cv.criterion_id
GROUP BY c.id, c.name, c.enabled;

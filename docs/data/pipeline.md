# Data Pipeline - ArchiMap

## Overview

This document describes the data sources, ingestion processes, and transformation logic for ArchiMap.

## Data Sources

### Geographic Data

| Source | URL | Data | Format | Update Frequency |
|--------|-----|------|--------|------------------|
| geo.api.gouv.fr | https://geo.api.gouv.fr | Regions, Departments, Communes | GeoJSON | Annually |
| IGN AdminExpress | https://geoservices.ign.fr | High-precision boundaries | Shapefile | Annually |

### Socioeconomic Data

| Source | URL | Data | Format | Update Frequency |
|--------|-----|------|--------|------------------|
| INSEE | https://api.insee.fr | Population, Employment, Income | JSON/CSV | Annually |
| data.gouv.fr | https://www.data.gouv.fr | Various (taxes, services) | CSV | Variable |
| DVF | https://app.dvf.etalab.gouv.fr | Property transactions | CSV | Quarterly |
| Météo France | https://donneespubliques.meteofrance.fr | Climate data | CSV | Monthly |
| ARCEP | https://www.data.gouv.fr/fr/datasets/ma-connexion-internet/ | Internet speed | CSV | Quarterly |

## Ingestion Scripts

### 1. Geographic Data Ingestion

```bash
# Location: scripts/ingest/geo.ts

# Download regions
curl "https://geo.api.gouv.fr/regions?fields=code,nom,geometry" > data/regions.json

# Download departments
curl "https://geo.api.gouv.fr/departements?fields=code,nom,codeRegion,geometry" > data/departements.json

# Download communes (paginated, ~35,000)
# Note: geo.api.gouv.fr has a limit, use IGN for full dataset
```

### 2. Criterion Data Ingestion

Each criterion has its own ingestion script:

```typescript
// scripts/ingest/criteria/temperature.ts
import { createClient } from '@supabase/supabase-js';

async function ingestTemperatureData() {
  // 1. Fetch from Météo France
  const response = await fetch('https://...');
  const data = await response.json();

  // 2. Transform and normalize
  const normalized = data.map(item => ({
    commune_code: item.insee,
    criterion_id: 'temperature',
    value: item.temp_moyenne,
    score: normalizeScore(item.temp_moyenne, 8, 18), // 8°C = 0, 18°C = 100
  }));

  // 3. Calculate ranks
  const ranked = calculateRanks(normalized);

  // 4. Upsert to Supabase
  await supabase
    .from('criterion_values')
    .upsert(ranked, { onConflict: 'commune_code,criterion_id' });
}
```

## Normalization Logic

All criterion values are normalized to a 0-100 score using min-max normalization:

```typescript
function normalizeScore(
  value: number,
  min: number,
  max: number,
  higherIsBetter: boolean = true
): number {
  const normalized = (value - min) / (max - min);
  const clamped = Math.max(0, Math.min(1, normalized));
  const score = higherIsBetter ? clamped : 1 - clamped;
  return Math.round(score * 100);
}
```

### Criterion-Specific Parameters

| Criterion | Min | Max | Higher is Better |
|-----------|-----|-----|------------------|
| temperature | 8°C | 18°C | true |
| sunshine | 1500h | 3000h | true |
| rainfall | 400mm | 1500mm | false |
| propertyPrice | 1000€ | 12000€ | false |
| localTax | 10% | 40% | false |
| hospitalAccess | 5min | 60min | false |
| publicTransport | 0 | 100 | true |
| internetSpeed | 10Mbps | 1000Mbps | true |
| crimeRate | 10‰ | 100‰ | false |
| culturalVenues | 0 | 50 | true |
| employmentRate | 50% | 80% | true |
| medianIncome | 15000€ | 40000€ | true |

## Ranking Calculation

```typescript
function calculateRanks(
  data: Array<{ commune_code: string; score: number }>
): Array<{ commune_code: string; score: number; rank_national: number }> {
  // Sort by score descending
  const sorted = [...data].sort((a, b) => b.score - a.score);

  // Assign ranks (handle ties)
  let currentRank = 1;
  return sorted.map((item, index) => {
    if (index > 0 && item.score < sorted[index - 1].score) {
      currentRank = index + 1;
    }
    return { ...item, rank_national: currentRank };
  });
}
```

## Data Quality Checks

Before inserting data, validate:

1. **Completeness**: All communes have a value (or explicit NULL)
2. **Range**: Values within expected bounds
3. **Consistency**: Departmental aggregates match commune sums
4. **Recency**: Source date is within acceptable range

```typescript
function validateCriterionData(data: CriterionValue[]): ValidationResult {
  const errors: string[] = [];

  // Check coverage
  const coverage = data.length / TOTAL_COMMUNES;
  if (coverage < 0.95) {
    errors.push(`Low coverage: ${(coverage * 100).toFixed(1)}%`);
  }

  // Check score range
  const invalidScores = data.filter(d => d.score < 0 || d.score > 100);
  if (invalidScores.length > 0) {
    errors.push(`${invalidScores.length} invalid scores`);
  }

  return { valid: errors.length === 0, errors };
}
```

## Scheduled Updates

| Criterion | Schedule | Notes |
|-----------|----------|-------|
| Geographic boundaries | Annually (January) | Manual verification |
| Climate data | Quarterly | Automated |
| Property prices | Quarterly | DVF has 6-month delay |
| Employment/Income | Annually | INSEE publishes ~18 months after |
| Internet speed | Quarterly | ARCEP data |

## CLI Commands

```bash
# Ingest all geographic data
bun run scripts/ingest/geo.ts

# Ingest specific criterion
bun run scripts/ingest/criteria/temperature.ts

# Ingest all criteria
bun run scripts/ingest/criteria/all.ts

# Validate data quality
bun run scripts/validate.ts

# Generate statistics report
bun run scripts/stats.ts
```

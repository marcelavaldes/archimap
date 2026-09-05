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

All criterion values are normalized to a 0-100 score using **percentile-clipped min-max**
(2nd-98th percentile), not fixed per-criterion bounds. A fixed min/max needs to be re-guessed and
re-tuned by hand for every criterion and silently breaks the moment real-world values drift
outside the guessed range; percentile clipping derives the range from the data itself and is the
better choice for skewed distributions like property prices, where a small number of very
expensive communes would otherwise compress every other commune's score toward one end.

Implementation: `src/lib/admin/scoring.ts` (`normalizeToScore`), with an identical copy in
`scripts/ingest/lib/utils.ts` for the CLI ingestion path.

```typescript
function normalizeToScore(
  value: number,
  allValues: number[],
  higherIsBetter: boolean
): number {
  if (allValues.length === 0) return 50;

  const sorted = [...allValues].sort((a, b) => a - b);
  const p2 = sorted[Math.floor(sorted.length * 0.02)];
  const p98 = sorted[Math.floor(sorted.length * 0.98)];

  if (p98 === p2) return 50; // degenerate: every value in-range is identical

  let score = ((value - p2) / (p98 - p2)) * 100;
  score = Math.max(0, Math.min(100, score));

  return higherIsBetter ? Math.round(score) : Math.round(100 - score);
}
```

### Reference population

`allValues` — the population the 2nd/98th percentiles are computed against — is **every commune
nationally that has a value for that criterion**, not a fixed universal range and not a sample.
It is built from the paginated, guarded commune fetch (`getCommuneCodes()` in
`src/lib/admin/ingestion-runners.ts` and its CLI twin), which refuses to proceed if the fetched
count falls below `EXPECTED_MIN_COMMUNES` (30,000; see `assertSufficientCommuneCount()` in
`src/lib/admin/scoring.ts`).

This is not an incidental detail: for six months an unpaginated Supabase query silently truncated
that population to PostgREST's default 1,000-row cap, so every criterion was scored and ranked
against ~3% of France instead of the whole country, with no error anywhere. The same raw value
scores differently against a 1,000-commune population than a ~35,000-commune one — the reference
population is part of the scoring contract, not an implementation detail, which is why it is
pinned in a regression test (`src/lib/admin/scoring.test.ts`) and named explicitly here rather
than left implicit.

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

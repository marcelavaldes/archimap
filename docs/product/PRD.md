# ArchiMap - Product Requirements Document

## Executive Summary

**Project:** ArchiMap - Territorial analysis system for comparing locations in France using interactive choropleth maps with overlay layers.

**Users:** Marcela + Gui, researching where to relocate in France.

**MVP Scope:** All criteria, entire France (35,000+ communes).

> A consultant-facing tier (multi-tenant auth, client profiles, PDF reports) was scoped in an
> earlier draft of this document and cut on 2026-08-26 for lack of validated demand — see
> [`DEFERRED.md`](./DEFERRED.md). This document now describes the two-person tool only.

## Problem Statement

Finding the ideal place to live in France requires analyzing multiple factors simultaneously:
- Climate preferences (sun, rain, temperature)
- Cost of living (property prices, taxes)
- Access to services (hospitals, transport, internet)
- Quality of life (safety, culture)
- Employment opportunities

Current solutions either:
- Only show one criterion at a time
- Lack granularity at the commune level
- Don't allow easy comparison of multiple locations
- Aren't tailored for relocation decisions

## Solution

ArchiMap provides an interactive choropleth map of France that:
1. Colors regions/departments/communes based on selected criteria
2. Allows overlaying multiple criteria simultaneously
3. Enables hierarchical navigation (France → Region → Department → Commune)
4. Shows detailed profiles with radar charts for each commune

## Target Users

### Marcela & Gui
- Couple researching where to relocate in France
- Need: Compare multiple criteria across different regions
- Pain: No single tool aggregates all relevant data visually

## Key Features

### Phase 1: Base Map (MVP)
- Interactive France map with zoom/pan
- Single criterion choropleth coloring
- Administrative boundaries (regions, departments, communes)
- Tooltip on hover with basic info
- Dark/light mode support

### Phase 2: Multi-Criteria
- 12 criteria across 5 categories
- Layer toggle (activate/deactivate each criterion)
- Overlay visualization (transparency blending)
- Search by commune name
- Normalized scoring (0-100) with national ranking

### Phase 3: Hierarchical Navigation
- Dynamic routes: `/map/region/[code]`, `/map/department/[code]`, `/map/commune/[insee]`
- Breadcrumb navigation
- Detail panel with radar chart
- Deep linking (shareable URLs)

Phase 4 (consultant SaaS tier) was scoped here and cut on 2026-08-26 — see
[`DEFERRED.md`](./DEFERRED.md).

## Data Model

### Geographic Entities
- **Region** (13): code, name, geometry
- **Department** (101): code, name, regionCode, geometry
- **Commune** (35,000+): INSEE code, name, departmentCode, regionCode, population, geometry

### Criteria Categories
1. **Climate**: temperature, sunshine, rainfall
2. **Cost**: property prices, property tax
3. **Services**: hospital access, public transport, internet speed
4. **Quality of Life**: crime rate, cultural venues
5. **Employment**: employment rate, median income

## Success Metrics

These are post-tiling acceptance criteria, not current goals. The tiled vector-tile data layer
they assume (`foundations-architecture` tasket group) has not shipped yet — see
`docs/architecture/overview.md`. Today's per-request GeoJSON assembly is not held to these numbers;
they gate the tiling work, not the current implementation.

| Metric | Target |
|--------|--------|
| Initial load | < 3 seconds |
| Criterion change | < 500ms |
| Pan/zoom | 60fps constant |
| Bundle size | < 1MB gzipped |

## Timeline

- **Phase 1:** Weeks 1-4
- **Phase 2:** Weeks 5-8
- **Phase 3:** Weeks 9-10

Phase 4 and its associated production timeline were cut with the consultant tier — see
[`DEFERRED.md`](./DEFERRED.md).

# ArchiMap - Product Requirements Document

## Executive Summary

**Project:** ArchiMap - Territorial analysis system for comparing locations in France using interactive choropleth maps with overlay layers.

**Users:** Initially personal use (Marcela + Gui), then scalable to consultant architects.

**MVP Scope:** All criteria, entire France (35,000+ communes).

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
5. Supports professional consultants with client profiles and PDF reports

## Target Users

### Primary: Personal Use
- **Marcela & Gui** - Couple researching where to relocate in France
- Need: Compare multiple criteria across different regions
- Pain: No single tool aggregates all relevant data visually

### Secondary: Architect Consultants
- **Relocation consultants** helping clients find ideal locations
- Need: Professional reports, client profiles, custom criteria
- Pain: Manual research across multiple sources, no branded deliverables

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

### Phase 4: Consultant Features
- Multi-tenant authentication (Clerk Organizations)
- Client profile CRUD
- Custom criteria creation
- PDF report generation (Puppeteer)
- Report archive in Supabase Storage

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

| Metric | Target |
|--------|--------|
| Initial load | < 3 seconds |
| Criterion change | < 500ms |
| Pan/zoom | 60fps constant |
| PDF generation | < 5 seconds |
| Bundle size | < 1MB gzipped |

## Timeline

- **Phase 1:** Weeks 1-4
- **Phase 2:** Weeks 5-8
- **Phase 3:** Weeks 9-10
- **Phase 4:** Weeks 11-14
- **Production:** Weeks 15-18

Total: 18-20 weeks to full production

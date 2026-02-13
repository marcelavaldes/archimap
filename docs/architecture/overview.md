# ArchiMap - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │   Next.js App   │  │  MapLibre GL    │  │    Clerk Auth       │ │
│  │   (React 19)    │  │   (WebGL Map)   │  │   (Multi-tenant)    │ │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘ │
└───────────┼─────────────────────┼───────────────────────┼───────────┘
            │                     │                       │
            ▼                     ▼                       ▼
┌───────────────────────────────────────────────────────────────────┐
│                         Vercel Edge                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  API Routes     │  │  Edge Functions  │  │   Static Assets  │  │
│  │  /api/*         │  │  (Middleware)    │  │   (_next/static) │  │
│  └────────┬────────┘  └─────────────────┘  └──────────────────┘  │
└───────────┼──────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────────┐
│                         Supabase                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  PostgreSQL     │  │    PostGIS      │  │   Realtime       │  │
│  │  (Data Store)   │  │  (Spatial)      │  │   (Subscriptions)│  │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐                        │
│  │  Storage        │  │   Auth (RLS)    │                        │
│  │  (PDF Reports)  │  │  (Row Level)    │                        │
│  └─────────────────┘  └─────────────────┘                        │
└───────────────────────────────────────────────────────────────────┘
```

## Technology Choices

### Frontend
| Technology | Version | Rationale |
|------------|---------|-----------|
| Next.js | 16 | App Router, React Server Components, Edge runtime |
| React | 19 | Concurrent features, Suspense |
| TypeScript | 5.x | Type safety, better DX |
| Tailwind CSS | 4 | Utility-first, dark mode support |
| MapLibre GL JS | 5.x | WebGL rendering, 60fps with 35k polygons, free |

### Backend
| Technology | Rationale |
|------------|-----------|
| Supabase | PostgreSQL + PostGIS + Auth + Storage in one platform |
| PostGIS | R-tree spatial indexing for geographic queries |
| Vercel Edge | Low latency, global distribution, serverless |

### Authentication
| Technology | Rationale |
|------------|-----------|
| Clerk | Multi-tenant Organizations support, easy integration |

## Data Flow

### Map Rendering
```
1. User opens app
   ↓
2. Next.js loads page with map component
   ↓
3. MapLibre initializes with base style (CARTO tiles)
   ↓
4. On criterion select, fetch GeoJSON from Supabase
   ↓
5. Add GeoJSON as source + fill layer
   ↓
6. MapLibre renders choropleth with WebGL
```

### Criterion Data
```
1. Criterion selected in sidebar
   ↓
2. Check client-side cache (React state)
   ↓
3. If miss, fetch from Supabase
   ↓
4. Response: { code, value, score, rank } per location
   ↓
5. Update map fill-color expression
   ↓
6. Cache response for session
```

## Performance Optimizations

### Map Performance
- **Vector tiles** for base map (CARTO)
- **GeoJSON simplification** at low zoom levels
- **Level-of-detail switching** based on zoom:
  - Z0-5: Regions (13 features)
  - Z6-8: Departments (101 features)
  - Z9+: Communes (35,000 features)

### Data Loading
- **Lazy loading** criteria data on demand
- **Client-side caching** per criterion
- **Edge caching** for static GeoJSON
- **Incremental loading** at commune level (visible viewport only)

## Security

### Row Level Security (RLS)
- All Supabase tables have RLS enabled
- Users can only access their organization's data
- Custom criteria scoped to organization

### Authentication Flow
```
1. User signs in via Clerk
   ↓
2. Clerk JWT passed to Supabase
   ↓
3. Supabase validates JWT, extracts org_id
   ↓
4. RLS policies filter data by org_id
```

## File Structure

```
archimap/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── map/
│   │   │   └── [level]/
│   │   │       └── [code]/
│   │   │           └── page.tsx
│   │   └── api/
│   │       └── geo/
│   │           └── [level]/
│   │               └── route.ts
│   ├── components/
│   │   ├── Map/
│   │   ├── Layout/
│   │   └── UI/
│   ├── lib/
│   │   ├── map/
│   │   ├── supabase/
│   │   └── utils/
│   ├── hooks/
│   └── types/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   └── product/
└── public/
```

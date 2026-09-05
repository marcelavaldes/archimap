# ArchiMap - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │   Next.js App   │  │  MapLibre GL    │  │  Admin session       │ │
│  │   (React 19)    │  │   (WebGL Map)   │  │  cookie (public map  │ │
│  │                 │  │                 │  │  needs no auth)      │ │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘ │
└───────────┼─────────────────────┼───────────────────────┼───────────┘
            │                     │                       │
            ▼                     ▼                       ▼
┌───────────────────────────────────────────────────────────────────┐
│                         Vercel Edge                                │
│  ┌─────────────────┐  ┌─────────────────────────────┐  ┌────────┐ │
│  │  API Routes     │  │  Middleware                  │  │ Static │ │
│  │  /api/*         │  │  gates /admin, /api/admin:    │  │ Assets │ │
│  │                 │  │  verifies signed HMAC session  │  │        │ │
│  │                 │  │  token, no third-party IdP     │  │        │ │
│  └────────┬────────┘  └─────────────────────────────┘  └────────┘ │
└───────────┼──────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────────┐
│                         Supabase                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  PostgreSQL     │  │    PostGIS      │  │   RLS            │  │
│  │  (Data Store)   │  │  (Spatial)      │  │   (public read,  │  │
│  │                 │  │                 │  │   no public      │  │
│  │                 │  │                 │  │   write)         │  │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

Writes go through the service-role key (which carries `BYPASSRLS`), used only by authenticated
admin API routes — never shipped to the browser. See `docs/database/schema.md` for the RLS policy
model and `src/lib/admin/session.ts` for the session token format.

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
| Supabase | PostgreSQL + PostGIS + PostgREST, RLS-gated. Supabase Auth and Storage are not used — admin auth is a custom signed cookie (see below) |
| PostGIS | R-tree spatial indexing for geographic queries |
| Vercel Edge | Low latency, global distribution, serverless |

### Authentication
| Technology | Rationale |
|------------|-----------|
| Signed session cookie (HMAC-SHA256, Web Crypto) | Two-person tool — one shared admin password as the login factor, an opaque expiring token (not the password) as the session. No third-party IdP; see `src/lib/admin/session.ts`. |

## Data Flow

### Map Rendering
```
1. User opens app
   ↓
2. Next.js loads page with map component
   ↓
3. MapLibre initializes with base style (CARTO raster tiles, basemap only)
   ↓
4. On criterion select, call the get_geojson_by_level RPC — Postgres assembles
   region/department/commune polygons + criterion scores as GeoJSON per request
   (src/app/api/geo/[level]/route.ts)
   ↓
5. Add GeoJSON as source + fill layer
   ↓
6. MapLibre renders choropleth with WebGL
```

Only the CARTO basemap is tiled. The data layer (commune polygons + scores) is not — it is
GeoJSON assembled in Postgres and shipped whole per request. A tiled data layer (vector tiles
generated from the criterion data itself, not just the basemap) is planned but not built; it is
tracked in the `foundations-architecture` tasket group.

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
- **Vector tiles** for the base map only (CARTO) — the criterion data layer is untiled GeoJSON,
  see "Map Rendering" above
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
- Every table is public reference data: anyone may `SELECT`, nobody may write through PostgREST
- Writes happen only through the service-role key (`BYPASSRLS`), used exclusively by
  authenticated admin API routes
- See `docs/database/schema.md` and `supabase/migrations/20260826120000_enable_rls.sql`

### Admin Authentication Flow
```
1. Admin submits the shared password to /api/admin/login
   ↓
2. Server verifies it (constant-time comparison), mints a signed session
   token (HMAC-SHA256 over ADMIN_SESSION_SECRET), sets it as the admin_token
   cookie — the password itself is never stored in the cookie
   ↓
3. Middleware (src/middleware.ts) gates /admin and /api/admin, verifying the
   token on every request before any route handler runs
   ↓
4. Admin routes use the service-role key server-side to write; the browser
   never holds write credentials
```

The public map needs no authentication at all — RLS's public-read policies serve it directly with
the anon key.

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

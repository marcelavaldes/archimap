# ArchiMap

Système d'analyse territoriale pour comparer les communes françaises avec des cartes choroplèthes interactives.

## Stack Technologique

- **Frontend:** Next.js 16 + React 19 + TypeScript
- **Styling:** Tailwind CSS 4
- **Cartes:** MapLibre GL JS
- **Backend:** Supabase (PostgreSQL + PostGIS)
- **Déploiement:** Vercel

## Installation

```bash
# Cloner le projet
git clone <repo-url>
cd archimap

# Installer les dépendances
bun install

# Copier le fichier d'environnement
cp .env.example .env.local

# Configurer les variables Supabase dans .env.local
```

## Développement

```bash
# Lancer le serveur de développement
bun dev

# Build de production
bun build

# Lancer en production
bun start
```

## Structure du Projet

```
src/
├── app/                    # Routes Next.js App Router
│   ├── layout.tsx          # Layout principal
│   └── page.tsx            # Page d'accueil avec carte
├── components/
│   ├── Map/                # Composants de carte
│   │   └── FranceMap.tsx   # Carte MapLibre de France
│   └── Layout/             # Composants de mise en page
│       ├── Header.tsx      # En-tête avec navigation
│       └── Sidebar.tsx     # Barre latérale des critères
├── lib/
│   ├── map/                # Configuration et utilitaires carte
│   │   ├── config.ts       # Config MapLibre, bornes France
│   │   └── colors.ts       # Interpolation couleurs choroplèthe
│   └── supabase/           # Clients Supabase
│       ├── client.ts       # Client navigateur
│       └── server.ts       # Client serveur
└── types/
    ├── geo.ts              # Types géographiques
    └── criteria.ts         # Définitions des critères
```

## Critères de Comparaison

| Catégorie | Critères |
|-----------|----------|
| **Climat** | Température, Ensoleillement, Précipitations |
| **Coût de Vie** | Prix immobilier, Taxe foncière |
| **Services** | Accès hôpital, Transport, Internet |
| **Qualité de Vie** | Criminalité, Équipements culturels |
| **Emploi** | Taux d'emploi, Revenu médian |

## Sources de Données

- **geo.api.gouv.fr** - Limites administratives (GeoJSON)
- **INSEE** - Données socio-économiques
- **data.gouv.fr** - Données publiques diverses
- **DVF** - Transactions immobilières

## Roadmap

### Phase 1: Carte de Base (En cours)
- [x] Setup Next.js + TypeScript
- [x] Configuration MapLibre GL JS
- [x] Interface de sélection des critères
- [ ] Configuration Supabase + PostGIS
- [ ] Ingestion des géométries France
- [ ] Déploiement preview Vercel

### Phase 2: Multi-Critères
- [ ] Pipeline d'ingestion de données
- [ ] Implémentation des 5 critères principaux
- [ ] Capas superposées interactives
- [ ] Tooltips et recherche

### Phase 3: Navigation Multi-niveau
- [ ] Routes dynamiques (région/département/commune)
- [ ] Navigation hiérarchique
- [ ] Panel de détails avec radar chart

### Phase 4: Fonctionnalités Consultant
- [ ] Authentification multi-tenant (Clerk)
- [ ] Profils de clients
- [ ] Génération de rapports PDF

## License

Proprietary - All rights reserved

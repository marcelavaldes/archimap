# French Public Data API Sources for ArchiMap

This document lists available French public data APIs and datasets for commune-level criteria used in ArchiMap scoring system.

Last updated: 2026-02-13

---

## 1. CLIMATE DATA

### Météo-France Open Data

**Source:** Météo-France via data.gouv.fr
**Data Portal:** https://donneespubliques.meteofrance.fr/
**Documentation:** https://confluence-meteofrance.atlassian.net/wiki/spaces/OpenDataMeteoFrance/overview

#### Available Data
- Daily climatological data (temperature, rainfall, wind)
- Sunshine hours (in "autres-paramètres" files)
- Historical data since station establishment

#### Data Format
- **Format:** CSV (compressed)
- **Organization:** By department and time period batches
- **Granularity:** Meteorological station level (not direct commune mapping)

#### Dataset URLs
- Main dataset: https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes
- API info: https://www.data.gouv.fr/en/dataservices/api-donnees-climatologiques/

#### Access Method
1. Download CSV files organized by department
2. Files are named with patterns like "RR-T-vent" (rainfall-temperature-wind)
3. Map station coordinates to nearest communes using geographic proximity

#### Authentication
- **Required:** No
- **API Key:** Not required for downloads

#### Update Frequency
- Daily updates for recent data
- Historical data available for all periods

#### Example Usage
```bash
# Download department-level climate data
wget https://www.data.gouv.fr/[department-specific-url]

# Files contain:
# - date, station_id, temperature_min, temperature_max, rainfall, wind_speed
# - Additional files for sunshine duration
```

#### Alternative: Open-Meteo API
- **URL:** https://open-meteo.com/en/docs/meteofrance-api
- **Format:** JSON
- **Commune Access:** By latitude/longitude coordinates

#### Notes
- Data is at station level, requires geocoding to commune
- For commune-level aggregation, use nearest station or interpolation
- Sunshine hours may require separate data files

---

## 2. PROPERTY PRICES (Prix Immobilier)

### DVF - Demandes de Valeurs Foncières

**Source:** DGFiP (Direction Générale des Finances Publiques) via Etalab
**Main Portal:** https://app.dvf.etalab.gouv.fr/
**Dataset:** https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres

#### Available Data
- All real estate and land sales in France (excluding Alsace, Moselle, Mayotte)
- Transaction data since 2014
- Property types, sale prices, surface areas, dates

#### API Endpoints

**1. Etalab Micro-API (Christian Quest)**
- **Base URL:** `http://api.cquest.org/dvf`
- **Format:** JSON
- **Documentation:** https://github.com/cquest/dvf_as_api

**Query Examples:**
```bash
# By commune code
curl "http://api.cquest.org/dvf?code_commune=75101"

# By cadastral section
curl "http://api.cquest.org/dvf?section=75101000AB"

# By parcel number
curl "http://api.cquest.org/dvf?numero_plan=75101000AB0001"
```

**2. SOGEFI API DVF+**
- **Website:** https://www.sogefi-sig.com/geoservices-apis-wms/api-dvf/
- **Features:** Geolocation, advanced querying
- **Format:** GeoJSON, JSON
- **Note:** Commercial service (may require subscription)

**3. Official API Données Foncières**
- **URL:** https://www.data.gouv.fr/dataservices/api-donnees-foncieres
- **Endpoints:**
  - `Géomutations`: Returns mutations in GeoJSON for commune
  - `Mutations`: Returns mutations for rectangular extent

#### Data Format
```json
{
  "id_mutation": "2023-12345",
  "date_mutation": "2023-01-15",
  "nature_mutation": "Vente",
  "valeur_fonciere": 350000,
  "adresse_numero": "12",
  "adresse_nom_voie": "Rue de la République",
  "code_postal": "75001",
  "code_commune": "75101",
  "nom_commune": "PARIS 1ER ARRONDISSEMENT",
  "type_local": "Appartement",
  "surface_reelle_bati": 65,
  "nombre_pieces_principales": 3
}
```

#### Authentication
- **Required:** No
- **Rate Limits:** May apply on some endpoints

#### Update Frequency
- Updated every 6 months (April and October)

#### Coverage
- **Start Date:** 2014
- **Excluded:** Alsace, Moselle, Mayotte

#### Notes
- For average commune prices, aggregate transactions over time periods
- Filter by `type_local` for property type analysis
- Use `surface_reelle_bati` to calculate price per m²

---

## 3. PROPERTY TAX (Taxe Foncière)

### Fiscalité Locale des Particuliers

**Source:** DGFiP (Direction Générale des Finances Publiques)
**Portal:** https://data.economie.gouv.fr/pages/fiscalite-locale-particuliers/

#### Available Data
- Property tax rates on built properties (TFPB)
- Property tax rates on non-built properties (TFNB)
- Housing tax (TH)
- Waste collection tax (TEOM)
- Data for communes and intercommunalities

#### API Endpoint
**Base URL:** `https://data.economie.gouv.fr/explore/dataset/fiscalite-locale-des-particuliers/api/`

**Geographic Dataset:** `https://data.economie.gouv.fr/explore/dataset/fiscalite-locale-des-particuliers-geo/`

#### Query Examples
```bash
# OpenDataSoft API format
curl "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records?where=code_commune='75101'&limit=20"

# Export as CSV
curl "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/exports/csv?where=code_commune='75101'"
```

#### Available Fields
- `code_commune`: INSEE commune code
- `nom_commune`: Commune name
- `annee`: Year
- `tfpb_taux_com`: Property tax rate (commune)
- `tfpb_taux_epci`: Property tax rate (intercommunality)
- `tfpb_taux_total`: Total property tax rate
- `teom_taux`: Waste collection tax rate

#### Alternative: REI Database
**Dataset:** Fichier de recensement des éléments d'imposition (REI)
**URL:** https://data.economie.gouv.fr/explore/dataset/impots-locaux-fichier-de-recensement-des-elements-dimposition-a-la-fiscalite-dir/

Contains detailed tax data by beneficiary (commune, department, region)

#### Data Format
- **Formats:** CSV, JSON, Excel, GeoJSON
- **API:** OpenDataSoft REST API v2.1

#### Authentication
- **Required:** No
- **API Key:** Not required

#### Update Frequency
- Annual updates
- Historical data available from 2021-2024
- REI file published in June each year

#### Interactive Tool
- Visual map: https://www.economie.gouv.fr/particuliers/impots-et-fiscalite/gerer-mes-impots-locaux/impots-locaux-visualisez-les-donnees-pres-de-chez-vous

---

## 4. HOSPITAL ACCESS & HEALTHCARE

### BPE - Base Permanente des Équipements

**Source:** INSEE
**Portal:** https://www.data.gouv.fr/datasets/base-permanente-des-equipements-1

#### Available Data
- Location of healthcare facilities by commune
- Hospital types (general, specialized, emergency services)
- Healthcare professionals (doctors, pharmacies)
- Equipment coordinates for distance calculations

#### Data Access
**Download URLs:**
- National BPE: https://www.data.gouv.fr/datasets/base-permanente-des-equipements-1
- Regional versions available (e.g., Île-de-France, Occitanie)

#### Data Structure
- **Format:** CSV, Excel
- **Granularity:** Commune and IRIS (sub-commune) levels
- **Equipment Types:**
  - Health domain codes: urgences, hopital, medecin, pharmacie
  - Equipment coordinates for distance calculations

#### Example Fields
```csv
DEPCOM,TYPEQU,NB_EQUIP,LAMBERT_X,LAMBERT_Y
75101,D106,1,652500,6862000
```

Field definitions:
- `DEPCOM`: Commune code (INSEE)
- `TYPEQU`: Equipment type code
- `NB_EQUIP`: Number of equipment units
- `LAMBERT_X`, `LAMBERT_Y`: Coordinates

#### Healthcare-Specific Datasets
**Île-de-France Health Services:**
- URL: https://data.iledefrance.fr/explore/dataset/les-service-de-sante-par-commune-ou-par-arrondissement-base-permanente-des-equip/
- Pre-filtered for health services

#### Access Time Calculation
To calculate hospital access time:
1. Extract hospital coordinates from BPE
2. Use commune centroid or population-weighted center
3. Calculate distances using road network or isochrone APIs
4. Consider: OpenRouteService API, IGN API, or OSRM

#### Authentication
- **Required:** No
- **API Key:** Not required for downloads

#### Update Frequency
- Annual updates (typically published in June)
- Latest version: BPE 2023

#### Notes
- Equipment codes documentation available from INSEE
- For access times, combine with routing APIs
- Health domain includes: hospitals, doctors, pharmacies, emergency services

---

## 5. INTERNET SPEED & BROADBAND

### ARCEP - Ma Connexion Internet

**Source:** ARCEP (Autorité de régulation des communications électroniques)
**Portal:** https://cartefibre.arcep.fr/
**Data Repository:** https://data.arcep.fr/fixe/maconnexioninternet/

#### Available Data
- Internet speed eligibility by commune
- Broadband technology availability (fiber, ADSL, 4G, 5G)
- Number of eligible premises by speed class
- Coverage by operator

#### Data Structure
**Base URL:** `https://data.arcep.fr/fixe/maconnexioninternet/`

**Directory Structure:**
```
/base_imb/          # Building reference database
/eligibilite/       # Eligibility data
/fermeture_cuivre/  # Copper network closure
/reference/         # Reference tables
/statistiques/      # Statistics by geography
  /YYYY_TX/         # Year_Quarter (e.g., 2025_T4)
    /last/          # Latest version links
```

#### Commune-Level Files
1. **commune.csv** - Number of premises per commune
2. **commune_debit.csv** - Eligibility by speed class
3. **commune_techno.csv** - Eligibility by technology
4. **commune_meilleure_techno.csv** - Best available technology

#### Speed Classes
- Very high speed: ≥30 Mbps
- Superfast: ≥100 Mbps
- Ultra-fast: ≥1 Gbps

#### Example File Structure
```csv
code_commune,nb_locaux,debit_classe,nb_locaux_eligibles
75101,25430,30Mbps,25430
75101,25430,100Mbps,24800
75101,25430,1Gbps,22000
```

#### Download Examples
```bash
# Latest commune statistics
wget https://data.arcep.fr/fixe/maconnexioninternet/statistiques/last/commune.csv
wget https://data.arcep.fr/fixe/maconnexioninternet/statistiques/last/commune_debit.csv

# Specific quarter
wget https://data.arcep.fr/fixe/maconnexioninternet/statistiques/2025_T4/commune_debit.csv
```

#### Alternative Access
**OpenDataSoft Portal:** https://www.data.gouv.fr/en/datasets/ma-connexion-internet/
- Web interface with filters
- API endpoint available

#### Data Format
- **Primary Format:** CSV
- **Encoding:** UTF-8
- **Delimiter:** Comma or semicolon

#### Authentication
- **Required:** No
- **API Key:** Not required

#### Update Frequency
- Quarterly updates (T1, T2, T3, T4)
- Latest data typically 1-2 quarters behind current date

#### Interactive Map
- https://cartefibre.arcep.fr/
- Search by address for detailed coverage info

#### Notes
- Data aggregated at premise level, rolled up to commune
- Use `commune_debit.csv` for speed class percentages
- Consider best available technology vs. average eligibility

---

## 6. PUBLIC TRANSPORT

### Transport.data.gouv.fr

**Source:** National Access Point for transport open data
**Portal:** https://transport.data.gouv.fr/

#### Available Data
- GTFS (General Transit Feed Specification) datasets
- NeTEx format data
- Real-time GTFS-RT feeds
- Coverage for 75+ operators nationwide

#### Data Access
**Main Portal:** https://transport.data.gouv.fr/datasets?type=public-transit

**API for Transport Data:**
- TADAO API: https://www.data.gouv.fr/dataservices/api-tadao-donnees-de-transport-public-gtfs-2

#### GTFS Format
Standard Google Transit format containing:
- `stops.txt` - Stop locations with coordinates
- `routes.txt` - Transit routes
- `trips.txt` - Trip schedules
- `stop_times.txt` - Stop arrival/departure times
- `calendar.txt` - Service schedules

#### Transport Score Calculation
To calculate transport score for a commune:

1. **Download GTFS datasets** for relevant regions
2. **Extract stops** within commune boundaries
3. **Calculate metrics:**
   - Number of stops per km²
   - Frequency of service (trips per day)
   - Diversity of routes
   - Operating hours span

4. **Weight by population** for normalized score

#### Example GTFS Usage
```python
import pandas as pd

# Load GTFS stops
stops = pd.read_csv('stops.txt')

# Filter by commune (requires geospatial join)
commune_stops = stops[
    (stops['stop_lat'] >= lat_min) &
    (stops['stop_lat'] <= lat_max) &
    (stops['stop_lon'] >= lon_min) &
    (stops['stop_lon'] <= lon_max)
]

# Count unique routes serving the commune
stop_times = pd.read_csv('stop_times.txt')
trips = pd.read_csv('trips.txt')
routes_in_commune = trips[
    trips['trip_id'].isin(
        stop_times[stop_times['stop_id'].isin(commune_stops['stop_id'])]['trip_id']
    )
]['route_id'].nunique()
```

#### Regional Datasets
Major urban areas have dedicated datasets:
- **Île-de-France (IDFM):** https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites
- **Major cities:** Separate GTFS feeds per city network

#### Data Format
- **Primary:** GTFS (ZIP archive with CSV files)
- **Alternative:** NeTEx (XML)
- **Real-time:** GTFS-RT (Protocol Buffers)

#### Authentication
- **Required:** No
- **API Key:** Not required for downloads

#### Update Frequency
- Varies by operator
- Major networks: weekly to monthly
- Quality indicators shown per dataset

#### Validation
- Platform includes quality validation tools
- Compliance scores available per dataset

#### Notes
- No direct "transport score" API - must calculate from GTFS
- Consider combining with population density
- Urban vs rural areas require different scoring approaches
- For routing calculations, use GTFS with routing engines (e.g., OpenTripPlanner)

---

## 7. CRIME RATE

### SSMSI - Service Statistique Ministériel de la Sécurité Intérieure

**Source:** Ministry of Interior (Police & Gendarmerie data)
**Portal:** https://www.data.gouv.fr/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales

#### Available Data
- Crimes and offenses recorded since 2016
- Municipal, departmental, and regional levels
- Indicators by crime type (violence, theft, vandalism, fraud)
- Data based on offense location

#### Crime Indicators (Updated 2025)
- Burglaries (residential and non-residential)
- Theft of vehicles and from vehicles
- Physical violence within families (new 2025)
- Physical violence outside family settings (new 2025)
- Sexual violence
- Drug-related offenses
- Fraud (added at municipal level in March 2025)
- Vandalism

#### Data Structure
**Files Available:**
1. **Municipal database** (`base_communale_YYYY.csv`)
2. **Departmental database** (`base_departementale_YYYY.csv`)
3. **Regional database** (`base_regionale_YYYY.csv`)

#### Example Fields
```csv
code_commune,nom_commune,annee,indicateur,nombre_faits,taux_pour_1000_hab
75101,PARIS 1ER ARRONDISSEMENT,2024,CAMBRIOLAGES,245,9.6
75101,PARIS 1ER ARRONDISSEMENT,2024,VIOLENCES_FAMILIALES,78,3.1
```

#### Download Access
```bash
# Direct download from data.gouv.fr
wget https://www.data.gouv.fr/fr/datasets/r/[resource-id]/base_communale_2024.csv
```

#### Additional Fields
- Official geographic codes (commune, department, region)
- Labels for each geographic level
- Resident population for rate calculations

#### Data Format
- **Format:** CSV
- **Encoding:** UTF-8
- **Delimiter:** Semicolon (;) or comma

#### Authentication
- **Required:** No
- **API Key:** Not required

#### Update Frequency
- Annual updates
- Latest data typically includes previous complete year
- Mid-year updates for new indicators

#### Geography Updates
- Commune codes updated annually (as of January 1st)
- Accounts for commune mergers/changes

#### Calculation Notes
- Rates calculated per 1,000 inhabitants
- Population data included in files
- Use `taux_pour_1000_hab` for comparable crime rates

#### Privacy Considerations
- Small communes may have masked data (privacy protection)
- Aggregate indicators only, no individual case data

#### Notes
- Data shows reported crimes only (not all actual crimes)
- Location based on where offense occurred, not perpetrator residence
- Recent indicator changes (2025) improve family violence tracking
- Fraud indicator added at municipal level in March 2025

---

## 8. CULTURAL VENUES

### Basilic - Base des Lieux et Équipements Culturels

**Source:** Ministry of Culture
**Portal:** https://data.culture.gouv.fr/explore/dataset/base-des-lieux-et-des-equipements-culturels/

#### Available Data
- Museums, theaters, cinemas, libraries
- Cultural centers, concert halls
- Historical monuments
- Geographic coordinates for all venues

#### API Endpoint
**Base URL:** `https://data.culture.gouv.fr/explore/dataset/base-des-lieux-et-des-equipements-culturels/api/`

#### API Query Examples
```bash
# OpenDataSoft API v2.1
# Get cultural venues in a commune
curl "https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-des-lieux-et-des-equipements-culturels/records?where=code_insee='75101'&limit=100"

# Filter by venue type
curl "https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-des-lieux-et-des-equipements-culturels/records?where=code_insee='75101' AND categorie='Musée'"

# Export as CSV
curl "https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-des-lieux-et-des-equipements-culturels/exports/csv?where=code_insee='75101'"
```

#### Available Fields
- `nom`: Venue name
- `code_insee`: Commune code
- `categorie`: Category (Musée, Théâtre, Cinéma, Bibliothèque, etc.)
- `sous_categorie`: Subcategory
- `adresse`: Address
- `coordonnees_geographiques`: GPS coordinates
- `telephone`, `site_web`, `email`: Contact info

#### Venue Categories
- Musées (Museums)
- Théâtres (Theaters)
- Cinémas (Cinemas)
- Bibliothèques et médiathèques (Libraries)
- Salles de spectacle (Performance venues)
- Centres culturels (Cultural centers)
- Monuments historiques (Historical monuments)
- Conservatoires (Conservatories)

#### Alternative: Museums of France List
**Dataset:** https://data.culture.gouv.fr/explore/dataset/liste-et-localisation-des-musees-de-france/api/
**Scope:** Official "Musée de France" labeled institutions
**Update:** Annual (based on High Council of Museums recommendations)

#### Data Format
- **Formats:** JSON, CSV, GeoJSON, Excel
- **API:** OpenDataSoft REST API v2.1
- **Geospatial:** Coordinates in WGS84 (latitude/longitude)

#### Cultural Score Calculation
```python
# Example calculation
cultural_venues = get_venues_for_commune(code_insee)
population = get_commune_population(code_insee)

# Calculate density
venues_per_10k = (len(cultural_venues) / population) * 10000

# Weight by category
weights = {
    'Musée': 3,
    'Théâtre': 2,
    'Cinéma': 1,
    'Bibliothèque': 2
}
weighted_score = sum(weights.get(v['categorie'], 1) for v in cultural_venues)
```

#### Authentication
- **Required:** No
- **API Key:** Not required
- **Rate Limits:** Standard OpenDataSoft limits apply

#### Update Frequency
- Regular updates from Ministry of Culture
- Data aggregated from multiple sources:
  - General Directorate of Heritage and Architecture
  - General Directorate of Artistic Creation
  - General Directorate of Media and Cultural Industries
  - Other cultural institutions

#### Geographic Coverage
- All French communes (metropolitan and overseas)
- Feeds into INSEE's BPE database

#### Notes
- Geocoded database with precise coordinates
- Combines multiple official cultural institution databases
- Part of Atlas Culture of territories initiative
- May not include all small/private cultural venues
- Official institutions prioritized

---

## 9. EMPLOYMENT & INCOME

### INSEE API Diffusion Données Locales

**Source:** INSEE (Institut national de la statistique et des études économiques)
**Portal:** https://api.gouv.fr/les-api/api_donnees_locales
**Catalog:** https://api.insee.fr/catalogue/

#### Available Data
**Employment Data:**
- Employment rate by age group
- Unemployment rate
- Active population
- Jobs by sector (ESTEL - Estimations d'Emploi Localisées)

**Income Data (Filosofi):**
- Median income (revenu médian)
- Income percentiles (D1, D9, interdecile ratio)
- Poverty rate
- Standard of living indicators

#### API Access
**Base Endpoint:** `https://api.insee.fr/donnees-locales/V0.1/`

**Authentication Required:** Yes
1. Create account at https://api.insee.fr/catalogue/
2. Create application and select "API Diffusion Données Locales"
3. Obtain consumer key and secret
4. Use OAuth 2.0 or include in headers

#### API Parameters
- `jeton`: Access token (required)
- `jeu_donnees`: Dataset code (e.g., "GEO2023FILOSOFI2021")
- `croisement`: Variable selection
- `modalite`: Selected modalities (e.g., "all.all")
- `nivgeo`: Geographic level ("COM" for commune)
- `codgeo`: INSEE commune code(s)

#### Example API Call
```bash
# Get OAuth token first
curl -X POST "https://api.insee.fr/token" \
  -H "Authorization: Basic [BASE64_ENCODED_CREDENTIALS]" \
  -d "grant_type=client_credentials"

# Query employment data for commune
curl "https://api.insee.fr/donnees-locales/V0.1/donnees/GEO2023REE2023/EMPLOI-CHOMAGE.all/COM/75101" \
  -H "Authorization: Bearer [ACCESS_TOKEN]"

# Query income data (Filosofi)
curl "https://api.insee.fr/donnees-locales/V0.1/donnees/GEO2023FILOSOFI2021/REVENU-MEDIAN.all/COM/75101" \
  -H "Authorization: Bearer [ACCESS_TOKEN]"
```

#### Available Datasets
**Employment (REE - Recensement de l'emploi):**
- `GEO2023REE2023` - 2023 employment census
- Variables:
  - Employment rate (taux d'emploi)
  - Unemployment rate (taux de chômage)
  - Active population (population active)

**Income (Filosofi):**
- `GEO2023FILOSOFI2021` - 2021 fiscal income data
- Variables:
  - Median standard of living (niveau de vie médian)
  - Poverty rate (taux de pauvreté)
  - Interdecile ratio (rapport interdécile)

#### R Package Example
```r
library(inseeLocalData)

# Set API credentials
options(insee.key = "YOUR_CONSUMER_KEY")
options(insee.secret = "YOUR_CONSUMER_SECRET")

# Get median income for commune
income_data <- get_dataset(
  jeu_donnees = "GEO2023FILOSOFI2021",
  croisement = "REVENU_MEDIAN",
  modalite = "all.all",
  nivgeo = "COM",
  codgeo = "75101"
)

# Get employment data
employment_data <- get_dataset(
  jeu_donnees = "GEO2023REE2023",
  croisement = "EMPLOI",
  modalite = "all.all",
  nivgeo = "COM",
  codgeo = "75101"
)
```

#### Python Package
```bash
pip install api-insee
```

```python
from api_insee import ApiInsee

api = ApiInsee(
    key="YOUR_CONSUMER_KEY",
    secret="YOUR_CONSUMER_SECRET"
)

# Get local data for commune
data = api.get_local_data(
    dataset="GEO2023FILOSOFI2021",
    variable="REVENU_MEDIAN",
    geography="COM",
    code="75101"
)
```

#### Data Format
- **Response Format:** JSON, XML
- **Structure:** Predefined cubes with INSEE dimensions

#### Geographic Levels Available
- `COM` - Commune
- `ARR` - Arrondissement
- `EPCI` - Intercommunality
- `DEP` - Department
- `REG` - Region
- `ZE` - Employment zone
- `UU` - Urban unit

#### Authentication Details
- **Method:** OAuth 2.0 Client Credentials
- **Token Endpoint:** https://api.insee.fr/token
- **Token Lifetime:** 7 days
- **Rate Limits:** 30 requests/minute, 5000 requests/day (may vary)

#### Update Frequency
**Employment (REE):**
- Annual updates
- Based on population census (rolling survey)

**Income (Filosofi):**
- Annual publication
- Data typically 2 years behind (e.g., 2021 data published in 2023)

#### Alternative Access
**INSEE Website Downloads:**
- https://www.insee.fr/fr/statistiques/fichier/
- Pre-aggregated commune-level files
- No API key required but less flexible

**Datasets:**
- Employment: Search for "Estimations d'emploi" or "REE"
- Income: Search for "Filosofi" or "revenus fiscaux"

#### Notes
- Filosofi = Fichier localisé social et fiscal
- REE = Recensement de l'emploi et de l'économie
- ESTEL provides job counts by commune and sector
- Small communes may have suppressed values (privacy)
- Median income more reliable than mean for comparison
- API returns predefined cubes, not raw microdata

---

## 10. SUPPLEMENTARY DATA SOURCES

### Geographic Reference Data

#### API Découpage Administratif
**URL:** https://geo.api.gouv.fr/decoupage-administratif/communes
**Purpose:** Commune boundaries, codes, names, populations

**Example:**
```bash
# Get commune info by INSEE code
curl "https://geo.api.gouv.fr/communes/75101"

# Get communes in department
curl "https://geo.api.gouv.fr/departements/75/communes"

# Search by name
curl "https://geo.api.gouv.fr/communes?nom=Paris&fields=nom,code,codesPostaux,population"
```

**Fields:**
- `code`: INSEE code
- `nom`: Name
- `population`: Population
- `surface`: Area in hectares
- `centre`: Centroid coordinates
- `contour`: Boundary polygon (optional)

**Authentication:** Not required
**Format:** JSON, GeoJSON

---

## SUMMARY TABLE

| Criterion | Source | API Available | Auth Required | Update Frequency | Format |
|-----------|--------|---------------|---------------|------------------|--------|
| **Climate** | Météo-France | ⚠️ Download only | ❌ No | Daily | CSV |
| **Property Prices** | DVF (Etalab) | ✅ Yes | ❌ No | Bi-annual | JSON |
| **Property Tax** | DGFiP | ✅ Yes | ❌ No | Annual | CSV, JSON |
| **Hospital Access** | BPE (INSEE) | ⚠️ Download only | ❌ No | Annual | CSV |
| **Internet Speed** | ARCEP | ⚠️ Download only | ❌ No | Quarterly | CSV |
| **Public Transport** | Transport.gouv | ⚠️ Download only | ❌ No | Varies | GTFS |
| **Crime Rate** | SSMSI | ⚠️ Download only | ❌ No | Annual | CSV |
| **Cultural Venues** | Basilic | ✅ Yes | ❌ No | Ongoing | JSON, CSV |
| **Employment** | INSEE API | ✅ Yes | ✅ Yes | Annual | JSON |
| **Income** | INSEE API | ✅ Yes | ✅ Yes | Annual | JSON |
| **Geography** | geo.api.gouv | ✅ Yes | ❌ No | Real-time | JSON |

**Legend:**
- ✅ Full API with query capabilities
- ⚠️ Download files, process locally
- ❌ No / ✅ Yes

---

## INTEGRATION RECOMMENDATIONS

### Priority 1: Direct APIs (Use Immediately)
1. **DVF API** - Property prices via `api.cquest.org/dvf`
2. **Fiscalité Locale API** - Property tax via OpenDataSoft
3. **Basilic API** - Cultural venues via Ministry of Culture
4. **geo.api.gouv** - Geographic reference data

### Priority 2: Download & Process
1. **ARCEP** - Internet speed (quarterly CSV downloads)
2. **BPE** - Hospital/healthcare equipment (annual CSV)
3. **Transport.data.gouv** - GTFS files for transport score
4. **SSMSI** - Crime statistics (annual CSV)
5. **Météo-France** - Climate data (daily CSV by department)

### Priority 3: Authenticated APIs
1. **INSEE API** - Employment and income (requires OAuth token)
   - Worth implementing for automated updates
   - Alternative: download pre-aggregated files

### Data Pipeline Approach

```
1. SETUP PHASE:
   - Create INSEE API account
   - Download static datasets (BPE, ARCEP, crime)
   - Set up automated GTFS downloads

2. INITIAL LOAD:
   - Process all communes from geo.api.gouv
   - Load static datasets into database
   - Calculate derived metrics (transport score, hospital distance)

3. PERIODIC UPDATES:
   - Quarterly: ARCEP internet data
   - Bi-annual: DVF property prices
   - Annual: Crime, BPE, income, employment, tax rates
   - Daily: Climate data (if real-time scoring needed)

4. REAL-TIME QUERIES:
   - Property tax via API
   - Cultural venues via API
   - Property prices via DVF API
   - Geographic data via geo.api.gouv
```

### Computed Metrics

Some criteria require calculation:

1. **Hospital Access Time:**
   - Extract hospital coordinates from BPE
   - Use routing API (OpenRouteService, OSRM, IGN)
   - Calculate isochrone or shortest path
   - Store precomputed values

2. **Public Transport Score:**
   - Parse GTFS stops and schedules
   - Count stops per commune area
   - Calculate service frequency
   - Weight by population density
   - Normalize to 0-100 scale

3. **Climate Averages:**
   - Map stations to communes (nearest or interpolation)
   - Calculate annual averages (temperature, rainfall, sunshine)
   - Store historical averages for scoring

4. **Property Price Averages:**
   - Aggregate DVF transactions by commune and time period
   - Calculate median price per m² by property type
   - Update bi-annually

---

## TECHNICAL NOTES

### Geographic Matching
- All data uses **INSEE commune codes** (5 digits for metropolitan, more for overseas)
- Commune boundaries change annually (mergers, splits)
- Use `geo.api.gouv.fr` to maintain current commune reference
- Consider historical mapping for time-series data

### Data Quality Considerations
1. **Small Communes:**
   - Some data suppressed for privacy (crime, income)
   - May need aggregation to EPCI or canton level
   - Consider minimum population thresholds

2. **Missing Data:**
   - Not all communes have all equipment (especially rural)
   - Climate stations don't cover all communes directly
   - Some GTFS feeds may be incomplete

3. **Update Lags:**
   - Income data typically 2 years behind
   - Some datasets update irregularly
   - Document data vintage in user interface

### Performance Optimization
1. **Caching:**
   - Pre-download and process static datasets
   - Cache API responses with appropriate TTL
   - Store computed metrics in database

2. **Batch Processing:**
   - INSEE API has rate limits (30/min)
   - Batch requests for multiple communes
   - Use geographic hierarchy (department → communes)

3. **Spatial Queries:**
   - Store commune boundaries for spatial joins
   - Use PostGIS or similar for geographic calculations
   - Pre-compute distances for common queries

---

## SOURCES AND REFERENCES

### Climate
- [Données Publiques de Météo-France](https://donneespubliques.meteofrance.fr/)
- [Données climatologiques de base - data.gouv.fr](https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes)
- [API Données climatologiques](https://www.data.gouv.fr/en/dataservices/api-donnees-climatologiques/)
- [Météo-France Open Data Documentation](https://confluence-meteofrance.atlassian.net/wiki/spaces/OpenDataMeteoFrance/overview)

### Property Prices (DVF)
- [DVF Application](https://app.dvf.etalab.gouv.fr/)
- [Demandes de valeurs foncières - data.gouv.fr](https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres)
- [DVF API by Christian Quest](https://github.com/cquest/dvf_as_api)
- [SOGEFI API DVF+](https://www.sogefi-sig.com/geoservices-apis-wms/api-dvf/)

### Property Tax
- [Fiscalité Locale des Particuliers](https://data.economie.gouv.fr/pages/fiscalite-locale-particuliers/)
- [Fiscalité locale API](https://data.economie.gouv.fr/explore/dataset/fiscalite-locale-des-particuliers/api/)
- [REI Database](https://data.economie.gouv.fr/explore/dataset/impots-locaux-fichier-de-recensement-des-elements-dimposition-a-la-fiscalite-dir/)

### Healthcare
- [Base Permanente des Équipements - data.gouv.fr](https://www.data.gouv.fr/datasets/base-permanente-des-equipements-1)
- [Services de santé Île-de-France](https://data.iledefrance.fr/explore/dataset/les-service-de-sante-par-commune-ou-par-arrondissement-base-permanente-des-equip/)
- [BPE Documentation - INSEE](https://outil2amenagement.cerema.fr/actualites/la-base-permanente-des-equipements-bpe-presentee-linsee)

### Internet Speed
- [ARCEP Open Data](https://en.arcep.fr/maps-data/open-data.html)
- [Ma Connexion Internet](https://cartefibre.arcep.fr/)
- [ARCEP Data Repository](https://data.arcep.fr/fixe/maconnexioninternet/)
- [Ma Connexion Internet - data.gouv.fr](https://www.data.gouv.fr/en/datasets/ma-connexion-internet/)

### Public Transport
- [Transport.data.gouv.fr](https://transport.data.gouv.fr/)
- [Public Transit Datasets](https://transport.data.gouv.fr/datasets?type=public-transit)
- [API TADAO](https://www.data.gouv.fr/dataservices/api-tadao-donnees-de-transport-public-gtfs-2)

### Crime Statistics
- [Crime Statistics - data.gouv.fr](https://www.data.gouv.fr/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales)

### Cultural Venues
- [Basilic - Ministry of Culture](https://data.culture.gouv.fr/explore/dataset/base-des-lieux-et-des-equipements-culturels/api/)
- [Museums of France](https://data.culture.gouv.fr/explore/dataset/liste-et-localisation-des-musees-de-france/api/)

### Employment & Income
- [API Diffusion Données Locales](https://api.gouv.fr/les-api/api_donnees_locales)
- [INSEE API Catalog](https://api.insee.fr/catalogue/)
- [INSEE Producers Page](https://api.gouv.fr/producteurs/insee)
- [inseeLocalData R Package](https://github.com/InseeFrLab/inseeLocalData)

### Geographic Reference
- [API Découpage Administratif](https://geo.api.gouv.fr/decoupage-administratif/communes)

---

## CHANGELOG

**2026-02-13** - Initial documentation
- Researched and documented all 10 criteria data sources
- Identified API endpoints and download URLs
- Documented authentication requirements
- Provided example API calls and data formats
- Created integration recommendations

---

## NEXT STEPS

1. **Test API Endpoints:** Validate each API with sample requests
2. **Create INSEE Account:** Set up authentication for employment/income data
3. **Download Static Datasets:** BPE, ARCEP, crime, climate data
4. **Design Database Schema:** Structure to store commune-level data
5. **Build ETL Pipeline:** Automated data ingestion and updates
6. **Implement Scoring Algorithms:** Transform raw data into normalized scores
7. **Set Up Monitoring:** Track data freshness and API availability

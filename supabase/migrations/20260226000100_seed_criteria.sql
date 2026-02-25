-- Seed criteria table with the 12 criteria from src/types/criteria.ts

INSERT INTO criteria (id, name, name_en, category, description, unit, source, last_updated, higher_is_better, color_scale_low, color_scale_mid, color_scale_high, enabled, display_order, ingestion_type, api_config) VALUES
  ('temperature', 'Température moyenne', 'Average Temperature', 'climate',
   'Température moyenne annuelle en degrés Celsius', '°C', 'Météo France',
   '2025-01-01', true, '#3b82f6', '#fbbf24', '#ef4444', true, 1, 'manual', NULL),

  ('sunshine', 'Heures d''ensoleillement', 'Sunshine Hours', 'climate',
   'Nombre d''heures d''ensoleillement par an', 'h/an', 'Météo France',
   '2025-01-01', true, '#94a3b8', '#fcd34d', '#f59e0b', true, 2, 'manual', NULL),

  ('rainfall', 'Précipitations', 'Rainfall', 'climate',
   'Précipitations moyennes annuelles en millimètres', 'mm/an', 'Météo France',
   '2025-01-01', false, '#fef3c7', '#60a5fa', '#1e40af', true, 3, 'manual', NULL),

  ('propertyPrice', 'Prix immobilier', 'Property Price', 'cost',
   'Prix médian au m² pour les appartements et maisons', '€/m²', 'DVF (data.gouv.fr)',
   '2025-01-01', false, '#22c55e', '#eab308', '#dc2626', true, 4, 'api',
   '{"script": "ingest-property-prices.ts", "description": "DVF open data API"}'),

  ('localTax', 'Taxe foncière', 'Property Tax', 'cost',
   'Taux de taxe foncière sur les propriétés bâties', '%', 'data.gouv.fr',
   '2025-01-01', false, '#22c55e', '#eab308', '#dc2626', true, 5, 'api',
   '{"script": "ingest-local-tax.ts", "description": "data.gouv.fr open data"}'),

  ('hospitalAccess', 'Accès hôpital', 'Hospital Access', 'services',
   'Temps d''accès moyen au service d''urgence le plus proche', 'min', 'INSEE',
   '2025-01-01', false, '#22c55e', '#eab308', '#dc2626', true, 6, 'manual', NULL),

  ('publicTransport', 'Transport en commun', 'Public Transport', 'services',
   'Score d''accessibilité aux transports en commun (0-100)', 'score', 'INSEE',
   '2025-01-01', true, '#fca5a5', '#fcd34d', '#4ade80', true, 7, 'manual', NULL),

  ('internetSpeed', 'Débit internet', 'Internet Speed', 'services',
   'Débit internet médian disponible', 'Mbps', 'ARCEP',
   '2025-01-01', true, '#ef4444', '#fbbf24', '#22c55e', true, 8, 'api',
   '{"script": "ingest-internet-speed.ts", "description": "ARCEP open data API"}'),

  ('crimeRate', 'Taux de criminalité', 'Crime Rate', 'quality',
   'Nombre de crimes et délits pour 1000 habitants', '‰', 'Ministère de l''Intérieur',
   '2025-01-01', false, '#22c55e', '#eab308', '#dc2626', true, 9, 'manual', NULL),

  ('culturalVenues', 'Équipements culturels', 'Cultural Venues', 'quality',
   'Nombre d''équipements culturels pour 10000 habitants', '/10k hab', 'Ministère de la Culture',
   '2025-01-01', true, '#e2e8f0', '#a78bfa', '#7c3aed', true, 10, 'api',
   '{"script": "ingest-cultural-venues.ts", "description": "Ministère de la Culture open data"}'),

  ('employmentRate', 'Taux d''emploi', 'Employment Rate', 'employment',
   'Taux d''emploi des 15-64 ans', '%', 'INSEE',
   '2025-01-01', true, '#fca5a5', '#fcd34d', '#4ade80', true, 11, 'manual', NULL),

  ('medianIncome', 'Revenu médian', 'Median Income', 'employment',
   'Revenu médian disponible par unité de consommation', '€/an', 'INSEE',
   '2025-01-01', true, '#fca5a5', '#fcd34d', '#4ade80', true, 12, 'manual', NULL);

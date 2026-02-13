export type CriterionCategory =
  | 'climate'
  | 'cost'
  | 'services'
  | 'quality'
  | 'employment';

export interface Criterion {
  id: string;
  name: string;
  nameEn: string;
  category: CriterionCategory;
  description: string;
  unit: string;
  source: string;
  lastUpdated: string;
  higherIsBetter: boolean;
  colorScale: {
    low: string;
    mid: string;
    high: string;
  };
}

export const CRITERIA: Record<string, Criterion> = {
  temperature: {
    id: 'temperature',
    name: 'Température moyenne',
    nameEn: 'Average Temperature',
    category: 'climate',
    description: 'Température moyenne annuelle en degrés Celsius',
    unit: '°C',
    source: 'Météo France',
    lastUpdated: '2025-01',
    higherIsBetter: true,
    colorScale: {
      low: '#3b82f6',  // blue
      mid: '#fbbf24',  // yellow
      high: '#ef4444', // red
    },
  },
  sunshine: {
    id: 'sunshine',
    name: 'Heures d\'ensoleillement',
    nameEn: 'Sunshine Hours',
    category: 'climate',
    description: 'Nombre d\'heures d\'ensoleillement par an',
    unit: 'h/an',
    source: 'Météo France',
    lastUpdated: '2025-01',
    higherIsBetter: true,
    colorScale: {
      low: '#94a3b8',  // gray
      mid: '#fcd34d',  // light yellow
      high: '#f59e0b', // orange
    },
  },
  rainfall: {
    id: 'rainfall',
    name: 'Précipitations',
    nameEn: 'Rainfall',
    category: 'climate',
    description: 'Précipitations moyennes annuelles en millimètres',
    unit: 'mm/an',
    source: 'Météo France',
    lastUpdated: '2025-01',
    higherIsBetter: false,
    colorScale: {
      low: '#fef3c7',  // light
      mid: '#60a5fa',  // medium blue
      high: '#1e40af', // dark blue
    },
  },
  propertyPrice: {
    id: 'propertyPrice',
    name: 'Prix immobilier',
    nameEn: 'Property Price',
    category: 'cost',
    description: 'Prix médian au m² pour les appartements et maisons',
    unit: '€/m²',
    source: 'DVF (data.gouv.fr)',
    lastUpdated: '2025-01',
    higherIsBetter: false,
    colorScale: {
      low: '#22c55e',  // green (affordable)
      mid: '#eab308',  // yellow
      high: '#dc2626', // red (expensive)
    },
  },
  localTax: {
    id: 'localTax',
    name: 'Taxe foncière',
    nameEn: 'Property Tax',
    category: 'cost',
    description: 'Taux de taxe foncière sur les propriétés bâties',
    unit: '%',
    source: 'data.gouv.fr',
    lastUpdated: '2025-01',
    higherIsBetter: false,
    colorScale: {
      low: '#22c55e',
      mid: '#eab308',
      high: '#dc2626',
    },
  },
  hospitalAccess: {
    id: 'hospitalAccess',
    name: 'Accès hôpital',
    nameEn: 'Hospital Access',
    category: 'services',
    description: 'Temps d\'accès moyen au service d\'urgence le plus proche',
    unit: 'min',
    source: 'INSEE',
    lastUpdated: '2025-01',
    higherIsBetter: false,
    colorScale: {
      low: '#22c55e',  // green (close)
      mid: '#eab308',
      high: '#dc2626', // red (far)
    },
  },
  publicTransport: {
    id: 'publicTransport',
    name: 'Transport en commun',
    nameEn: 'Public Transport',
    category: 'services',
    description: 'Score d\'accessibilité aux transports en commun (0-100)',
    unit: 'score',
    source: 'INSEE',
    lastUpdated: '2025-01',
    higherIsBetter: true,
    colorScale: {
      low: '#fca5a5',
      mid: '#fcd34d',
      high: '#4ade80',
    },
  },
  internetSpeed: {
    id: 'internetSpeed',
    name: 'Débit internet',
    nameEn: 'Internet Speed',
    category: 'services',
    description: 'Débit internet médian disponible',
    unit: 'Mbps',
    source: 'ARCEP',
    lastUpdated: '2025-01',
    higherIsBetter: true,
    colorScale: {
      low: '#ef4444',
      mid: '#fbbf24',
      high: '#22c55e',
    },
  },
  crimeRate: {
    id: 'crimeRate',
    name: 'Taux de criminalité',
    nameEn: 'Crime Rate',
    category: 'quality',
    description: 'Nombre de crimes et délits pour 1000 habitants',
    unit: '‰',
    source: 'Ministère de l\'Intérieur',
    lastUpdated: '2025-01',
    higherIsBetter: false,
    colorScale: {
      low: '#22c55e',
      mid: '#eab308',
      high: '#dc2626',
    },
  },
  culturalVenues: {
    id: 'culturalVenues',
    name: 'Équipements culturels',
    nameEn: 'Cultural Venues',
    category: 'quality',
    description: 'Nombre d\'équipements culturels pour 10000 habitants',
    unit: '/10k hab',
    source: 'Ministère de la Culture',
    lastUpdated: '2025-01',
    higherIsBetter: true,
    colorScale: {
      low: '#e2e8f0',
      mid: '#a78bfa',
      high: '#7c3aed',
    },
  },
  employmentRate: {
    id: 'employmentRate',
    name: 'Taux d\'emploi',
    nameEn: 'Employment Rate',
    category: 'employment',
    description: 'Taux d\'emploi des 15-64 ans',
    unit: '%',
    source: 'INSEE',
    lastUpdated: '2025-01',
    higherIsBetter: true,
    colorScale: {
      low: '#fca5a5',
      mid: '#fcd34d',
      high: '#4ade80',
    },
  },
  medianIncome: {
    id: 'medianIncome',
    name: 'Revenu médian',
    nameEn: 'Median Income',
    category: 'employment',
    description: 'Revenu médian disponible par unité de consommation',
    unit: '€/an',
    source: 'INSEE',
    lastUpdated: '2025-01',
    higherIsBetter: true,
    colorScale: {
      low: '#fca5a5',
      mid: '#fcd34d',
      high: '#4ade80',
    },
  },
};

export const CRITERION_CATEGORIES: Record<CriterionCategory, { name: string; icon: string }> = {
  climate: { name: 'Climat et Géographie', icon: '☀️' },
  cost: { name: 'Coût de la Vie', icon: '💰' },
  services: { name: 'Services et Connectivité', icon: '🏥' },
  quality: { name: 'Qualité de Vie', icon: '🎭' },
  employment: { name: 'Emploi', icon: '💼' },
};

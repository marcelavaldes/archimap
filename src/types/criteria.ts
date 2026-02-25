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

export const CRITERION_CATEGORIES: Record<CriterionCategory, { name: string; icon: string }> = {
  climate: { name: 'Climat et Géographie', icon: '☀️' },
  cost: { name: 'Coût de la Vie', icon: '💰' },
  services: { name: 'Services et Connectivité', icon: '🏥' },
  quality: { name: 'Qualité de Vie', icon: '🎭' },
  employment: { name: 'Emploi', icon: '💼' },
};

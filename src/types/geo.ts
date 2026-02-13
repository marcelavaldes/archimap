export interface Region {
  code: string;
  nom: string;
  geometry?: GeoJSON.Geometry;
}

export interface Departement {
  code: string;
  nom: string;
  codeRegion: string;
  geometry?: GeoJSON.Geometry;
}

export interface Commune {
  code: string; // INSEE code
  nom: string;
  codeDepartement: string;
  codeRegion: string;
  population?: number;
  geometry?: GeoJSON.Geometry;
}

export type AdminLevel = 'region' | 'departement' | 'commune';

export interface GeoFeatureProperties {
  code: string;
  nom: string;
  level: AdminLevel;
  [key: string]: unknown;
}

export interface CriterionValue {
  criterionId: string;
  value: number; // Raw value
  score: number; // Normalized 0-100
  rank?: number; // National rank
}

export interface LocationData {
  code: string;
  nom: string;
  level: AdminLevel;
  criteria: Record<string, CriterionValue>;
}

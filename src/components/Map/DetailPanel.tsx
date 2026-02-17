'use client';

import { useEffect } from 'react';
import { GeoFeatureProperties } from '@/types/geo';
import { CRITERIA, Criterion } from '@/types/criteria';
import { interpolateColor } from '@/lib/map/colors';
import { X } from 'lucide-react';

interface DetailPanelProps {
  feature: GeoFeatureProperties | null;
  onClose: () => void;
  criterionId?: string | null;
}

export function DetailPanel({ feature, onClose, criterionId }: DetailPanelProps) {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (feature) {
      window.addEventListener('keydown', handleEscape);
    }

    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [feature, onClose]);

  if (!feature) return null;

  const levelLabels = {
    region: 'Région',
    departement: 'Département',
    commune: 'Commune',
  };

  // Extract all data fields from feature
  const dataFields = Object.entries(feature)
    .filter(([key]) => !['code', 'nom', 'level'].includes(key))
    .filter(([, value]) => value !== undefined && value !== null);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-background border-l border-border shadow-2xl z-50 overflow-y-auto transform transition-transform duration-300 ease-in-out"
        style={{
          transform: 'translateX(0)',
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold truncate">{feature.nom}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {levelLabels[feature.level] || feature.level}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-2 rounded-lg hover:bg-accent transition-colors flex-shrink-0"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6">
          {/* Basic Information */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Informations générales
            </h3>
            <div className="space-y-2">
              <DetailRow label="Code" value={feature.code} mono />
              <DetailRow label="Niveau" value={levelLabels[feature.level] || feature.level} />
            </div>
          </section>

          {/* Population if available */}
          {feature.population !== undefined && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Démographie
              </h3>
              <div className="space-y-2">
                <DetailRow
                  label="Population"
                  value={typeof feature.population === 'number' ? new Intl.NumberFormat('fr-FR').format(feature.population) : 'N/A'}
                />
              </div>
            </section>
          )}

          {/* Additional Data Fields */}
          {dataFields.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Données supplémentaires
              </h3>
              <div className="space-y-2">
                {dataFields.map(([key, value]) => (
                  <DetailRow
                    key={key}
                    label={formatLabel(key)}
                    value={formatValue(value)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Selected Criterion Section */}
          {criterionId && CRITERIA[criterionId] && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {CRITERIA[criterionId].name}
              </h3>
              <CriterionDisplay
                criterion={CRITERIA[criterionId]}
                value={feature.criterionValue as number | undefined}
                score={feature.criterionScore as number | undefined}
                rank={feature.criterionRank as number | undefined}
              />
            </section>
          )}

          {/* All Criteria Overview - Placeholder for future */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Tous les critères
            </h3>
            <div className="text-sm text-muted-foreground italic">
              Les critères d'évaluation complets seront affichés ici une fois les données chargées.
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

interface DetailRowProps {
  label: string;
  value: string | number;
  mono?: boolean;
}

function DetailRow({ label, value, mono = false }: DetailRowProps) {
  return (
    <div className="flex justify-between items-baseline py-2 border-b border-border/50">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function formatLabel(key: string): string {
  // Convert camelCase or snake_case to readable label
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    return value.toLocaleString('fr-FR');
  }
  if (typeof value === 'boolean') {
    return value ? 'Oui' : 'Non';
  }
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

interface CriterionDisplayProps {
  criterion: Criterion;
  value?: number;
  score?: number;
  rank?: number;
}

function CriterionDisplay({ criterion, value, score, rank }: CriterionDisplayProps) {
  if (value === undefined && score === undefined) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Données non disponibles pour cette commune.
      </div>
    );
  }

  const barColor = score !== undefined ? interpolateColor(score, criterion) : '#e2e8f0';

  return (
    <div className="space-y-3">
      {/* Raw value */}
      <DetailRow
        label="Valeur"
        value={value !== undefined ? `${value.toLocaleString('fr-FR')} ${criterion.unit}` : 'N/A'}
      />

      {/* Score with color bar */}
      {score !== undefined && (
        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-muted-foreground">Score</span>
            <span className="text-sm font-semibold">{score}/100</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${score}%`,
                backgroundColor: barColor,
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{criterion.higherIsBetter ? 'Moins favorable' : 'Plus favorable'}</span>
            <span>{criterion.higherIsBetter ? 'Plus favorable' : 'Moins favorable'}</span>
          </div>
        </div>
      )}

      {/* National rank */}
      {rank !== undefined && (
        <DetailRow
          label="Classement national"
          value={`#${rank.toLocaleString('fr-FR')}`}
        />
      )}

      {/* Source */}
      <div className="pt-2 border-t border-border/50">
        <span className="text-xs text-muted-foreground">
          Source: {criterion.source} • Mis à jour: {criterion.lastUpdated}
        </span>
      </div>
    </div>
  );
}

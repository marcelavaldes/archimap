'use client';

import { useEffect, useState } from 'react';
import { GeoFeatureProperties } from '@/types/geo';
import type { Criterion } from '@/types/criteria';
import { interpolateColor } from '@/lib/map/colors';
import { CriteriaRadar, buildRadarScores } from '@/components/Charts';
import { X, Loader2 } from 'lucide-react';

interface CommuneData {
  code: string;
  nom: string;
  population: number | null;
  departement: { code: string; nom: string } | null;
  region: { code: string; nom: string } | null;
  criteria: Record<string, {
    value: number;
    score: number;
    rankNational?: number;
    rankDepartement?: number;
  }>;
}

interface DetailPanelProps {
  feature: GeoFeatureProperties | null;
  onClose: () => void;
  criterionId?: string | null;
  criteria?: Record<string, Criterion> | null;
}

export function DetailPanel({ feature, onClose, criterionId, criteria }: DetailPanelProps) {
  const [communeData, setCommuneData] = useState<CommuneData | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch full commune data when a commune is selected
  useEffect(() => {
    if (feature?.level === 'commune' && feature.code) {
      setLoading(true);
      fetch(`/api/commune/${feature.code}`)
        .then(res => res.json())
        .then(data => {
          if (!data.error) {
            setCommuneData(data);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setCommuneData(null);
    }
  }, [feature?.code, feature?.level]);

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

  // Build radar scores from fetched data
  const radarScores = communeData ? buildRadarScores(communeData.criteria, criteria ?? undefined) : [];

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
              {communeData?.departement && ` • ${communeData.departement.nom}`}
              {communeData?.region && ` • ${communeData.region.nom}`}
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
              <DetailRow label="Code INSEE" value={feature.code} mono />
              <DetailRow label="Niveau" value={levelLabels[feature.level] || feature.level} />
              {(communeData?.population ?? feature.population) !== undefined && (
                <DetailRow
                  label="Population"
                  value={new Intl.NumberFormat('fr-FR').format(
                    Number(communeData?.population ?? feature.population ?? 0)
                  )}
                />
              )}
            </div>
          </section>

          {/* Radar Chart - All Criteria Overview */}
          {feature.level === 'commune' && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Vue d'ensemble des critères
              </h3>
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : radarScores.length > 0 ? (
                <CriteriaRadar scores={radarScores} />
              ) : (
                <div className="text-sm text-muted-foreground italic text-center py-8">
                  Aucune donnée de critères disponible pour cette commune.
                </div>
              )}
            </section>
          )}

          {/* Selected Criterion Section */}
          {criterionId && criteria?.[criterionId] && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {criteria[criterionId].name}
              </h3>
              <CriterionDisplay
                criterion={criteria[criterionId]}
                value={communeData?.criteria[criterionId]?.value ?? feature.criterionValue as number | undefined}
                score={communeData?.criteria[criterionId]?.score ?? feature.criterionScore as number | undefined}
                rank={communeData?.criteria[criterionId]?.rankNational ?? feature.criterionRank as number | undefined}
              />
            </section>
          )}

          {/* All Criteria List */}
          {communeData && Object.keys(communeData.criteria).length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Détail des critères
              </h3>
              <div className="space-y-4">
                {Object.entries(communeData.criteria).map(([critId, data]) => {
                  const criterion = criteria?.[critId];
                  if (!criterion) return null;

                  const isSelected = critId === criterionId;

                  return (
                    <div
                      key={critId}
                      className={`p-3 rounded-lg border ${
                        isSelected ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <div className="flex justify-between items-baseline mb-2">
                        <span className="text-sm font-medium">{criterion.name}</span>
                        <span className="text-sm font-semibold">{data.score}/100</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${data.score}%`,
                            backgroundColor: interpolateColor(data.score, criterion),
                          }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {data.value.toLocaleString('fr-FR')} {criterion.unit}
                        {data.rankNational && ` • #${data.rankNational.toLocaleString('fr-FR')} national`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
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

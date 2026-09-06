'use client';

import { useState } from 'react';
import { CRITERION_CATEGORIES, type CriterionCategory, type Criterion } from '@/types/criteria';

interface WeightPanelProps {
  criteria: Record<string, Criterion> | null;
  weights: Record<string, number>;
  onWeightChange: (criterionId: string, weight: number) => void;
  onReset: () => void;
}

/** 0 = ignored, 5 = counts five times as much as a criterion set to 1. */
export const MAX_WEIGHT = 5;

const WEIGHT_LABELS = ['Ignoré', 'Un peu', 'Assez', 'Beaucoup', 'Fortement', 'Prioritaire'];

export function WeightPanel({ criteria, weights, onWeightChange, onReset }: WeightPanelProps) {
  const [collapsed, setCollapsed] = useState<Set<CriterionCategory>>(new Set());

  const toggleCategory = (category: CriterionCategory) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const byCategory = criteria
    ? Object.values(criteria).reduce((acc, c) => {
        (acc[c.category as CriterionCategory] ??= []).push(c);
        return acc;
      }, {} as Record<CriterionCategory, Criterion[]>)
    : ({} as Record<CriterionCategory, Criterion[]>);

  const totalWeight = Object.values(weights).reduce((s, w) => s + (w > 0 ? w : 0), 0);
  const activeCount = Object.values(weights).filter((w) => w > 0).length;

  if (!criteria) {
    return <div className="text-sm text-muted-foreground animate-pulse">Chargement...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground leading-snug">
          Réglez l&apos;importance de chaque critère. La carte se recolore selon votre
          pondération.
        </p>
      </div>

      <div className="flex items-center justify-between text-xs bg-secondary/50 rounded-md px-2 py-1.5">
        <span className="text-muted-foreground">
          {activeCount} critère{activeCount > 1 ? 's' : ''} actif{activeCount > 1 ? 's' : ''}
        </span>
        <button
          onClick={onReset}
          className="text-primary hover:underline disabled:opacity-40 disabled:no-underline"
          disabled={activeCount === 0}
        >
          Réinitialiser
        </button>
      </div>

      {activeCount === 0 && (
        <div className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1.5">
          Aucun critère pondéré — augmentez au moins un curseur pour colorer la carte.
        </div>
      )}

      <div className="space-y-2">
        {(Object.keys(CRITERION_CATEGORIES) as CriterionCategory[]).map((category) => {
          const list = byCategory[category];
          if (!list?.length) return null;
          const isCollapsed = collapsed.has(category);
          const categoryWeight = list.reduce((s, c) => s + (weights[c.id] > 0 ? weights[c.id] : 0), 0);

          return (
            <div key={category} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between px-3 py-2 bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span>{CRITERION_CATEGORIES[category].icon}</span>
                  <span className="text-sm font-medium truncate">
                    {CRITERION_CATEGORIES[category].name}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {categoryWeight > 0 && totalWeight > 0 && (
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {Math.round((categoryWeight / totalWeight) * 100)}%
                    </span>
                  )}
                  <svg
                    className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </button>

              {!isCollapsed && (
                <div className="p-2 space-y-3">
                  {list.map((criterion) => {
                    const weight = weights[criterion.id] ?? 0;
                    // Share of the final score this criterion carries — the
                    // number that actually answers "how much does this count?".
                    const share = totalWeight > 0 ? (weight / totalWeight) * 100 : 0;

                    return (
                      <div key={criterion.id}>
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <label
                            htmlFor={`weight-${criterion.id}`}
                            className={`text-sm truncate ${weight > 0 ? 'font-medium' : 'text-muted-foreground'}`}
                            title={criterion.description}
                          >
                            {criterion.name}
                          </label>
                          <span className="text-[10px] tabular-nums shrink-0 text-muted-foreground">
                            {weight > 0 ? `${Math.round(share)}%` : WEIGHT_LABELS[0]}
                          </span>
                        </div>
                        <input
                          id={`weight-${criterion.id}`}
                          type="range"
                          min={0}
                          max={MAX_WEIGHT}
                          step={1}
                          value={weight}
                          onChange={(e) => onWeightChange(criterion.id, Number(e.target.value))}
                          aria-label={`Poids de ${criterion.name}`}
                          aria-valuetext={WEIGHT_LABELS[weight] ?? String(weight)}
                          className="w-full h-1.5 accent-primary cursor-pointer"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

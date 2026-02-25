'use client';

import { useState } from 'react';
import { CRITERION_CATEGORIES, type CriterionCategory, type Criterion } from '@/types/criteria';
import { useDebug } from '@/lib/debug/DebugContext';

interface SidebarProps {
  criteria: Record<string, Criterion> | null;
  selectedCriterion: string | null;
  onCriterionSelect: (criterionId: string | null) => void;
  activeLayers: string[];
  onLayerToggle: (criterionId: string) => void;
}

export function Sidebar({
  criteria,
  selectedCriterion,
  onCriterionSelect,
  activeLayers,
  onLayerToggle,
}: SidebarProps) {
  const { log } = useDebug();
  const [expandedCategory, setExpandedCategory] = useState<CriterionCategory | null>('climate');

  const criteriaByCategory = criteria
    ? Object.values(criteria).reduce(
        (acc, criterion) => {
          if (!acc[criterion.category as CriterionCategory]) {
            acc[criterion.category as CriterionCategory] = [];
          }
          acc[criterion.category as CriterionCategory].push(criterion);
          return acc;
        },
        {} as Record<CriterionCategory, Criterion[]>
      )
    : ({} as Record<CriterionCategory, Criterion[]>);

  const selectedCrit = selectedCriterion && criteria?.[selectedCriterion]
    ? criteria[selectedCriterion]
    : null;

  return (
    <aside className="w-72 border-r border-border bg-background overflow-y-auto">
      <div className="p-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Critères
        </h2>

        {!criteria && (
          <div className="text-sm text-muted-foreground animate-pulse">Chargement...</div>
        )}

        <div className="space-y-2">
          {(Object.keys(CRITERION_CATEGORIES) as CriterionCategory[]).map((category) => (
            <div key={category} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
                className="w-full flex items-center justify-between px-3 py-2 bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span>{CRITERION_CATEGORIES[category].icon}</span>
                  <span className="text-sm font-medium">{CRITERION_CATEGORIES[category].name}</span>
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${expandedCategory === category ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expandedCategory === category && criteriaByCategory[category] && (
                <div className="p-2 space-y-1">
                  {criteriaByCategory[category].map((criterion) => {
                    const isSelected = selectedCriterion === criterion.id;
                    const isActive = activeLayers.includes(criterion.id);

                    return (
                      <div
                        key={criterion.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-secondary'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => onLayerToggle(criterion.id)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <button
                          onClick={() => {
                            const next = isSelected ? null : criterion.id;
                            log('STATE', 'info', next ? `Criterion selected: ${criterion.name}` : `Criterion deselected: ${criterion.name}`, { criterionId: criterion.id, action: next ? 'select' : 'deselect' });
                            onCriterionSelect(next);
                          }}
                          className="flex-1 text-left text-sm"
                        >
                          {criterion.name}
                        </button>
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            background: `linear-gradient(90deg, ${criterion.colorScale.low}, ${criterion.colorScale.mid}, ${criterion.colorScale.high})`,
                          }}
                          title={`Échelle: ${criterion.colorScale.low} → ${criterion.colorScale.high}`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {selectedCrit && (
        <div className="p-4 border-t border-border">
          <h3 className="text-sm font-semibold mb-2">{selectedCrit.name}</h3>
          <p className="text-xs text-muted-foreground mb-2">
            {selectedCrit.description}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Source: {selectedCrit.source}</span>
            <span>•</span>
            <span>Mis à jour: {selectedCrit.lastUpdated}</span>
          </div>
          <div className="mt-3 h-4 rounded-full overflow-hidden" style={{
            background: `linear-gradient(90deg, ${selectedCrit.colorScale.low}, ${selectedCrit.colorScale.mid}, ${selectedCrit.colorScale.high})`,
          }}>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{selectedCrit.higherIsBetter ? 'Faible' : 'Bon'}</span>
            <span>{selectedCrit.higherIsBetter ? 'Élevé' : 'Mauvais'}</span>
          </div>
        </div>
      )}
    </aside>
  );
}

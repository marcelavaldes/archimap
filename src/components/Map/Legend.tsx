'use client';

import { CRITERIA, Criterion } from '@/types/criteria';
import { generateColorStops } from '@/lib/map/colors';

interface LegendProps {
  criterionId: string | null;
}

export function Legend({ criterionId }: LegendProps) {
  if (!criterionId || !CRITERIA[criterionId]) {
    return null;
  }

  const criterion = CRITERIA[criterionId];
  const colorStops = generateColorStops(criterion, 10);

  // Create CSS gradient from color stops
  const gradientColors = colorStops.map(([, color]) => color).join(', ');
  const gradient = `linear-gradient(to right, ${gradientColors})`;

  return (
    <div className="absolute bottom-8 left-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-md z-10 min-w-[200px]">
      {/* Criterion name */}
      <div className="text-sm font-medium mb-2">{criterion.name}</div>

      {/* Color gradient bar */}
      <div
        className="h-3 rounded-full mb-1"
        style={{ background: gradient }}
      />

      {/* Labels */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{criterion.higherIsBetter ? 'Bas' : 'Haut'}</span>
        <span>{criterion.higherIsBetter ? 'Haut' : 'Bas'}</span>
      </div>

      {/* No data indicator */}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
        <div className="w-4 h-3 rounded-sm bg-[#e2e8f0]" />
        <span className="text-xs text-muted-foreground">Données non disponibles</span>
      </div>

      {/* Unit */}
      <div className="text-xs text-muted-foreground mt-1">
        Unité: {criterion.unit}
      </div>
    </div>
  );
}

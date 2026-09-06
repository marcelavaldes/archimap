'use client';

import { useLayoutEffect, useRef } from 'react';
import { GeoFeatureProperties } from '@/types/geo';
import type { Criterion } from '@/types/criteria';

const TOOLTIP_OFFSET = 15;

interface TooltipProps {
  feature: GeoFeatureProperties | null;
  x: number;
  y: number;
  criterionId?: string | null;
  criteria?: Record<string, Criterion> | null;
}

export function Tooltip({ feature, x, y, criterionId, criteria }: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Viewport-clamped position depends on the tooltip's own rendered size, which
  // is only known after paint. Writing it straight to the DOM node (an external
  // system) instead of React state avoids a synchronous setState + extra render
  // pass just to reposition an element that renders identically either way.
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip || !feature) return;

    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x + TOOLTIP_OFFSET;
    let adjustedY = y + TOOLTIP_OFFSET;

    // Prevent tooltip from going off-screen right
    if (adjustedX + rect.width > viewportWidth) {
      adjustedX = x - rect.width - TOOLTIP_OFFSET;
    }

    // Prevent tooltip from going off-screen bottom
    if (adjustedY + rect.height > viewportHeight) {
      adjustedY = y - rect.height - TOOLTIP_OFFSET;
    }

    // Prevent tooltip from going off-screen left
    if (adjustedX < 0) {
      adjustedX = TOOLTIP_OFFSET;
    }

    // Prevent tooltip from going off-screen top
    if (adjustedY < 0) {
      adjustedY = TOOLTIP_OFFSET;
    }

    tooltip.style.left = `${adjustedX}px`;
    tooltip.style.top = `${adjustedY}px`;
  }, [x, y, feature]);

  if (!feature) return null;

  const levelLabels = {
    region: 'Région',
    departement: 'Département',
    commune: 'Commune',
  };

  // Get criterion info if available
  const criterion: Criterion | undefined = criterionId ? criteria?.[criterionId] : undefined;
  const criterionValue = feature.criterionValue as number | undefined;
  const criterionScore = feature.criterionScore as number | undefined;

  // Format criterion value with unit
  const formatCriterionValue = (value: number | undefined, crit: Criterion | undefined): string => {
    if (value === undefined || value === null) return 'N/A';
    return `${value.toLocaleString('fr-FR')} ${crit?.unit || ''}`;
  };

  return (
    <div
      ref={tooltipRef}
      className="pointer-events-none fixed z-50 rounded-lg border border-border bg-background px-3 py-2 shadow-lg"
      style={{
        left: `${x + TOOLTIP_OFFSET}px`,
        top: `${y + TOOLTIP_OFFSET}px`,
      }}
    >
      <div className="space-y-1">
        <div className="font-semibold text-sm">{feature.nom}</div>
        <div className="text-xs text-muted-foreground">
          {levelLabels[feature.level] || feature.level}
        </div>
        {/* Criterion value if selected */}
        {criterion && criterionValue !== undefined && (
          <div className="text-xs font-medium text-primary">
            {criterion.name}: {formatCriterionValue(criterionValue, criterion)}
          </div>
        )}
        {/* Score if available */}
        {criterion && criterionScore !== undefined && (
          <div className="text-xs text-muted-foreground">
            Score: {criterionScore}/100
          </div>
        )}
        {/* Population fallback when no criterion */}
        {!criterion && feature.population !== undefined && feature.population !== null && (
          <div className="text-xs text-muted-foreground">
            Population: {(feature.population as number).toLocaleString('fr-FR')}
          </div>
        )}
        {feature.code && (
          <div className="text-xs text-muted-foreground font-mono">
            {feature.code}
          </div>
        )}
      </div>
    </div>
  );
}

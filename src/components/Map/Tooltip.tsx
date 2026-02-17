'use client';

import { useEffect, useRef, useState } from 'react';
import { GeoFeatureProperties } from '@/types/geo';
import { CRITERIA, Criterion } from '@/types/criteria';

interface TooltipProps {
  feature: GeoFeatureProperties | null;
  x: number;
  y: number;
  criterionId?: string | null;
}

export function Tooltip({ feature, x, y, criterionId }: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    if (!tooltipRef.current || !feature) return;

    const tooltip = tooltipRef.current;
    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const offset = 15;
    let adjustedX = x + offset;
    let adjustedY = y + offset;

    // Prevent tooltip from going off-screen right
    if (adjustedX + rect.width > viewportWidth) {
      adjustedX = x - rect.width - offset;
    }

    // Prevent tooltip from going off-screen bottom
    if (adjustedY + rect.height > viewportHeight) {
      adjustedY = y - rect.height - offset;
    }

    // Prevent tooltip from going off-screen left
    if (adjustedX < 0) {
      adjustedX = offset;
    }

    // Prevent tooltip from going off-screen top
    if (adjustedY < 0) {
      adjustedY = offset;
    }

    setPosition({ x: adjustedX, y: adjustedY });
  }, [x, y, feature]);

  if (!feature) return null;

  const levelLabels = {
    region: 'Région',
    departement: 'Département',
    commune: 'Commune',
  };

  // Get criterion info if available
  const criterion: Criterion | undefined = criterionId ? CRITERIA[criterionId] : undefined;
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
        left: `${position.x}px`,
        top: `${position.y}px`,
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

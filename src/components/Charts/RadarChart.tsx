'use client';

import {
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { CRITERIA } from '@/types/criteria';

interface CriterionScore {
  criterionId: string;
  label: string;
  score: number;
  value?: number;
  fullMark: number;
}

interface CriteriaRadarProps {
  scores: CriterionScore[];
  className?: string;
}

export function CriteriaRadar({ scores, className = '' }: CriteriaRadarProps) {
  if (scores.length === 0) {
    return (
      <div className={`flex items-center justify-center h-64 text-muted-foreground ${className}`}>
        Aucune donnée disponible
      </div>
    );
  }

  return (
    <div className={`w-full h-64 ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsRadarChart cx="50%" cy="50%" outerRadius="80%" data={scores}>
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            tickLine={false}
          />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 100]}
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            tickCount={5}
          />
          <Radar
            name="Score"
            dataKey="score"
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.4}
            strokeWidth={2}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const data = payload[0].payload as CriterionScore;
              const criterion = CRITERIA[data.criterionId];

              return (
                <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-sm">
                  <div className="font-medium">{data.label}</div>
                  <div className="text-muted-foreground mt-1">
                    Score: <span className="text-foreground font-medium">{data.score}/100</span>
                  </div>
                  {data.value !== undefined && criterion && (
                    <div className="text-muted-foreground">
                      Valeur: <span className="text-foreground">{data.value.toLocaleString('fr-FR')} {criterion.unit}</span>
                    </div>
                  )}
                </div>
              );
            }}
          />
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Helper to build scores from criterion_values API response
export function buildRadarScores(
  criterionValues: Record<string, { value: number; score: number }> | null
): CriterionScore[] {
  if (!criterionValues) return [];

  return Object.entries(criterionValues)
    .filter(([criterionId]) => CRITERIA[criterionId])
    .map(([criterionId, data]) => ({
      criterionId,
      label: CRITERIA[criterionId].name,
      score: data.score,
      value: data.value,
      fullMark: 100,
    }));
}

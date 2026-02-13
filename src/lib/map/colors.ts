import { Criterion } from '@/types/criteria';

/**
 * Interpolate between colors based on a normalized value (0-100)
 */
export function interpolateColor(value: number, criterion: Criterion): string {
  const { colorScale, higherIsBetter } = criterion;

  // Normalize value to 0-1 range
  const normalized = Math.max(0, Math.min(100, value)) / 100;

  // If lower is better, invert the scale
  const adjustedValue = higherIsBetter ? normalized : 1 - normalized;

  if (adjustedValue <= 0.5) {
    // Interpolate between low and mid
    const t = adjustedValue * 2;
    return interpolateTwoColors(colorScale.low, colorScale.mid, t);
  } else {
    // Interpolate between mid and high
    const t = (adjustedValue - 0.5) * 2;
    return interpolateTwoColors(colorScale.mid, colorScale.high, t);
  }
}

/**
 * Linear interpolation between two hex colors
 */
function interpolateTwoColors(color1: string, color2: string, t: number): string {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * t);
  const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * t);
  const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * t);

  return rgbToHex(r, g, b);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 128, g: 128, b: 128 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Generate a color scale array for MapLibre GL expressions
 */
export function generateColorStops(criterion: Criterion, steps: number = 10): [number, string][] {
  const stops: [number, string][] = [];
  for (let i = 0; i <= steps; i++) {
    const score = (i / steps) * 100;
    stops.push([score, interpolateColor(score, criterion)]);
  }
  return stops;
}

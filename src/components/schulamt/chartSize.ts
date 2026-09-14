export type ChartSize = { width: number; height: number };

/**
 * Recharts only receives dimensions it can render. Rounding mirrors the
 * container dimensions it previously derived internally.
 */
export function getChartSize(width: number, height: number): ChartSize | null {
  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);

  if (!Number.isFinite(roundedWidth) || !Number.isFinite(roundedHeight) || roundedWidth <= 0 || roundedHeight <= 0) {
    return null;
  }

  return { width: roundedWidth, height: roundedHeight };
}

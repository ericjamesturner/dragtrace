// 2D-histogram / ECU-tuning-table binning. Ported from halog src/utils/heatmap.ts.
// Pure logic — no React, no dragtrace deps. The xConvert/yConvert/valueConvert
// callbacks let the caller apply unit conversion before binning.

export interface CellStats {
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface HeatmapResult {
  grid: (number | null)[][];   // [yBin][xBin], null = no data
  counts: number[][];          // sample count per cell
  cellStats: (CellStats | null)[][];
  xEdges: number[];            // xBins+1 edge values
  yEdges: number[];            // yBins+1 edge values
  globalMin: number;
  globalMax: number;
  totalSamples: number;
}

export type HeatmapAggregationKind = "average" | "min" | "max" | "count";

export function computeHeatmap(
  xData: Float64Array,
  yData: Float64Array,
  valueData: Float64Array,
  timestamps: Float64Array,
  options: {
    xBins: number;
    yBins: number;
    xRange: [number, number];
    yRange: [number, number];
    timeRange?: [number, number] | null;
    aggregation: HeatmapAggregationKind;
    xConvert: (v: number) => number;
    yConvert: (v: number) => number;
    valueConvert: (v: number) => number;
  },
): HeatmapResult {
  const { xBins, yBins, xRange, yRange, timeRange, aggregation, xConvert, yConvert, valueConvert } = options;
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  // Init accumulators
  const sums: number[][] = Array.from({ length: yBins }, () => new Array(xBins).fill(0));
  const counts: number[][] = Array.from({ length: yBins }, () => new Array(xBins).fill(0));
  const mins: number[][] = Array.from({ length: yBins }, () => new Array(xBins).fill(Infinity));
  const maxs: number[][] = Array.from({ length: yBins }, () => new Array(xBins).fill(-Infinity));

  // Find index range from time filter
  let iStart = 0;
  let iEnd = timestamps.length;
  if (timeRange) {
    const [tMin, tMax] = timeRange;
    for (let i = 0; i < timestamps.length; i++) { if (timestamps[i] >= tMin) { iStart = i; break; } }
    for (let i = timestamps.length - 1; i >= 0; i--) { if (timestamps[i] <= tMax) { iEnd = i + 1; break; } }
  }

  // Bin data
  for (let i = iStart; i < iEnd; i++) {
    const rx = xData[i], ry = yData[i], rv = valueData[i];
    if (rx !== rx || ry !== ry || rv !== rv) continue; // skip NaN

    const x = xConvert(rx);
    const y = yConvert(ry);
    const v = valueConvert(rv);

    const xi = Math.min(xBins - 1, Math.max(0, Math.floor(((x - xMin) / xSpan) * xBins)));
    const yi = Math.min(yBins - 1, Math.max(0, Math.floor(((y - yMin) / ySpan) * yBins)));

    sums[yi][xi] += v;
    counts[yi][xi]++;
    if (v < mins[yi][xi]) mins[yi][xi] = v;
    if (v > maxs[yi][xi]) maxs[yi][xi] = v;
  }

  // Build result grid + per-cell stats
  let globalMin = Infinity, globalMax = -Infinity;
  let totalSamples = 0;
  const grid: (number | null)[][] = Array.from({ length: yBins }, () => new Array(xBins).fill(null));
  const cellStats: (CellStats | null)[][] = Array.from({ length: yBins }, () => new Array(xBins).fill(null));

  for (let yi = 0; yi < yBins; yi++) {
    for (let xi = 0; xi < xBins; xi++) {
      const c = counts[yi][xi];
      if (c === 0) continue;
      totalSamples += c;
      const avg = sums[yi][xi] / c;
      cellStats[yi][xi] = { avg, min: mins[yi][xi], max: maxs[yi][xi], count: c };

      let val: number;
      switch (aggregation) {
        case 'average': val = avg; break;
        case 'min': val = mins[yi][xi]; break;
        case 'max': val = maxs[yi][xi]; break;
        case 'count': val = c; break;
      }
      grid[yi][xi] = val;
      if (val < globalMin) globalMin = val;
      if (val > globalMax) globalMax = val;
    }
  }

  if (!isFinite(globalMin)) { globalMin = 0; globalMax = 1; }

  // Edge values
  const xEdges = Array.from({ length: xBins + 1 }, (_, i) => xMin + (i / xBins) * xSpan);
  const yEdges = Array.from({ length: yBins + 1 }, (_, i) => yMin + (i / yBins) * ySpan);

  return { grid, counts, cellStats, xEdges, yEdges, globalMin, globalMax, totalSamples };
}

/** Scan a Float64Array (with conversion) to find min/max, ignoring NaN. Pads by 2%. */
export function autoRange(
  data: Float64Array,
  convert: (v: number) => number,
  timeRange?: [number, number] | null,
  timestamps?: Float64Array,
): [number, number] {
  let min = Infinity, max = -Infinity;
  let iStart = 0, iEnd = data.length;
  if (timeRange && timestamps) {
    for (let i = 0; i < timestamps.length; i++) { if (timestamps[i] >= timeRange[0]) { iStart = i; break; } }
    for (let i = timestamps.length - 1; i >= 0; i--) { if (timestamps[i] <= timeRange[1]) { iEnd = i + 1; break; } }
  }
  for (let i = iStart; i < iEnd; i++) {
    const raw = data[i];
    if (raw !== raw) continue;
    const v = convert(raw);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min)) return [0, 1];
  const pad = (max - min) * 0.02 || 0.5;
  return [min - pad, max + pad];
}

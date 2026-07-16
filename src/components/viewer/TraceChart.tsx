import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import { buildSelectionCsv } from "@/lib/csv-export";
import "uplot/dist/uPlot.min.css";
import { resolveChannelStyle } from "@/lib/viewer-types";
import type { ChannelOnTrace, LoadedLog } from "@/lib/viewer-types";
import type { EvaluatedZone } from "@/hooks/useEvaluatedZones";
import { convertForDisplay, getDisplayUnit, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { readableTextColor } from "@/lib/colors";
import { formatSlipTime } from "@/lib/timeslip-zones";
import { formatValue, formatDuration } from "@/lib/cursor-utils";

const GRID_POINTS = 2000;
const Y_AXIS_SIZE = 45;
// Height (CSS px) of one timeslip zone's row in the bottom band. One row per
// timeslip so two logs' slips stack instead of overprinting each other.
const TIMESLIP_ROW_H = 16;

// Channels in the same scale group share a common Y axis (union range, single
// axis) so they're directly comparable — e.g. all EGTs on one scale, engine +
// driveshaft RPM on one scale. Returns the group id, or null for ungrouped.
// Note: RPM matching is exact on purpose — there are many other channels
// containing "RPM" (Idle Target RPM, Limiter RPM, TM Engine RPM…) that must NOT
// be grouped with engine/driveshaft RPM.
const SCALE_GROUP_LABELS: Record<string, string> = { egt: "EGT", rpm: "RPM", lambda: "Lambda" };

// Near-flat channels in these unit families (pressures, temperatures,
// voltage) get a minimum auto-scale span — a fraction of the channel's
// factory DisplayMaxMin range — so a 4 psi fuel-pressure wiggle doesn't
// stretch to full chart height. Other families (RPM, TPS…) stay data-fit.
const SPAN_FLOOR_UNITS = new Set(["kPa", "K", "V"]);
const SPAN_FLOOR_FRAC = 0.12;

function scaleGroupKey(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("exhaust gas temp") || /^egt\b/.test(n)) return "egt";
  if (name === "RPM" || name === "Driveshaft RPM") return "rpm";
  return null;
}

/**
 * Clamp a candidate wheel-zoom [min,max] to the full data range.
 * Returns null when the candidate covers (or exceeds) the full extent —
 * meaning "reset to full range". Shifts (rather than squashes) when one side
 * overshoots, preserving the requested span. Ported from halog clampRange.
 */
function clampWheelRange(
  min: number,
  max: number,
  full: [number, number],
): [number, number] | null {
  const [fullMin, fullMax] = full;
  const span = max - min;
  if (span < 0.01) return null; // too tight — caller keeps current
  if (min <= fullMin && max >= fullMax) return null; // covers all -> reset
  if (min < fullMin) { min = fullMin; max = fullMin + span; }
  if (max > fullMax) { max = fullMax; min = fullMax - span; }
  min = Math.max(fullMin, min);
  max = Math.min(fullMax, max);
  if (min <= fullMin && max >= fullMax) return null;
  return [min, max];
}

/** Convert a hex color + opacity (0-1) to an rgba() string. */
function hexToRgba(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// ── Color-by-channel gradient: blue → cyan → green → yellow → red ──
const COLOR_STOPS: [number, number, number][] = [
  [0, 0, 180], [0, 100, 255], [0, 200, 200], [0, 200, 80],
  [180, 220, 0], [255, 200, 0], [255, 120, 0], [255, 0, 0],
];

/** Map a normalized value t∈[0,1] to an interpolated gradient RGB triple. */
function hexToRgbTuple(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function valueToColor(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  const idx = c * (COLOR_STOPS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, COLOR_STOPS.length - 1);
  const f = idx - lo;
  return [
    Math.round(COLOR_STOPS[lo][0] + (COLOR_STOPS[hi][0] - COLOR_STOPS[lo][0]) * f),
    Math.round(COLOR_STOPS[lo][1] + (COLOR_STOPS[hi][1] - COLOR_STOPS[lo][1]) * f),
    Math.round(COLOR_STOPS[lo][2] + (COLOR_STOPS[hi][2] - COLOR_STOPS[lo][2]) * f),
  ];
}

/** Format a legend value compactly: ≥100→0dp, ≥10→1dp, else 2dp. */
function fmtLegendVal(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

interface LogGroup {
  log: LoadedLog;
  channels: ChannelOnTrace[];
  timeOffset: number;
}

interface Props {
  logGroups: LogGroup[];
  width: number;
  height: number;
  syncKey: string;
  zoomRange: [number, number] | null;
  globalRange: [number, number];
  sharedYRanges: Map<string, [number, number]>;
  /** Cross-chart union range per scale group (e.g. "lambda"), so grouped
   *  channels use the same scale on every chart of the page. */
  groupYRanges?: Map<string, [number, number]>;
  /** Reports the resolved y-range per channel after auto-scaling, so UI
   *  (axis editors) can show what "Auto" actually is right now. */
  onResolvedScaleRanges?: (byChannel: Map<string, [number, number]>) => void;
  showAxes: boolean;
  showAxisLabels: boolean;
  raceStartTimes: { time: number; offset: number }[];
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  selection: [number, number] | null;
  onSelection?: (min: number, max: number) => void;
  onClearSelection?: () => void;
  onDragPreview?: (sel: [number, number] | null) => void;
  onCursorTime?: (time: number | null) => void;
  onZoom?: (min: number, max: number) => void;
  onResetZoom?: () => void;
  wheelZoomEnabled?: boolean;
  wheelZoomFactor?: number;
  evaluatedZones?: EvaluatedZone[];
  /** Timeslip zones render as their own solid band across the bottom of the
   *  plot (mirroring the OverviewBar strip) — not through the zone plugin. */
  timeslipZones?: EvaluatedZone[];
  expandedZoneIds?: Set<string>;
  onToggleZoneExpand?: (zoneId: string) => void;
  // Persist a dragged zone-label vertical position (0..1 fraction of chart height).
  onMoveZoneLabel?: (zoneId: string, fraction: number) => void;
  // Right-click a line: opens that channel's context menu (nearest series hit-test).
  onChannelContextMenu?: (logFileId: string, channelName: string, clientX: number, clientY: number) => void;
  // Race-start marker line style + right-click handler.
  raceLine?: { color?: string; width?: number; dash?: number[] };
  onRaceLineContextMenu?: (clientX: number, clientY: number) => void;
  // Only the top trace shows the "copy selection CSV" button.
  isTopTrace?: boolean;
  // Live color preview (e.g. hovering a swatch): transiently strokes the matching
  // series without committing. key = "logFileId:channelName".
  previewColorKey?: string | null;
  previewColor?: string | null;
  highlightKey?: string | null;
  maxYAxes?: number;
}

/** Resample a channel's data to a uniform time grid using linear interpolation. */
function resampleToGrid(
  srcTs: Float64Array,
  srcVals: Float64Array,
  offset: number,
  gridTs: number[],
): (number | null)[] {
  const result: (number | null)[] = new Array(gridTs.length).fill(null);
  if (srcTs.length === 0) return result;

  const srcStart = srcTs[0] + offset;
  const srcEnd = srcTs[srcTs.length - 1] + offset;
  let j = 0;

  for (let i = 0; i < gridTs.length; i++) {
    const t = gridTs[i];

    // Outside this log's time range
    if (t < srcStart || t > srcEnd) continue;

    const tLocal = t - offset;

    // Advance j so srcTs[j] <= tLocal
    while (j < srcTs.length - 1 && srcTs[j + 1] <= tLocal) j++;

    if (j >= srcTs.length - 1) {
      // At or past last sample
      const v = srcVals[srcTs.length - 1];
      result[i] = v !== v ? null : v;
      continue;
    }

    const t0 = srcTs[j], t1 = srcTs[j + 1];
    const v0 = srcVals[j], v1 = srcVals[j + 1];

    if (v0 !== v0 || v1 !== v1) {
      // One endpoint is NaN — use the valid one or null
      if (v0 === v0) result[i] = v0;
      else if (v1 === v1) result[i] = v1;
      continue;
    }

    // Linear interpolation
    const frac = t1 !== t0 ? (tLocal - t0) / (t1 - t0) : 0;
    result[i] = v0 + frac * (v1 - v0);
  }

  return result;
}

export function TraceChart({
  logGroups,
  width,
  height,
  syncKey,
  zoomRange,
  globalRange,
  sharedYRanges,
  groupYRanges,
  onResolvedScaleRanges,
  showAxes,
  showAxisLabels,
  raceStartTimes,
  unitSystem,
  unitOverrides,
  selection,
  onSelection,
  onClearSelection,
  onDragPreview,
  onCursorTime,
  onZoom,
  onResetZoom,
  wheelZoomEnabled,
  wheelZoomFactor,
  evaluatedZones,
  timeslipZones,
  expandedZoneIds,
  onToggleZoneExpand,
  onMoveZoneLabel,
  onChannelContextMenu,
  raceLine,
  onRaceLineContextMenu,
  isTopTrace,
  previewColorKey,
  previewColor,
  highlightKey,
  maxYAxes,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Position of the "copy CSV" button at the top-right of a range selection.
  const [copyBtn, setCopyBtn] = useState<{ left: number; top: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const chartRef = useRef<uPlot | null>(null);
  // Maps series index (1-based) to channel key, original color hex and width for highlight
  const seriesKeysRef = useRef<string[]>([]);
  const seriesColorsRef = useRef<string[]>([]);
  const seriesWidthsRef = useRef<number[]>([]);
  // True for series indices rendered as a color-by gradient (no solid stroke),
  // so the hover/dim highlight effect leaves their transparent stroke alone.
  const seriesColorByRef = useRef<boolean[]>([]);
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onClearSelectionRef = useRef(onClearSelection);
  onClearSelectionRef.current = onClearSelection;
  const onDragPreviewRef = useRef(onDragPreview);
  onDragPreviewRef.current = onDragPreview;
  const onCursorRef = useRef(onCursorTime);
  onCursorRef.current = onCursorTime;
  const onResolvedScaleRangesRef = useRef(onResolvedScaleRanges);
  onResolvedScaleRangesRef.current = onResolvedScaleRanges;
  const onChannelContextMenuRef = useRef(onChannelContextMenu);
  onChannelContextMenuRef.current = onChannelContextMenu;
  const onRaceLineContextMenuRef = useRef(onRaceLineContextMenu);
  onRaceLineContextMenuRef.current = onRaceLineContextMenu;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // Wheel-zoom refs — kept fresh every render so the native wheel handler never
  // goes stale during the chart rebuild that follows each zoom commit.
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  const onResetZoomRef = useRef(onResetZoom);
  onResetZoomRef.current = onResetZoom;
  const wheelEnabledRef = useRef(wheelZoomEnabled);
  wheelEnabledRef.current = wheelZoomEnabled;
  const wheelFactorRef = useRef(wheelZoomFactor);
  wheelFactorRef.current = wheelZoomFactor;
  const globalRangeRef = useRef(globalRange);
  globalRangeRef.current = globalRange;
  // Read AND optimistically written by the wheel handler so rapid wheel events
  // accumulate before the parent state round-trips and rebuilds the chart.
  const currentRangeRef = useRef<[number, number]>(zoomRange ?? globalRange);
  currentRangeRef.current = zoomRange ?? globalRange;
  const evaluatedZonesRef = useRef(evaluatedZones);
  evaluatedZonesRef.current = evaluatedZones;
  const timeslipZonesRef = useRef(timeslipZones);
  timeslipZonesRef.current = timeslipZones;
  const expandedZoneIdsRef = useRef(expandedZoneIds);
  expandedZoneIdsRef.current = expandedZoneIds;
  const onToggleZoneExpandRef = useRef(onToggleZoneExpand);
  onToggleZoneExpandRef.current = onToggleZoneExpand;
  const onMoveZoneLabelRef = useRef(onMoveZoneLabel);
  onMoveZoneLabelRef.current = onMoveZoneLabel;
  // Live-drag override of each zone's label-row Y, keyed by zone id (chart-height
  // fraction). Seeded from config every render — but NOT while a drag is active,
  // so the dragged value survives interleaved re-renders until mouseup persists it.
  const liveLabelFracRef = useRef<Record<string, number>>({});
  const isZoneDraggingRef = useRef(false);
  if (!isZoneDraggingRef.current) {
    const seeded: Record<string, number> = {};
    for (const z of evaluatedZones ?? []) {
      if (z.config.labelYFraction != null) seeded[z.config.id] = z.config.labelYFraction;
    }
    liveLabelFracRef.current = seeded;
  }
  // Drawn label-row hit boxes (device px, over-element origin), filled each draw.
  const zoneRowsRef = useRef<
    {
      id: string;
      frac: number;
      cbLeft: number; cbRight: number; cbTop: number; cbBottom: number;
      pillLeft: number; pillRight: number; pillTop: number; pillBottom: number;
    }[]
  >([]);

  // Build a stable key for dependencies
  const groupsKey = logGroups
    .map((g) =>
      `${g.log.fileId}:${g.timeOffset}:${g.channels.map((c) => `${c.channelName}:${c.color ?? ""}:${c.opacity ?? ""}:${c.width ?? ""}:${(c.dash ?? []).join(".")}:${c.axisMin ?? ""}:${c.axisMax ?? ""}:${c.colorBy ?? ""}:${c.colorByMin ?? ""}:${c.colorByMax ?? ""}:${c.colorByLowColor ?? ""}:${c.colorByHighColor ?? ""}`).join(",")}`
    )
    .join("|");

  // Serialize sharedYRanges to a stable string so the effect doesn't re-run on every render
  const rangesKey = Array.from(sharedYRanges.entries())
    .map(([k, [min, max]]) => `${k}:${min}:${max}`)
    .join("|");
  const groupRangesKey = groupYRanges
    ? Array.from(groupYRanges.entries())
        .map(([k, [min, max]]) => `${k}:${min}:${max}`)
        .join("|")
    : "";

  // Race-line style serialized so the chart rebuilds when it changes.
  const raceLineKey = `${raceLine?.color ?? ""}:${raceLine?.width ?? ""}:${(raceLine?.dash ?? []).join(",")}`;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || logGroups.length === 0 || width < 50) return;

    // Determine x-range
    const xRange: [number, number] = zoomRange ?? globalRange;
    const [xMin, xMax] = xRange;
    if (xMax <= xMin) return;

    // Build uniform time grid
    const step = (xMax - xMin) / (GRID_POINTS - 1);
    const gridTs: number[] = Array.from({ length: GRID_POINTS }, (_, i) => xMin + i * step);

    // Collect all series: resample each channel to the grid
    interface SeriesMeta {
      key: string;
      channelName: string;
      color: string;
      opacity: number;
      width: number;
      dash?: number[];
      axisMin?: number;
      axisMax?: number;
      // Color-by-channel: paint this line as a gradient of a 3rd channel's value.
      colorBy?: string;
      colorByVals?: (number | null)[] | null;
      colorByMetricUnit?: string;
      colorByLowColor?: string;
      colorByHighColor?: string;
      colorByMin?: number;
      colorByMax?: number;
    }
    const seriesData: (number | null)[][] = [];
    const seriesMeta: SeriesMeta[] = [];

    for (const group of logGroups) {
      const session = group.log.parsed.sessions[group.log.activeSessionIndex];
      if (!session) continue;

      for (let chIdx = 0; chIdx < group.channels.length; chIdx++) {
        const ch = group.channels[chIdx];
        const data = session.channels.get(ch.channelName);
        if (!data) continue;

        const resampled = resampleToGrid(session.timestamps, data, group.timeOffset, gridTs);
        seriesData.push(resampled);

        const resolved = resolveChannelStyle(ch, chIdx, group.log.logIndex);

        // Color-by: resample the 3rd channel onto the same grid + capture its unit.
        let colorByVals: (number | null)[] | null = null;
        let colorByMetricUnit: string | undefined;
        if (ch.colorBy) {
          const cbData = session.channels.get(ch.colorBy);
          if (cbData) {
            colorByVals = resampleToGrid(session.timestamps, cbData, group.timeOffset, gridTs);
            colorByMetricUnit = group.log.parsed.channelDefs.find((d) => d.name === ch.colorBy)?.metricUnit;
          }
        }

        seriesMeta.push({
          key: `${ch.logFileId}:${ch.channelName}`,
          channelName: ch.channelName,
          color: resolved.color,
          opacity: resolved.opacity,
          width: resolved.width,
          dash: resolved.dash,
          axisMin: ch.axisMin,
          axisMax: ch.axisMax,
          colorBy: ch.colorBy,
          colorByVals,
          colorByMetricUnit,
          colorByLowColor: ch.colorByLowColor,
          colorByHighColor: ch.colorByHighColor,
          colorByMin: ch.colorByMin,
          colorByMax: ch.colorByMax,
        });
      }
    }

    if (seriesMeta.length === 0) return;

    const plotData = [gridTs, ...seriesData] as uPlot.AlignedData;

    // Build uPlot config
    const series: uPlot.Series[] = [{}]; // x-series
    const scales: uPlot.Scales = {
      x: { time: false, range: () => xRange },
    };

    // Build metricUnit + factory display range lookups from logGroups
    const metricUnitByChannel = new Map<string, string>();
    const displayRangeByChannel = new Map<string, [number, number]>();
    for (const group of logGroups) {
      for (const ch of group.channels) {
        if (!metricUnitByChannel.has(ch.channelName)) {
          const def = group.log.parsed.channelDefs.find(d => d.name === ch.channelName);
          if (def?.metricUnit) metricUnitByChannel.set(ch.channelName, def.metricUnit);
          if (
            def &&
            Number.isFinite(def.displayMin) &&
            Number.isFinite(def.displayMax) &&
            def.displayMax > def.displayMin
          ) {
            displayRangeByChannel.set(ch.channelName, [def.displayMin, def.displayMax]);
          }
        }
      }
    }

    // Share y-scales: channels in the same scale group (EGTs, engine+driveshaft
    // RPM, all lambda/AFR channels) share one axis, as do same-named channels
    // overlaid across logs. Everything else gets its own scale.
    const groupIdOf = (channelName: string): string | null => {
      const g = scaleGroupKey(channelName);
      if (g) return g;
      if (metricUnitByChannel.get(channelName) === "lambda") return "lambda";
      return null;
    };

    const scaleIdOf = (channelName: string) => {
      const g = groupIdOf(channelName);
      return g ? `g_${g}` : channelName;
    };

    const scaleKeyById = new Map<string, string>(); // scaleId -> "y0"/"y1"…
    const channelsInScale = new Map<string, string[]>(); // scaleId -> distinct channel names
    const scaleGroupByKey = new Map<string, string | null>(); // scaleKey -> group id (for label)
    const scaleColor = new Map<string, string>();
    // Track manual axis ranges per scale
    const scaleManualMin = new Map<string, number>();
    const scaleManualMax = new Map<string, number>();
    const scaleMetricUnit = new Map<string, string>();
    let scaleIdx = 0;

    // First pass: assign each channel to a scale (grouped or per-channel)
    for (const meta of seriesMeta) {
      const scaleId = scaleIdOf(meta.channelName);
      if (!scaleKeyById.has(scaleId)) {
        const scaleKey = `y${scaleIdx++}`;
        scaleKeyById.set(scaleId, scaleKey);
        scaleColor.set(scaleKey, meta.color);
        scaleGroupByKey.set(scaleKey, groupIdOf(meta.channelName));
        const mu = metricUnitByChannel.get(meta.channelName);
        if (mu) scaleMetricUnit.set(scaleKey, mu);
      }
      const scaleKey = scaleKeyById.get(scaleId)!;
      const members = channelsInScale.get(scaleId) ?? [];
      if (!members.includes(meta.channelName)) members.push(meta.channelName);
      channelsInScale.set(scaleId, members);
      // Use manual axis ranges if set (per scale)
      if (meta.axisMin !== undefined) scaleManualMin.set(scaleKey, meta.axisMin);
      if (meta.axisMax !== undefined) scaleManualMax.set(scaleKey, meta.axisMax);
    }

    // Build scales, unioning the data ranges of every channel sharing the scale
    const scaleRangeByKey = new Map<string, [number, number]>();
    for (const [scaleId, scaleKey] of scaleKeyById) {
      const manualMin = scaleManualMin.get(scaleKey);
      const manualMax = scaleManualMax.get(scaleKey);
      let autoMin = Infinity;
      let autoMax = -Infinity;
      for (const channelName of channelsInScale.get(scaleId) ?? []) {
        const shared = sharedYRanges.get(channelName);
        if (!shared) continue;
        if (shared[0] < autoMin) autoMin = shared[0];
        if (shared[1] > autoMax) autoMax = shared[1];
      }
      // Grouped scales (lambda, EGT) also union with the cross-chart range so
      // e.g. Bank 1 on one chart and Bank 2 on another read on the same scale.
      const groupId = scaleGroupByKey.get(scaleKey);
      const crossChart = groupId ? groupYRanges?.get(groupId) : undefined;
      if (crossChart) {
        if (crossChart[0] < autoMin) autoMin = crossChart[0];
        if (crossChart[1] > autoMax) autoMax = crossChart[1];
      }
      if (autoMin === Infinity) { autoMin = 0; autoMax = 1; }
      // Minimum-span floor for calm sensor families (see SPAN_FLOOR_UNITS)
      if (manualMin === undefined && manualMax === undefined) {
        const firstMember = (channelsInScale.get(scaleId) ?? [])[0];
        const mu = firstMember ? metricUnitByChannel.get(firstMember) : undefined;
        const dispRange = firstMember ? displayRangeByChannel.get(firstMember) : undefined;
        if (mu && SPAN_FLOOR_UNITS.has(mu) && dispRange) {
          const floorSpan = (dispRange[1] - dispRange[0]) * SPAN_FLOOR_FRAC;
          if (autoMax - autoMin < floorSpan) {
            const mid = (autoMin + autoMax) / 2;
            autoMin = mid - floorSpan / 2;
            autoMax = mid + floorSpan / 2;
            // Shift back inside the factory range rather than clipping the span
            if (autoMin < dispRange[0]) {
              autoMax = Math.min(dispRange[1], autoMax + (dispRange[0] - autoMin));
              autoMin = dispRange[0];
            } else if (autoMax > dispRange[1]) {
              autoMin = Math.max(dispRange[0], autoMin - (autoMax - dispRange[1]));
              autoMax = dispRange[1];
            }
          }
        }
      }
      const pad = (autoMax - autoMin) * 0.05 || 1;
      const lo = manualMin ?? (autoMin - pad);
      const hi = manualMax ?? (autoMax + pad);
      scaleRangeByKey.set(scaleKey, [lo, hi]);
      scales[scaleKey] = { range: () => [lo, hi] };
    }

    // Report the resolved per-channel ranges so axis editors can show what
    // "Auto" actually resolves to right now.
    {
      const byChannel = new Map<string, [number, number]>();
      for (const meta of seriesMeta) {
        const key = scaleKeyById.get(scaleIdOf(meta.channelName));
        const r = key ? scaleRangeByKey.get(key) : undefined;
        if (r && !byChannel.has(meta.channelName)) byChannel.set(meta.channelName, r);
      }
      onResolvedScaleRangesRef.current?.(byChannel);
    }

    let leftAxisCount = 0;

    // X-axis
    const axes: uPlot.Axis[] = [
      {
        stroke: "#888",
        grid: { stroke: "#333", width: 1 },
        font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
        size: showAxes ? Y_AXIS_SIZE : 8,
      },
    ];

    // Build series and axes
    const addedScales = new Set<string>();
    for (const meta of seriesMeta) {
      const scaleId = scaleIdOf(meta.channelName);
      const scaleKey = scaleKeyById.get(scaleId)!;

      const isColorBy = !!(meta.colorBy && meta.colorByVals);
      series.push({
        label: meta.channelName,
        stroke: isColorBy ? "transparent" : hexToRgba(meta.color, meta.opacity),
        width: meta.width,
        scale: scaleKey,
        spanGaps: false,
        dash: meta.dash,
        // Suppress uPlot's own line; the gradient is painted by the draw plugin.
        ...(isColorBy ? { paths: (() => null) as unknown as uPlot.Series.PathBuilder } : {}),
      });

      if (!addedScales.has(scaleKey)) {
        addedScales.add(scaleKey);
        const isFirstVisible = showAxes && leftAxisCount === 0;
        if (showAxes) leftAxisCount++;
        const mu = scaleMetricUnit.get(scaleKey) ?? "";
        const displayUnit = mu ? getDisplayUnit(mu, unitSystem, unitOverrides) : "";
        // When 2+ channels share a group scale, label the axis with the group
        // name (e.g. "RPM") instead of whichever channel happened to draw it.
        const groupId = scaleGroupByKey.get(scaleKey) ?? null;
        const memberCount = channelsInScale.get(scaleId)?.length ?? 1;
        const baseLabel =
          groupId && memberCount > 1 ? SCALE_GROUP_LABELS[groupId] : meta.channelName;
        const axisLabel = showAxes && showAxisLabels
          ? (displayUnit ? `${baseLabel} (${displayUnit})` : baseLabel)
          : "";
        axes.push({
          show: showAxes,
          scale: scaleKey,
          label: axisLabel,
          labelSize: axisLabel ? undefined : 0,
          stroke: scaleColor.get(scaleKey) ?? meta.color,
          grid: isFirstVisible ? { stroke: "#222", width: 1 } : { show: false },
          font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
          size: showAxes ? Y_AXIS_SIZE : 0,
          side: 3,
          ...(mu && {
            values: (_u: uPlot, splits: number[]) =>
              splits.map((v) => formatValue(convertForDisplay(v, mu, unitSystem, unitOverrides))),
          }),
        });
      }
    }

    // Add invisible spacer axes so all charts have the same total left width
    if (showAxes && maxYAxes && leftAxisCount < maxYAxes) {
      const firstScale = scaleKeyById.values().next().value ?? "y0";
      for (let i = leftAxisCount; i < maxYAxes; i++) {
        axes.push({
          show: true,
          scale: firstScale,
          stroke: "transparent",
          ticks: { show: false },
          grid: { show: false },
          size: Y_AXIS_SIZE,
          side: 3,
          values: () => [],
          labelSize: 0,
        });
      }
    }

    // Race start marker plugin
    const plugins: uPlot.Plugin[] = [];
    if (raceStartTimes.length > 0) {
      plugins.push({
        hooks: {
          draw: [
            (u: uPlot) => {
              const ctx = u.ctx;
              for (const rs of raceStartTimes) {
                const markerTime = rs.time + rs.offset;
                const x0 = u.valToPos(markerTime, "x", true);
                if (x0 < u.bbox.left || x0 > u.bbox.left + u.bbox.width) continue;
                ctx.save();
                ctx.strokeStyle = raceLine?.color ?? "rgba(255, 255, 255, 0.75)";
                ctx.lineWidth = (raceLine?.width ?? 1.5) * devicePixelRatio;
                // undefined = default dashed; [] = explicit solid; else the dash pattern.
                ctx.setLineDash((raceLine?.dash ?? [7, 5]).map((d) => d * devicePixelRatio));
                ctx.beginPath();
                ctx.moveTo(x0, u.bbox.top);
                ctx.lineTo(x0, u.bbox.top + u.bbox.height);
                ctx.stroke();
                ctx.restore();
              }
            },
          ],
        },
      });
    }

    // Color-by-channel gradient plugin — paints each colorBy line segment-by-
    // segment along the blue→red gradient, plus a right-edge legend bar (only
    // when exactly one colorBy line is active, to avoid overlap). Drawn before
    // selection/zones so those overlay on top.
    const colorBySeries = seriesMeta
      .map((m, i) => ({ meta: m, idx: i }))
      .filter((s) => s.meta.colorBy && s.meta.colorByVals);
    if (colorBySeries.length > 0) {
      plugins.push({
        hooks: {
          draw: [
            (u: uPlot) => {
              const ctx = u.ctx;
              const dpr = devicePixelRatio;
              const left = u.bbox.left;
              const right = u.bbox.left + u.bbox.width;

              for (const { meta, idx } of colorBySeries) {
                const yVals = seriesData[idx];
                const cbVals = meta.colorByVals!;
                const scaleId = scaleIdOf(meta.channelName);
                const scaleKey = scaleKeyById.get(scaleId)!;
                const mu = meta.colorByMetricUnit;
                const conv = (v: number) =>
                  mu ? convertForDisplay(v, mu, unitSystem, unitOverrides) : v;

                // Color range over converted colorBy values, with optional lock.
                let cMin = Infinity;
                let cMax = -Infinity;
                for (let j = 0; j < cbVals.length; j++) {
                  const cv = cbVals[j];
                  if (cv == null) continue;
                  const d = conv(cv);
                  if (d < cMin) cMin = d;
                  if (d > cMax) cMax = d;
                }
                if (cMin === Infinity) continue; // no colorBy data in view
                if (meta.colorByMin != null) cMin = meta.colorByMin;
                if (meta.colorByMax != null) cMax = meta.colorByMax;
                const span = cMax - cMin || 1;

                // Custom gradient endpoints override the default LUT
                const lowRgb = meta.colorByLowColor ? hexToRgbTuple(meta.colorByLowColor) : null;
                const highRgb = meta.colorByHighColor ? hexToRgbTuple(meta.colorByHighColor) : null;
                const colorFor = (t: number): [number, number, number] => {
                  const tc = Math.max(0, Math.min(1, t));
                  if (lowRgb && highRgb) {
                    return [
                      Math.round(lowRgb[0] + (highRgb[0] - lowRgb[0]) * tc),
                      Math.round(lowRgb[1] + (highRgb[1] - lowRgb[1]) * tc),
                      Math.round(lowRgb[2] + (highRgb[2] - lowRgb[2]) * tc),
                    ];
                  }
                  return valueToColor(tc);
                };

                ctx.save();
                ctx.lineWidth = (meta.width || 1.5) * dpr;
                ctx.lineCap = "round";
                let prevPx = -Infinity;
                let prevPy = -Infinity;
                let prevOk = false;
                for (let j = 0; j < gridTs.length; j++) {
                  const yv = yVals[j];
                  if (yv == null) { prevOk = false; continue; }
                  const px = u.valToPos(gridTs[j], "x", true);
                  const py = u.valToPos(yv, scaleKey, true);
                  if (
                    prevOk &&
                    (Math.abs(px - prevPx) >= 0.5 || Math.abs(py - prevPy) >= 0.5)
                  ) {
                    if ((px >= left && px <= right) || (prevPx >= left && prevPx <= right)) {
                      const cv = cbVals[j];
                      const t = cv == null ? 0 : (conv(cv) - cMin) / span;
                      const [r, g, b] = colorFor(t);
                      ctx.strokeStyle = `rgb(${r},${g},${b})`;
                      ctx.beginPath();
                      ctx.moveTo(prevPx, prevPy);
                      ctx.lineTo(px, py);
                      ctx.stroke();
                    }
                  }
                  prevPx = px;
                  prevPy = py;
                  prevOk = true;
                }
                ctx.restore();

                // Legend bar — only when a single colorBy line is shown.
                if (colorBySeries.length === 1) {
                  const lw = 12 * dpr;
                  const lh = Math.min(u.bbox.height * 0.6, 200 * dpr);
                  const lx = u.bbox.left + u.bbox.width - lw - 8 * dpr;
                  const ly = u.bbox.top + (u.bbox.height - lh) / 2;
                  ctx.save();
                  for (let k = 0; k < lh; k++) {
                    const [r, g, b] = colorFor(1 - k / lh);
                    ctx.fillStyle = `rgb(${r},${g},${b})`;
                    ctx.fillRect(lx, ly + k, lw, 1.5);
                  }
                  ctx.strokeStyle = "rgba(255,255,255,0.15)";
                  ctx.lineWidth = 1;
                  ctx.strokeRect(lx, ly, lw, lh);
                  ctx.fillStyle = "rgba(255,255,255,0.6)";
                  ctx.font = `${9 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
                  ctx.textAlign = "left";
                  ctx.textBaseline = "top";
                  ctx.fillText(fmtLegendVal(cMax), lx + lw + 3 * dpr, ly);
                  ctx.textBaseline = "bottom";
                  ctx.fillText(fmtLegendVal(cMin), lx + lw + 3 * dpr, ly + lh);
                  ctx.textBaseline = "middle";
                  ctx.fillText(meta.colorBy!, lx + lw + 3 * dpr, ly + lh / 2);
                  ctx.restore();
                }
              }
            },
          ],
        },
      });
    }

    // Selection highlight plugin (reads from ref, redrawn via separate effect)
    plugins.push({
      hooks: {
        draw: [
          (u: uPlot) => {
            const sel = selectionRef.current;
            if (!sel) return;
            const ctx = u.ctx;
            const dpr = devicePixelRatio;
            const x0 = u.valToPos(sel[0], "x", true);
            const x1 = u.valToPos(sel[1], "x", true);
            const plotLeft = u.bbox.left;
            const plotRight = u.bbox.left + u.bbox.width;

            // Point selection (click): draw a single vertical line
            if (sel[0] === sel[1]) {
              if (x0 < plotLeft || x0 > plotRight) return;
              ctx.save();
              ctx.strokeStyle = "rgba(59, 130, 246, 0.7)";
              ctx.lineWidth = 1.5 * dpr;
              ctx.beginPath();
              ctx.moveTo(x0, u.bbox.top);
              ctx.lineTo(x0, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.restore();
              return;
            }

            // Range selection (drag)
            const drawX0 = Math.max(plotLeft, x0);
            const drawX1 = Math.min(plotRight, x1);
            if (drawX1 <= drawX0) return;

            ctx.save();
            // Selection fill
            ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
            ctx.fillRect(drawX0, u.bbox.top, drawX1 - drawX0, u.bbox.height);
            // Selection edges
            ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
            ctx.lineWidth = 1.5 * dpr;
            if (x0 >= plotLeft && x0 <= plotRight) {
              ctx.beginPath();
              ctx.moveTo(x0, u.bbox.top);
              ctx.lineTo(x0, u.bbox.top + u.bbox.height);
              ctx.stroke();
            }
            if (x1 >= plotLeft && x1 <= plotRight) {
              ctx.beginPath();
              ctx.moveTo(x1, u.bbox.top);
              ctx.lineTo(x1, u.bbox.top + u.bbox.height);
              ctx.stroke();
            }
            // Duration label
            const duration = sel[1] - sel[0];
            const label = formatDuration(duration);
            ctx.fillStyle = "rgba(147, 197, 253, 0.9)";
            ctx.font = `bold ${Math.round(11 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
            ctx.textAlign = "center";
            const cx = (drawX0 + drawX1) / 2;
            ctx.fillText(label, cx, u.bbox.top + Math.round(14 * dpr));
            ctx.restore();
          },
        ],
      },
    });

    // Highlight zones plugin
    plugins.push({
      hooks: {
        draw: [
          (u: uPlot) => {
            const zones = evaluatedZonesRef.current;
            zoneRowsRef.current = []; // reflect only the current frame
            if (!zones || zones.length === 0) return;
            const ctx = u.ctx;
            const dpr = devicePixelRatio;
            const expandedIds = expandedZoneIdsRef.current ?? new Set<string>();

            const STRIP_H = 6 * dpr;
            const STRIP_TOP_OFFSET = 4 * dpr;
            const CHECKBOX_SIZE = 10 * dpr;
            const CHECKBOX_GAP = 4 * dpr;
            const PAD = 5 * dpr;
            // Full chip row height (checkbox + backdrop padding)
            const ROW_PITCH = CHECKBOX_SIZE + 4 * dpr;

            const enabledZones = zones.filter((z) => z.config.enabled && z.regions.length > 0);
            if (enabledZones.length === 0) return;

            // ── Pass 1: row layout. Desired y = dragged fraction or stacked
            // slot; collisions resolved by pushing rows down a full pitch so
            // chips can never overprint each other.
            const rows = enabledZones.map((zone, zi) => {
              const override = liveLabelFracRef.current[zone.config.id];
              const y =
                override != null
                  ? u.bbox.top + override * u.bbox.height
                  : u.bbox.top + STRIP_TOP_OFFSET + zi * ROW_PITCH;
              return { zone, isExpanded: expandedIds.has(zone.config.id), y };
            });
            const byY = [...rows].sort((a, b) => a.y - b.y);
            let prevY = -Infinity;
            for (const row of byY) {
              if (row.y < prevY + ROW_PITCH) row.y = prevY + ROW_PITCH;
              prevY = row.y;
            }

            const parseHex = (hex: string): [number, number, number] => [
              parseInt(hex.slice(1, 3), 16),
              parseInt(hex.slice(3, 5), 16),
              parseInt(hex.slice(5, 7), 16),
            ];

            // ── Pass 2: strips + expanded bands (always behind the chips)
            for (const { zone, isExpanded, y: stripY } of rows) {
              const [r, g, b] = parseHex(zone.config.color);
              for (const region of zone.regions) {
                const x0 = Math.max(u.bbox.left, u.valToPos(region.start, "x", true));
                const x1 = Math.min(u.bbox.left + u.bbox.width, u.valToPos(region.end, "x", true));
                if (x1 <= x0) continue;

                let rr = r, gg = g, bb = b;
                const rc = region.color;
                if (rc && rc.length >= 7 && rc[0] === "#") {
                  [rr, gg, bb] = parseHex(rc);
                }

                // Expanded: full-height semi-transparent band
                if (isExpanded) {
                  ctx.save();
                  ctx.fillStyle = `rgba(${rr},${gg},${bb},0.12)`;
                  ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
                  ctx.restore();
                }

                ctx.save();
                ctx.fillStyle = `rgba(${rr},${gg},${bb},0.7)`;
                ctx.fillRect(x0, stripY, x1 - x0, STRIP_H);
                ctx.restore();
              }
            }

            // ── Pass 3: chips (checkbox + label) at the far left, on top of
            // every strip so text always stays readable.
            for (const { zone, isExpanded, y: stripY } of rows) {
              const [r, g, b] = parseHex(zone.config.color);
              const stripFrac = (stripY - u.bbox.top) / (u.bbox.height || 1);

              ctx.save();
              ctx.font = `${Math.round(10 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
              const maxTextW = u.bbox.width - (CHECKBOX_GAP * 3 + CHECKBOX_SIZE + 6 * dpr);
              let labelText = zone.config.label;
              if (ctx.measureText(labelText).width > maxTextW) {
                while (labelText.length > 1 && ctx.measureText(labelText + "…").width > maxTextW) {
                  labelText = labelText.slice(0, -1);
                }
                labelText += "…";
              }
              const pillW = ctx.measureText(labelText).width + 6 * dpr;
              const pillH = STRIP_H;
              const totalW = CHECKBOX_SIZE + CHECKBOX_GAP + pillW;

              // Chip sits at the far left: checkbox first, label to its right.
              const cbX = u.bbox.left + CHECKBOX_GAP;
              const cbY = stripY + (STRIP_H - CHECKBOX_SIZE) / 2;

              // Opaque backdrop so the chip stays readable over strips/lines
              ctx.fillStyle = "rgba(10, 10, 12, 0.9)";
              ctx.beginPath();
              ctx.roundRect(cbX - 3 * dpr, cbY - 2 * dpr, totalW + 6 * dpr, CHECKBOX_SIZE + 4 * dpr, 3 * dpr);
              ctx.fill();

              // Checkbox
              ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
              ctx.lineWidth = 1.5 * dpr;
              ctx.strokeRect(cbX, cbY, CHECKBOX_SIZE, CHECKBOX_SIZE);
              if (isExpanded) {
                ctx.beginPath();
                ctx.moveTo(cbX + 2 * dpr, cbY + CHECKBOX_SIZE / 2);
                ctx.lineTo(cbX + CHECKBOX_SIZE / 2 - dpr, cbY + CHECKBOX_SIZE - 2 * dpr);
                ctx.lineTo(cbX + CHECKBOX_SIZE - 2 * dpr, cbY + 2 * dpr);
                ctx.strokeStyle = `rgb(${r},${g},${b})`;
                ctx.stroke();
              }

              // Label pill (vertically centered on the checkbox row)
              const labelX = cbX + CHECKBOX_SIZE + CHECKBOX_GAP;
              const textCy = cbY + CHECKBOX_SIZE / 2;
              ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
              ctx.beginPath();
              ctx.roundRect(labelX, stripY, pillW, pillH, 2 * dpr);
              ctx.fill();
              ctx.fillStyle = `rgb(${r},${g},${b})`;
              ctx.textAlign = "left";
              ctx.textBaseline = "middle";
              ctx.fillText(labelText, labelX + 3 * dpr, textCy);
              ctx.restore();

              // Stash hit boxes: checkbox (toggle) + label pill (drag handle).
              zoneRowsRef.current.push({
                id: zone.config.id,
                frac: stripFrac,
                cbLeft: cbX - 2 * dpr,
                cbRight: cbX + CHECKBOX_SIZE + 2 * dpr,
                cbTop: cbY - 2 * dpr,
                cbBottom: cbY + CHECKBOX_SIZE + 2 * dpr,
                pillLeft: labelX,
                pillRight: labelX + pillW,
                pillTop: stripY - PAD,
                pillBottom: stripY + STRIP_H + PAD,
              });
            }
          },
        ],
      },
    });

    // Timeslip band — solid contiguous segments across the bottom of the plot,
    // mirroring the OverviewBar strip so the same 60'/330'/660'/1320' markers
    // read the same in both places. Drawn last so labels stay on top of any
    // expanded zone tint.
    plugins.push({
      hooks: {
        draw: [
          (u: uPlot) => {
            const zones = timeslipZonesRef.current;
            if (!zones || zones.length === 0) return;
            const ctx = u.ctx;
            const dpr = devicePixelRatio;
            const ROW_H = TIMESLIP_ROW_H * dpr;
            const GAP = 4 * dpr; // label ↔ time spacing, and min text padding
            const plotRight = u.bbox.left + u.bbox.width;
            const bandTop = u.bbox.top + u.bbox.height - ROW_H * zones.length;

            ctx.save();
            ctx.beginPath();
            ctx.rect(u.bbox.left, bandTop, u.bbox.width, ROW_H * zones.length);
            ctx.clip();
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";

            zones.forEach((zone, zi) => {
              const rowTop = bandTop + zi * ROW_H;
              const textCy = rowTop + ROW_H / 2;

              for (const region of zone.regions) {
                const x0 = Math.max(u.bbox.left, u.valToPos(region.start, "x", true));
                const x1 = Math.min(plotRight, u.valToPos(region.end, "x", true));
                if (x1 <= x0) continue;

                const bg = region.color ?? zone.config.color;
                ctx.fillStyle = bg;
                ctx.fillRect(x0, rowTop, x1 - x0, ROW_H);
                if (!region.label) continue;

                // Fit "60'  1.23s"; drop the time, then the whole label, rather
                // than spilling half-clipped text into the next segment.
                const boldFont = `600 ${Math.round(11 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
                const timeFont = `${Math.round(11 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
                const timeText = region.time != null ? `${formatSlipTime(region.time)}s` : "";
                ctx.font = boldFont;
                const labelW = ctx.measureText(region.label).width;
                ctx.font = timeFont;
                const timeW = timeText ? ctx.measureText(timeText).width : 0;

                const avail = x1 - x0 - GAP * 2;
                const withTime = timeText ? labelW + GAP * 2 + timeW : labelW;
                const drawTime = timeText && withTime <= avail;
                const totalW = drawTime ? withTime : labelW;
                if (totalW > avail) continue; // too narrow for even the marker

                const fg = readableTextColor(bg);
                let tx = (x0 + x1) / 2 - totalW / 2;
                ctx.fillStyle = fg;
                ctx.font = boldFont;
                ctx.fillText(region.label, tx, textCy);
                if (drawTime) {
                  tx += labelW + GAP * 2;
                  ctx.font = timeFont;
                  ctx.globalAlpha = 0.9;
                  ctx.fillText(timeText, tx, textCy);
                  ctx.globalAlpha = 1;
                }
              }
            });

            ctx.restore();
          },
        ],
      },
    });

    // Destroy old
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    while (el.firstChild) el.removeChild(el.firstChild);

    // Race-time label pinned to the top of the cursor line (created after
    // the plot below; updated from the setCursor hook).
    let raceCursorLabel: HTMLDivElement | null = null;

    const plot = new uPlot(
      {
        width,
        height,
        padding: [0, 0, 0, 0],
        legend: { show: false },
        cursor: {
          show: true,
          sync: { key: syncKey },
          drag: { x: true, y: false },
        },
        scales,
        axes,
        series,
        plugins,
        hooks: {
          setSelect: [
            (u) => {
              onDragPreviewRef.current?.(null);
              if (u.select.width > 20) {
                const min = u.posToVal(u.select.left, "x");
                const max = u.posToVal(u.select.left + u.select.width, "x");
                onSelectionRef.current?.(min, max);
              }
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            },
          ],
          setCursor: [
            (u) => {
              const left = u.cursor.left;
              if (left != null && left >= 0) {
                const time = u.posToVal(left, "x");
                onCursorRef.current?.(time);
              }
              // Race time at the cursor, pinned to the top of the cursor line
              if (raceCursorLabel) {
                if (left != null && left >= 0) {
                  const time = u.posToVal(left, "x");
                  const rs = raceStartTimes[0];
                  const rt = time - (rs.time + rs.offset);
                  raceCursorLabel.textContent = `${rt.toFixed(3)}s`;
                  const w = raceCursorLabel.offsetWidth;
                  const maxLeft = u.over.clientWidth - w - 2;
                  raceCursorLabel.style.left = `${Math.min(Math.max(left - w / 2, 2), maxLeft)}px`;
                  raceCursorLabel.style.display = "block";
                } else {
                  raceCursorLabel.style.display = "none";
                }
              }
              // Report live drag preview
              if (u.select.width > 10) {
                const min = u.posToVal(u.select.left, "x");
                const max = u.posToVal(u.select.left + u.select.width, "x");
                onDragPreviewRef.current?.([min, max]);
              }
            },
          ],
        },
      },
      plotData,
      el,
    );

    chartRef.current = plot;

    if (raceStartTimes.length > 0) {
      // Bottom of the plot: the top strip is where zone labels stack, and the
      // label must never cover a label pill someone is trying to grab. Sits
      // above the timeslip band when one is showing.
      const bandH = (timeslipZones?.length ?? 0) * TIMESLIP_ROW_H;
      raceCursorLabel = document.createElement("div");
      raceCursorLabel.style.cssText =
        `position:absolute;bottom:${8 + bandH}px;display:none;pointer-events:none;z-index:10;` +
        "padding:1px 6px;font-size:13px;line-height:18px;white-space:nowrap;" +
        "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;" +
        "color:#4ade80;background:#18181b;border:1px solid rgba(74,222,128,0.35);border-radius:4px;";
      plot.over.appendChild(raceCursorLabel);
    }

    // Store series keys, original colors and widths for highlight effect
    seriesKeysRef.current = seriesMeta.map((m) => m.key);
    seriesColorsRef.current = seriesMeta.map((m) => hexToRgba(m.color, m.opacity));
    seriesWidthsRef.current = seriesMeta.map((m) => m.width);
    seriesColorByRef.current = seriesMeta.map((m) => !!(m.colorBy && m.colorByVals));

    // Detect clicks (mousedown+mouseup with minimal movement) on the chart
    const over = plot.over; // uPlot's interaction overlay element
    let downX = 0;
    let downY = 0;
    // True from the moment an edge-resize grab starts until its release is
    // consumed, so a finished edge drag isn't misread as a click that clears
    // the selection.
    let edgeResizing = false;
    // Active zone-label drag (set by onZoneDown below); declared here so the
    // click handler can ignore a release that finishes a drag.
    let zoneDrag: { id: string; startClientY: number; startFrac: number; moved: boolean } | null = null;
    const onMouseDown = (e: MouseEvent) => { downX = e.clientX; downY = e.clientY; };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return; // right/middle clicks are not selection clicks
      // A zone-label drag (still pending its document mouseup) must not be read
      // as a click/checkbox toggle.
      if (zoneDrag) return;
      if (edgeResizing) { edgeResizing = false; return; } // just resized, not a click
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      if (dx < 5 && dy < 5) {
        // Check if click is on a zone checkbox — hit-test the drawn boxes so the
        // checkbox stays aligned with a label that's been dragged off the stack.
        if (onToggleZoneExpandRef.current) {
          const dpr = devicePixelRatio;
          const rect = over.getBoundingClientRect();
          const clickX = (e.clientX - rect.left) * dpr;
          const clickY = (e.clientY - rect.top) * dpr;
          for (const row of zoneRowsRef.current) {
            if (
              clickX >= row.cbLeft &&
              clickX <= row.cbRight &&
              clickY >= row.cbTop &&
              clickY <= row.cbBottom
            ) {
              onToggleZoneExpandRef.current(row.id);
              return; // Don't process as a regular click
            }
          }
        }

        // It's a click, not a drag
        if (selectionRef.current) {
          onClearSelectionRef.current?.();
        } else {
          const rect = over.getBoundingClientRect();
          const left = e.clientX - rect.left;
          const time = plot.posToVal(left, "x");
          onSelectionRef.current?.(time, time);
        }
      }
    };
    over.addEventListener("mousedown", onMouseDown);
    over.addEventListener("mouseup", onMouseUp);

    // --- Selection edge resize (grab a range-selection edge and drag it) ---
    const EDGE_PX = 7;
    const root = plot.root; // uPlot top-level container (ancestor of `over`)
    let edgeDrag: { anchor: number } | null = null;

    // 'left' | 'right' | null for x (CSS px relative to `over`) near a sel edge
    const edgeHitAt = (x: number): "left" | "right" | null => {
      const sel = selectionRef.current;
      if (!sel || sel[0] === sel[1]) return null; // only RANGE selections
      const xl = plot.valToPos(sel[0], "x", false); // CSS px
      const xr = plot.valToPos(sel[1], "x", false);
      if (Math.abs(x - xl) <= EDGE_PX) return "left";
      if (Math.abs(x - xr) <= EDGE_PX) return "right";
      return null;
    };

    // Capture-phase mousedown on root runs BEFORE uPlot's drag-select on `over`,
    // so grabbing an edge takes over the gesture instead of starting a selection.
    const edgeDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const sel = selectionRef.current;
      if (!sel || sel[0] === sel[1]) return;
      const rect = over.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;
      const edge = edgeHitAt(x);
      if (!edge) return;
      e.stopImmediatePropagation(); // block uPlot drag-select AND `over` onMouseDown
      e.preventDefault();
      edgeResizing = true;
      edgeDrag = { anchor: edge === "left" ? sel[1] : sel[0] };
      over.style.cursor = "ew-resize";
    };

    const edgeMove = (e: MouseEvent) => {
      if (!edgeDrag) return;
      const rect = over.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const t = plot.posToVal(x, "x");
      const a = edgeDrag.anchor;
      onSelectionRef.current?.(Math.min(a, t), Math.max(a, t)); // commit each move (live)
    };

    const edgeUp = () => {
      if (!edgeDrag) return;
      edgeDrag = null;
      over.style.cursor = "";
      edgeResizing = false; // backup clear (e.g. released outside `over`)
    };

    // Hover feedback: ew-resize when over an edge (or mid-drag)
    const edgeCursor = (e: MouseEvent) => {
      if (edgeDrag) { over.style.cursor = "ew-resize"; return; }
      const rect = over.getBoundingClientRect();
      over.style.cursor = edgeHitAt(e.clientX - rect.left) ? "ew-resize" : "";
    };

    root.addEventListener("mousedown", edgeDown, true);
    over.addEventListener("mousemove", edgeCursor);
    document.addEventListener("mousemove", edgeMove);
    document.addEventListener("mouseup", edgeUp);

    // --- Drag a highlight-zone label vertically (persisted as a height fraction) ---
    const toCanvas = (e: MouseEvent) => {
      const rect = over.getBoundingClientRect();
      const dpr = devicePixelRatio;
      return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
    };
    // Draggable rows = the label pill (not the checkbox), and not timeslip strips
    // (those have no per-label persistence path).
    const dragRowAt = (cx: number, cy: number) =>
      zoneRowsRef.current.find(
        (rrow) =>
          !rrow.id.startsWith("timeslip:") &&
          cx >= rrow.pillLeft &&
          cx <= rrow.pillRight &&
          cy >= rrow.pillTop &&
          cy <= rrow.pillBottom,
      ) || null;

    // Capture-phase mousedown on root runs BEFORE uPlot's drag-select on `over`
    // (same approach as edge-resize), so grabbing a label takes over the gesture.
    const onZoneDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const { x, y } = toCanvas(e);
      const row = dragRowAt(x, y);
      if (!row) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      zoneDrag = { id: row.id, startClientY: e.clientY, startFrac: row.frac, moved: false };
      isZoneDraggingRef.current = true;
      over.style.cursor = "grabbing";
    };

    const onZoneMove = (e: MouseEvent) => {
      if (!zoneDrag) return;
      const u = chartRef.current;
      if (!u) return;
      if (Math.abs(e.clientY - zoneDrag.startClientY) < 3) return;
      zoneDrag.moved = true;
      const dpr = devicePixelRatio;
      const STRIP_H = 6 * dpr;
      const h = u.bbox.height || 1;
      const deltaY = (e.clientY - zoneDrag.startClientY) * dpr;
      const maxFrac = 1 - STRIP_H / h;
      const newFrac = Math.max(0, Math.min(maxFrac, zoneDrag.startFrac + deltaY / h));
      liveLabelFracRef.current = { ...liveLabelFracRef.current, [zoneDrag.id]: newFrac };
      u.redraw(); // live, no React render
    };

    const onZoneUp = () => {
      if (!zoneDrag) return;
      const finished = zoneDrag;
      zoneDrag = null;
      isZoneDraggingRef.current = false;
      over.style.cursor = "";
      if (finished.moved) {
        const frac = liveLabelFracRef.current[finished.id];
        if (frac != null) onMoveZoneLabelRef.current?.(finished.id, frac); // persist
      }
    };

    const onZoneCursor = (e: MouseEvent) => {
      if (zoneDrag) {
        over.style.cursor = "grabbing";
        if (raceCursorLabel) raceCursorLabel.style.display = "none";
        return;
      }
      if (edgeDrag) return; // edge-resize owns the cursor
      const rect = over.getBoundingClientRect();
      if (edgeHitAt(e.clientX - rect.left)) return; // near a selection edge -> leave edge cursor
      const { x, y } = toCanvas(e);
      if (dragRowAt(x, y)) {
        over.style.cursor = "grab";
        // Keep the race-time readout out of the way of the grab target
        if (raceCursorLabel) raceCursorLabel.style.display = "none";
      }
    };

    root.addEventListener("mousedown", onZoneDown, true);
    over.addEventListener("mousemove", onZoneCursor);
    document.addEventListener("mousemove", onZoneMove);
    document.addEventListener("mouseup", onZoneUp);

    // --- Cursor-centered mouse-wheel zoom on the x (time) axis ---
    const onWheel = (e: WheelEvent) => {
      if (wheelEnabledRef.current === false) return;
      e.preventDefault(); // stop page scroll
      const factorOut = wheelFactorRef.current ?? 1.25;
      const factor = e.deltaY > 0 ? factorOut : 1 / factorOut; // out : in
      const rect = over.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const [curMin, curMax] = currentRangeRef.current;
      const center = curMin + frac * (curMax - curMin); // cursor data-x
      const halfSpan = ((curMax - curMin) * factor) / 2;
      const next = clampWheelRange(center - halfSpan, center + halfSpan, globalRangeRef.current);
      if (next === null) {
        currentRangeRef.current = globalRangeRef.current;
        onResetZoomRef.current?.();
      } else {
        currentRangeRef.current = next; // optimistic; accumulates across events
        onZoomRef.current?.(next[0], next[1]);
      }
    };
    over.addEventListener("wheel", onWheel, { passive: false });

    // --- Right-click a line -> open that channel's context menu ---
    // Hit-test: at the cursor x, find the series whose value is nearest (in
    // pixels) to the cursor y, map its series key back to {logFileId, channel}.
    const onContextMenuChart = (e: MouseEvent) => {
      if (!onChannelContextMenuRef.current && !onRaceLineContextMenuRef.current) return;
      const rect = over.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      // Race-start marker line takes priority when the cursor is near it (x).
      if (onRaceLineContextMenuRef.current && raceStartTimes.length > 0) {
        for (const rs of raceStartTimes) {
          const mx = plot.valToPos(rs.time + rs.offset, "x", false); // CSS px
          if (Math.abs(cssX - mx) <= 6) {
            e.preventDefault();
            onRaceLineContextMenuRef.current(e.clientX, e.clientY);
            return;
          }
        }
      }
      if (!onChannelContextMenuRef.current) return;
      e.preventDefault();
      const xVal = plot.posToVal(cssX, "x");
      let idx = Math.round((xVal - gridTs[0]) / step);
      idx = Math.max(0, Math.min(gridTs.length - 1, idx));
      let bestI = -1;
      let bestDist = Infinity;
      for (let i = 0; i < seriesMeta.length; i++) {
        const v = seriesData[i][idx];
        if (v == null || v !== v) continue;
        const scaleKey = plot.series[i + 1]?.scale;
        if (!scaleKey) continue;
        const yPix = plot.valToPos(v, scaleKey, false);
        const d = Math.abs(yPix - cssY);
        if (d < bestDist) { bestDist = d; bestI = i; }
      }
      if (bestI < 0) return;
      const key = seriesMeta[bestI].key; // "logFileId:channelName"
      const sep = key.indexOf(":");
      if (sep < 0) return;
      onChannelContextMenuRef.current(key.slice(0, sep), key.slice(sep + 1), e.clientX, e.clientY);
    };
    over.addEventListener("contextmenu", onContextMenuChart);

    return () => {
      over.removeEventListener("mousedown", onMouseDown);
      over.removeEventListener("mouseup", onMouseUp);
      over.removeEventListener("contextmenu", onContextMenuChart);
      root.removeEventListener("mousedown", edgeDown, true);
      over.removeEventListener("mousemove", edgeCursor);
      document.removeEventListener("mousemove", edgeMove);
      document.removeEventListener("mouseup", edgeUp);
      root.removeEventListener("mousedown", onZoneDown, true);
      over.removeEventListener("mousemove", onZoneCursor);
      document.removeEventListener("mousemove", onZoneMove);
      document.removeEventListener("mouseup", onZoneUp);
      over.removeEventListener("wheel", onWheel);
      plot.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    groupsKey,
    width,
    height,
    syncKey,
    zoomRange?.[0],
    zoomRange?.[1],
    globalRange[0],
    globalRange[1],
    rangesKey,
    groupRangesKey,
    raceLineKey,
    showAxes,
    showAxisLabels,
    unitSystem,
    unitOverrides,
    evaluatedZones,
    timeslipZones,
    expandedZoneIds,
    maxYAxes,
  ]);

  // Redraw chart when selection changes (the draw plugin reads from ref)
  useEffect(() => {
    chartRef.current?.redraw();
  }, [selection]);

  // Live color preview: transiently stroke one series with a preview color
  // (e.g. while hovering a swatch) and restore on clear. Committing the color
  // triggers a full rebuild, so this only covers the pre-commit hover.
  useEffect(() => {
    const u = chartRef.current;
    if (!u) return;
    const keys = seriesKeysRef.current;
    if (previewColorKey && previewColor) {
      const i = keys.indexOf(previewColorKey);
      if (i >= 0 && u.series[i + 1] && !seriesColorByRef.current[i]) {
        u.series[i + 1].stroke = () => previewColor;
        u.redraw();
      }
    } else {
      const colors = seriesColorsRef.current;
      for (let i = 0; i < keys.length; i++) {
        if (seriesColorByRef.current[i]) continue;
        if (u.series[i + 1]) u.series[i + 1].stroke = () => colors[i];
      }
      u.redraw();
    }
  }, [previewColorKey, previewColor]);

  // Highlight effect: dim non-hovered series, restore on leave
  useEffect(() => {
    const u = chartRef.current;
    if (!u) return;
    const keys = seriesKeysRef.current;
    const colors = seriesColorsRef.current;
    const widths = seriesWidthsRef.current;
    const colorByFlags = seriesColorByRef.current;

    for (let i = 0; i < keys.length; i++) {
      const sIdx = i + 1; // series[0] is x-axis
      if (!u.series[sIdx]) continue;

      // Color-by-gradient series have a transparent uPlot stroke (the gradient
      // is painted by the draw plugin); never restyle them or hover/dim would
      // paint a solid line over the gradient.
      if (colorByFlags[i]) continue;

      if (highlightKey === null) {
        // Restore original
        const c = colors[i], w = widths[i];
        u.series[sIdx].stroke = () => c;
        u.series[sIdx].width = w;
      } else if (keys[i] === highlightKey) {
        // Highlighted: original color, thicker
        const c = colors[i];
        u.series[sIdx].stroke = () => c;
        u.series[sIdx].width = 3;
      } else {
        // Dimmed — parse rgb values from hex or rgba, set low alpha
        const c = colors[i];
        let dim: string;
        if (c.startsWith("#")) {
          dim = hexToRgba(c, 0.12);
        } else {
          // rgba(r,g,b,a) → replace alpha
          dim = c.replace(/,\s*[\d.]+\)$/, ",0.12)");
        }
        u.series[sIdx].stroke = () => dim;
        u.series[sIdx].width = widths[i];
      }
    }
    u.redraw();
  }, [highlightKey]);

  // Position the "copy CSV" button at the top-right of a range selection.
  useEffect(() => {
    const u = chartRef.current;
    const wrap = wrapperRef.current;
    if (!u || !wrap || !isTopTrace || !selection || selection[0] === selection[1]) {
      setCopyBtn(null);
      return;
    }
    const overRect = u.over.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const xRight = u.valToPos(Math.max(selection[0], selection[1]), "x", false); // CSS px in plot
    if (!Number.isFinite(xRight)) {
      setCopyBtn(null);
      return;
    }
    setCopyBtn({
      left: overRect.left - wrapRect.left + xRight,
      top: overRect.top - wrapRect.top,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, isTopTrace, width, height, zoomRange?.[0], zoomRange?.[1], globalRange[0], globalRange[1], showAxes, maxYAxes]);

  const handleCopyCsv = async () => {
    const group = logGroups[0];
    if (!group || !selection) return;
    const csv = buildSelectionCsv(group.log, selection, group.timeOffset, unitSystem, unitOverrides);
    if (!csv) return;
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context / denied)
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div ref={containerRef} />
      {copyBtn && (
        <button
          onClick={handleCopyCsv}
          title="Copy CSV of all channels over this range to the clipboard"
          className="absolute z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-popover/95 border border-border text-[10px] font-medium text-foreground hover:bg-muted cursor-pointer shadow"
          style={{ left: copyBtn.left, top: copyBtn.top + 3, transform: "translateX(calc(-100% - 3px))" }}
        >
          {copied ? "Copied!" : "Copy CSV"}
        </button>
      )}
    </div>
  );
}

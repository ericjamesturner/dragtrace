import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { resolveChannelStyle } from "@/lib/viewer-types";
import type { ChannelOnTrace, LoadedLog } from "@/lib/viewer-types";
import type { EvaluatedZone } from "@/hooks/useEvaluatedZones";
import { convertForDisplay, getDisplayUnit, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { formatValue, formatDuration } from "@/lib/cursor-utils";

const GRID_POINTS = 2000;
const Y_AXIS_SIZE = 45;

/** Convert a hex color + opacity (0-1) to an rgba() string. */
function hexToRgba(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
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
  evaluatedZones?: EvaluatedZone[];
  expandedZoneIds?: Set<string>;
  onToggleZoneExpand?: (zoneId: string) => void;
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
  evaluatedZones,
  expandedZoneIds,
  onToggleZoneExpand,
  highlightKey,
  maxYAxes,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  // Maps series index (1-based) to channel key, original color hex and width for highlight
  const seriesKeysRef = useRef<string[]>([]);
  const seriesColorsRef = useRef<string[]>([]);
  const seriesWidthsRef = useRef<number[]>([]);
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onClearSelectionRef = useRef(onClearSelection);
  onClearSelectionRef.current = onClearSelection;
  const onDragPreviewRef = useRef(onDragPreview);
  onDragPreviewRef.current = onDragPreview;
  const onCursorRef = useRef(onCursorTime);
  onCursorRef.current = onCursorTime;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const evaluatedZonesRef = useRef(evaluatedZones);
  evaluatedZonesRef.current = evaluatedZones;
  const expandedZoneIdsRef = useRef(expandedZoneIds);
  expandedZoneIdsRef.current = expandedZoneIds;
  const onToggleZoneExpandRef = useRef(onToggleZoneExpand);
  onToggleZoneExpandRef.current = onToggleZoneExpand;

  // Build a stable key for dependencies
  const groupsKey = logGroups
    .map((g) =>
      `${g.log.fileId}:${g.timeOffset}:${g.channels.map((c) => `${c.channelName}:${c.color ?? ""}:${c.opacity ?? ""}:${c.width ?? ""}:${(c.dash ?? []).join(".")}:${c.axisMin ?? ""}:${c.axisMax ?? ""}`).join(",")}`
    )
    .join("|");

  // Serialize sharedYRanges to a stable string so the effect doesn't re-run on every render
  const rangesKey = Array.from(sharedYRanges.entries())
    .map(([k, [min, max]]) => `${k}:${min}:${max}`)
    .join("|");

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

        seriesMeta.push({
          key: `${ch.logFileId}:${ch.channelName}`,
          channelName: ch.channelName,
          color: resolved.color,
          opacity: resolved.opacity,
          width: resolved.width,
          dash: resolved.dash,
          axisMin: ch.axisMin,
          axisMax: ch.axisMax,
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

    // Build metricUnit lookup from logGroups
    const metricUnitByChannel = new Map<string, string>();
    for (const group of logGroups) {
      for (const ch of group.channels) {
        if (!metricUnitByChannel.has(ch.channelName)) {
          const def = group.log.parsed.channelDefs.find(d => d.name === ch.channelName);
          if (def?.metricUnit) metricUnitByChannel.set(ch.channelName, def.metricUnit);
        }
      }
    }

    // Group channels by name to share y-scales
    const scaleByChannel = new Map<string, string>();
    const scaleColor = new Map<string, string>();
    // Track manual axis ranges per scale
    const scaleManualMin = new Map<string, number>();
    const scaleManualMax = new Map<string, number>();
    const scaleMetricUnit = new Map<string, string>();
    let scaleIdx = 0;

    // First pass: determine scales
    for (const meta of seriesMeta) {
      if (!scaleByChannel.has(meta.channelName)) {
        const scaleKey = `y${scaleIdx++}`;
        scaleByChannel.set(meta.channelName, scaleKey);
        scaleColor.set(scaleKey, meta.color);
        const mu = metricUnitByChannel.get(meta.channelName);
        if (mu) scaleMetricUnit.set(scaleKey, mu);
      }
      // Use manual axis ranges if set (last writer wins, but typically same channel name = same range)
      const sk = scaleByChannel.get(meta.channelName)!;
      if (meta.axisMin !== undefined) scaleManualMin.set(sk, meta.axisMin);
      if (meta.axisMax !== undefined) scaleManualMax.set(sk, meta.axisMax);
    }

    // Build scales with ranges
    for (const [channelName, scaleKey] of scaleByChannel) {
      const manualMin = scaleManualMin.get(scaleKey);
      const manualMax = scaleManualMax.get(scaleKey);
      const shared = sharedYRanges.get(channelName);
      let autoMin = shared?.[0] ?? 0;
      let autoMax = shared?.[1] ?? 1;
      if (autoMin === Infinity) { autoMin = 0; autoMax = 1; }
      const pad = (autoMax - autoMin) * 0.05 || 1;
      const lo = manualMin ?? (autoMin - pad);
      const hi = manualMax ?? (autoMax + pad);
      scales[scaleKey] = { range: () => [lo, hi] };
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
      const scaleKey = scaleByChannel.get(meta.channelName)!;

      series.push({
        label: meta.channelName,
        stroke: hexToRgba(meta.color, meta.opacity),
        width: meta.width,
        scale: scaleKey,
        spanGaps: false,
        dash: meta.dash,
      });

      if (!addedScales.has(scaleKey)) {
        addedScales.add(scaleKey);
        const isFirstVisible = showAxes && leftAxisCount === 0;
        if (showAxes) leftAxisCount++;
        const mu = scaleMetricUnit.get(scaleKey) ?? "";
        const displayUnit = mu ? getDisplayUnit(mu, unitSystem, unitOverrides) : "";
        const axisLabel = showAxes && showAxisLabels
          ? (displayUnit ? `${meta.channelName} (${displayUnit})` : meta.channelName)
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
      const firstScale = scaleByChannel.values().next().value ?? "y0";
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
                ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 3]);
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
            if (!zones || zones.length === 0) return;
            const ctx = u.ctx;
            const dpr = devicePixelRatio;
            const expandedIds = expandedZoneIdsRef.current ?? new Set<string>();

            const STRIP_H = 6 * dpr;
            const STRIP_GAP = 2 * dpr;
            const STRIP_TOP_OFFSET = 4 * dpr;
            const CHECKBOX_SIZE = 10 * dpr;
            const CHECKBOX_GAP = 4 * dpr;

            const enabledZones = zones.filter((z) => z.config.enabled && z.regions.length > 0);

            for (let zi = 0; zi < enabledZones.length; zi++) {
              const zone = enabledZones[zi];
              const isExpanded = expandedIds.has(zone.config.id);
              const hex = zone.config.color;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);

              const stripY = u.bbox.top + STRIP_TOP_OFFSET + zi * (STRIP_H + STRIP_GAP);

              // Draw regions
              for (const region of zone.regions) {
                const x0 = Math.max(u.bbox.left, u.valToPos(region.start, "x", true));
                const x1 = Math.min(u.bbox.left + u.bbox.width, u.valToPos(region.end, "x", true));
                if (x1 <= x0) continue;

                // Expanded: full-height semi-transparent band
                if (isExpanded) {
                  ctx.save();
                  ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
                  ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
                  ctx.restore();
                }

                // Always draw the strip
                ctx.save();
                ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
                ctx.fillRect(x0, stripY, x1 - x0, STRIP_H);
                ctx.restore();
              }

              // Draw checkbox
              const cbX = u.bbox.left + CHECKBOX_GAP;
              const cbY = stripY + (STRIP_H - CHECKBOX_SIZE) / 2;
              ctx.save();
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
              ctx.restore();

              // Draw label pill
              const labelX = cbX + CHECKBOX_SIZE + CHECKBOX_GAP;
              const labelText = zone.config.label;
              ctx.save();
              ctx.font = `${Math.round(10 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
              const metrics = ctx.measureText(labelText);
              const pillW = metrics.width + 6 * dpr;
              const pillH = STRIP_H;
              ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
              ctx.beginPath();
              ctx.roundRect(labelX, stripY, pillW, pillH, 2 * dpr);
              ctx.fill();
              ctx.fillStyle = `rgb(${r},${g},${b})`;
              ctx.textBaseline = "middle";
              ctx.fillText(labelText, labelX + 3 * dpr, stripY + pillH / 2);
              ctx.restore();
            }
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

    // Store series keys, original colors and widths for highlight effect
    seriesKeysRef.current = seriesMeta.map((m) => m.key);
    seriesColorsRef.current = seriesMeta.map((m) => hexToRgba(m.color, m.opacity));
    seriesWidthsRef.current = seriesMeta.map((m) => m.width);

    // Detect clicks (mousedown+mouseup with minimal movement) on the chart
    const over = plot.over; // uPlot's interaction overlay element
    let downX = 0;
    let downY = 0;
    const onMouseDown = (e: MouseEvent) => { downX = e.clientX; downY = e.clientY; };
    const onMouseUp = (e: MouseEvent) => {
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      if (dx < 5 && dy < 5) {
        // Check if click is on a zone checkbox
        const zones = evaluatedZonesRef.current;
        if (zones && onToggleZoneExpandRef.current) {
          const dpr = devicePixelRatio;
          const STRIP_H = 6 * dpr;
          const STRIP_GAP = 2 * dpr;
          const STRIP_TOP_OFFSET = 4 * dpr;
          const CHECKBOX_SIZE = 10 * dpr;
          const CHECKBOX_GAP = 4 * dpr;

          const rect = over.getBoundingClientRect();
          const clickX = (e.clientX - rect.left) * dpr;
          const clickY = (e.clientY - rect.top) * dpr;

          const enabledZones = zones.filter((z) => z.config.enabled && z.regions.length > 0);
          for (let zi = 0; zi < enabledZones.length; zi++) {
            const stripY = STRIP_TOP_OFFSET + zi * (STRIP_H + STRIP_GAP);
            const cbX = CHECKBOX_GAP;
            const cbY = stripY + (STRIP_H - CHECKBOX_SIZE) / 2;

            if (
              clickX >= cbX - 2 * dpr &&
              clickX <= cbX + CHECKBOX_SIZE + 2 * dpr &&
              clickY >= cbY - 2 * dpr &&
              clickY <= cbY + CHECKBOX_SIZE + 2 * dpr
            ) {
              onToggleZoneExpandRef.current(enabledZones[zi].config.id);
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

    return () => {
      over.removeEventListener("mousedown", onMouseDown);
      over.removeEventListener("mouseup", onMouseUp);
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
    showAxes,
    showAxisLabels,
    unitSystem,
    unitOverrides,
    evaluatedZones,
    expandedZoneIds,
    maxYAxes,
  ]);

  // Redraw chart when selection changes (the draw plugin reads from ref)
  useEffect(() => {
    chartRef.current?.redraw();
  }, [selection]);

  // Highlight effect: dim non-hovered series, restore on leave
  useEffect(() => {
    const u = chartRef.current;
    if (!u) return;
    const keys = seriesKeysRef.current;
    const colors = seriesColorsRef.current;
    const widths = seriesWidthsRef.current;

    for (let i = 0; i < keys.length; i++) {
      const sIdx = i + 1; // series[0] is x-axis
      if (!u.series[sIdx]) continue;

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

  return <div ref={containerRef} />;
}

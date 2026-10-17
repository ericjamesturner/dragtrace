import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { LoadedLog } from "@/lib/viewer-types";
import type { Id } from "../../../convex/_generated/dataModel";
import type { TimedStrip } from "@/lib/timed-page";
import { findValueAtTime, formatChannelValue } from "@/lib/cursor-utils";
import {
  convertForDisplay,
  getChannelDisplayUnit,
  getDisplayPrecision,
  type ChannelUnitOverrides,
  type UnitOverrides,
  type UnitSystem,
} from "@/lib/units";
import { dockedPanelWidth, PanelResizeHandle } from "./TraceContainer";
import { Y_AXIS_SIZE } from "./TraceChart";

const ROW_H = 18;
const ROW_GAP = 3;
/** Shades of strength a strip is drawn in; neighbouring pixels in the same one are filled together. */
const LEVELS = 24;

interface StripRun {
  log: LoadedLog;
  channelName: string;
  timestamps: Float64Array;
  values: Float64Array;
  offset: number;
  /** Log time of the launch: nothing is drawn before it. */
  launch: number;
  /** The value at the launch — what the strip counts as doing nothing. */
  rest: number;
}

interface StripModel {
  strip: TimedStrip;
  runs: StripRun[];
  /** Furthest any run strays from its resting value after the launch: full strength. */
  reach: number;
}

function buildModel(strips: TimedStrip[], logs: LoadedLog[], offsets: Map<Id<"files">, number>, hidden: Set<string>): StripModel[] {
  return strips.map((strip) => {
    const runs: StripRun[] = [];
    let reach = 0;
    for (const r of strip.runs) {
      const log = logs.find((l) => l.fileId === r.logFileId);
      if (!log || hidden.has(log.fileId) || log.raceStartTime === null) continue;
      const session = log.parsed.sessions[log.activeSessionIndex];
      const values = session?.channels.get(r.channelName);
      if (!session || !values) continue;
      const ts = session.timestamps;
      const launch = log.raceStartTime;
      let i = 0;
      while (i < ts.length - 1 && (ts[i] < launch || values[i] !== values[i])) i++;
      const rest = values[i];
      for (let k = i; k < values.length; k++) {
        const d = Math.abs(values[k] - rest);
        if (d > reach) reach = d;
      }
      runs.push({
        log,
        channelName: r.channelName,
        timestamps: ts,
        values,
        offset: offsets.get(log.fileId) ?? 0,
        launch,
        rest,
      });
    }
    return { strip, runs, reach };
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The Timed tab's strips: one thin row per timed table, on the same clock as
 * the traces. Colour shows strength — how far the line is from where it sat
 * at the launch — so when each thing starts, peaks and lets go reads at a
 * glance down the column. Each run gets its own band inside a row, in the
 * run's colour. Click a row to show it in the trace below.
 *
 * Drawn on a uPlot of its own, sized and synced like a trace, so the cursor
 * runs straight through from the strips to the chart and back.
 */
export function TimedStrips({
  strips,
  focus,
  onFocus,
  logs,
  offsets,
  hiddenLogIds,
  width,
  zoomRange,
  globalRange,
  syncKey,
  cursorTime,
  onCursorTime,
  legendWidth,
  legendCollapsed,
  onSetLegendWidth,
  statsColumns,
  showAxes,
  maxYAxes,
  unitSystem,
  unitOverrides,
  channelUnitOverrides,
}: {
  strips: TimedStrip[];
  focus?: string;
  onFocus: (key: string) => void;
  logs: LoadedLog[];
  offsets: Map<Id<"files">, number>;
  hiddenLogIds: string[];
  width: number;
  zoomRange: [number, number] | null;
  globalRange: [number, number];
  syncKey: string;
  cursorTime: number | null;
  onCursorTime: (time: number | null) => void;
  legendWidth?: number;
  legendCollapsed?: boolean;
  onSetLegendWidth: (width: number) => void;
  /** True while the channels panels widen to show range stats; the strips' panel follows. */
  statsColumns: boolean;
  showAxes: boolean;
  maxYAxes?: number;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  channelUnitOverrides?: ChannelUnitOverrides;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const model = useMemo(
    () => buildModel(strips, logs, offsets, new Set(hiddenLogIds)),
    [strips, logs, offsets, hiddenLogIds],
  );
  const runCount = Math.max(1, ...model.map((m) => m.runs.length));
  // Same sums as a trace, so the plot edges line up with the chart below.
  const panelWidth = dockedPanelWidth({ legendCollapsed, legendWidth, columns: statsColumns ? 4 : runCount });
  const chartWidth = Math.max(100, width - 8 - panelWidth);
  const height = model.length * (ROW_H + ROW_GAP) - ROW_GAP;
  const xRange = zoomRange ?? globalRange;

  const onCursorTimeRef = useRef(onCursorTime);
  onCursorTimeRef.current = onCursorTime;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  useEffect(() => {
    const el = plotRef.current;
    if (!el || model.length === 0) return;
    const [x0, x1] = xRange;
    const focusRow = model.findIndex((m) => m.strip.key === focus);

    const draw = (u: uPlot) => {
      const ctx = u.ctx;
      const { left, top, width: w } = u.bbox;
      const px = uPlot.pxRatio;
      const span = x1 - x0;
      ctx.save();
      model.forEach((m, row) => {
        const y = top + row * (ROW_H + ROW_GAP) * px;
        const h = ROW_H * px;
        ctx.fillStyle = row === focusRow ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.035)";
        ctx.fillRect(left, y, w, h);
        if (m.reach <= 0) return;
        const band = h / Math.max(1, m.runs.length);
        m.runs.forEach((run, j) => {
          const [r, g, b] = hexToRgb(run.log.logColor);
          const by = y + j * band;
          const ts = run.timestamps;
          let k = 0;
          let startX = -1;
          let level = 0;
          const flush = (endX: number) => {
            if (startX >= 0 && level > 0) {
              ctx.fillStyle = `rgba(${r},${g},${b},${(level / LEVELS).toFixed(3)})`;
              ctx.fillRect(left + startX, by, endX - startX, band);
            }
          };
          for (let x = 0; x < w; x++) {
            const t = x0 + ((x + 0.5) / w) * span - run.offset;
            let next = 0;
            if (t >= run.launch && t <= ts[ts.length - 1]) {
              while (k < ts.length - 1 && ts[k + 1] <= t) k++;
              const v = run.values[k];
              if (v === v) next = Math.round(Math.min(1, Math.abs(v - run.rest) / m.reach) * LEVELS);
            }
            if (next !== level || startX < 0) {
              flush(x);
              startX = x;
              level = next;
            }
          }
          flush(w);
        });
      });
      ctx.restore();
    };

    const axes: uPlot.Axis[] = [
      { show: false, size: 0 },
      { show: false, scale: "strip", size: 0 },
    ];
    // Traces carry an axis per channel when axes are on; leave the same room.
    if (showAxes && maxYAxes) {
      for (let i = 0; i < maxYAxes; i++) {
        axes.push({ show: true, scale: "strip", stroke: "transparent", ticks: { show: false }, grid: { show: false }, size: Y_AXIS_SIZE, side: 3, values: () => [], labelSize: 0 });
      }
    }

    const u = new uPlot(
      {
        width: chartWidth,
        height,
        padding: [0, 0, 0, 0],
        legend: { show: false },
        cursor: {
          sync: { key: syncKey, scales: ["x", null] },
          y: false,
          points: { show: false },
          drag: { x: false, y: false },
        },
        scales: { x: { time: false, range: () => [x0, x1] }, strip: { range: () => [0, 1] } },
        axes,
        series: [{}, { scale: "strip", show: false }],
        hooks: {
          draw: [draw],
          setCursor: [
            (u) => {
              const left = u.cursor.left;
              if (left != null && left >= 0) onCursorTimeRef.current(u.posToVal(left, "x"));
            },
          ],
        },
      },
      [
        [x0, x1],
        [null, null],
      ],
      el,
    );
    const over = u.over;
    over.style.cursor = "pointer";
    const handleClick = (e: MouseEvent) => {
      const row = Math.floor(e.offsetY / (ROW_H + ROW_GAP));
      const m = model[row];
      if (m && e.offsetY - row * (ROW_H + ROW_GAP) <= ROW_H) onFocusRef.current(m.strip.key);
    };
    over.addEventListener("click", handleClick);
    return () => {
      over.removeEventListener("click", handleClick);
      u.destroy();
    };
  }, [model, focus, chartWidth, height, xRange, syncKey, showAxes, maxYAxes]);

  const readout = (run: StripRun): { value: string; unit: string } | null => {
    if (cursorTime === null) return null;
    const v = findValueAtTime(run.log, run.channelName, cursorTime, run.offset);
    if (v === null) return null;
    const def = run.log.parsed.channelDefs.find((d) => d.name === run.channelName);
    const slug = def?.quantitySlug ?? "";
    const unitKey = channelUnitOverrides?.[run.channelName];
    const shown = slug ? convertForDisplay(v, slug, unitSystem, unitOverrides, unitKey) : v;
    return {
      value: formatChannelValue(shown, { decimals: getDisplayPrecision(slug, unitSystem, unitOverrides, unitKey) }),
      unit: getChannelDisplayUnit(def, unitSystem, unitOverrides, unitKey),
    };
  };

  if (model.length === 0) return null;
  return (
    <div className="mb-2 flex shrink-0 rounded-lg border border-border py-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="relative min-w-0 flex-1">
        <div ref={plotRef} />
      </div>
      <div className="relative shrink-0 border-l border-border bg-black/25 px-1" style={{ width: panelWidth }}>
        {!legendCollapsed && <PanelResizeHandle width={panelWidth} onSetWidth={onSetLegendWidth} />}
        {!legendCollapsed &&
          model.map((m) => {
            const focused = m.strip.key === focus;
            return (
              <button
                key={m.strip.key}
                type="button"
                onClick={() => onFocus(m.strip.key)}
                title={m.strip.key}
                className={`flex w-full cursor-pointer items-center gap-2 rounded px-1 text-left text-xs leading-none ${
                  focused ? "bg-white/10 text-foreground" : "text-white/70 hover:bg-white/5 hover:text-foreground"
                }`}
                style={{ height: ROW_H, marginBottom: ROW_GAP }}
              >
                <span className="min-w-0 flex-1 truncate">{m.strip.label}</span>
                {m.runs.map((run) => {
                  const r = readout(run);
                  return (
                    <span key={run.log.fileId} className="shrink-0 text-right font-mono tabular-nums" style={{ minWidth: 48 }}>
                      {r ? r.value : "—"}
                      {r?.unit && <span className="ml-0.5 text-[10px] text-muted-foreground">{r.unit}</span>}
                    </span>
                  );
                })}
              </button>
            );
          })}
      </div>
    </div>
  );
}

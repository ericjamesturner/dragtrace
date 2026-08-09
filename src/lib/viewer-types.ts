import type { Id } from "../../convex/_generated/dataModel";
import type { ParsedLog } from "./log-types";
import { cycleUnit as cycleUnitFn, type UnitSystem, type UnitOverrides } from "./units";

export const CHART_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#a855f7",
];

// 12 hand-picked, obviously distinct colors for dark backgrounds.
// Each is a different color category a child could name.
// Ordered so opposite ends are warm↔cool pairs:
// forward[0] vs backward[0] = red vs cyan, [1] vs [1] = blue vs orange, etc.
const PALETTE = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#e2e8f0", // white
  "#84cc16", // lime
  "#78716c", // gray
  "#b45309", // brown
  "#a855f7", // purple
  "#ec4899", // pink
  "#f97316", // orange
  "#06b6d4", // cyan
];

// Log 0: forward, Log 1: backward, Log 2: offset 6 forward, Log 3: offset 6 backward
function getColor(logIndex: number, channelIndex: number): string {
  const len = PALETTE.length;
  switch (logIndex % 4) {
    case 0: return PALETTE[channelIndex % len];
    case 1: return PALETTE[(len - 1 - (channelIndex % len))];
    case 2: return PALETTE[(channelIndex + 6) % len];
    case 3: return PALETTE[(len - 1 - ((channelIndex + 6) % len))];
    default: return PALETTE[channelIndex % len];
  }
}

/** Resolve the visual style for a channel on a trace.
 *  channelIndex is the per-log channel position (0, 1, 2... within that log's channels on this trace). */
export function resolveChannelStyle(
  ch: ChannelOnTrace,
  channelIndex: number,
  logIndex: number,
): { color: string; opacity: number; width: number; dash: number[] | undefined } {
  return {
    color: ch.color ?? getColor(logIndex, channelIndex),
    opacity: ch.opacity ?? 1,
    width: ch.width ?? 1.5,
    dash: ch.dash,
  };
}

export interface LoadedLog {
  fileId: Id<"files">;
  fileName: string;
  parsed: ParsedLog;
  activeSessionIndex: number;
  raceStartTime: number | null;
  logColor: string;
  logIndex: number;
}

export interface ChannelOnTrace {
  logFileId: Id<"files">;
  channelName: string;
  color?: string;
  opacity?: number;
  width?: number;
  dash?: number[];
  axisMin?: number;
  axisMax?: number;
  // Color-by-channel: color this line by a 3rd channel's value (gradient).
  colorBy?: string;
  colorByMin?: number;
  colorByMax?: number;
  // Optional custom gradient endpoints (hex); default LUT when unset.
  colorByLowColor?: string;
  colorByHighColor?: string;
}

export interface HighlightZoneConfig {
  id: string;
  expression: string;
  color: string;
  label: string;
  enabled: boolean;
  // Vertical position of the zone label/strip row, as a fraction (0..1) of
  // chart height. undefined = default stacked position.
  labelYFraction?: number;
  // The AI prompt this zone was generated from, kept editable for regeneration.
  aiPrompt?: string;
  // Display this zone on every trace in the viewer, not just its owner.
  showOnAllTraces?: boolean;
  // On-chart checkbox state: expanded = full-height band (persisted).
  expanded?: boolean;
}

export interface TraceConfig {
  id: string;
  channels: ChannelOnTrace[];
  /**
   * Absolute px when `fitTraces` is off; a relative weight when it's on
   * (rendered height = height / Σ heights × available). Same number either way,
   * so toggling fit round-trips losslessly and old configs need no migration.
   */
  height: number;
  pinned?: boolean;
  // Collapsed to a title-only strip; drops out of the fit-mode weight budget.
  collapsed?: boolean;
  // Channels unchecked in the floating legend, as `${logFileId}:${channelName}`.
  hiddenChannels?: string[];
  highlightZones?: HighlightZoneConfig[];
  // Dragged position of the floating channels legend (px within the chart).
  legendPos?: { x: number; y: number };
}

/** Smallest usable trace chart area, in px. Also the floor for a weight. */
export const MIN_TRACE_HEIGHT = 80;

// ── Non-trace viz panel types, persisted inside the same workspace JSON blob ──

export interface ScatterConfig {
  id: string;
  logFileId: Id<"files">;
  xChannel: string;
  yChannel: string;
  colorChannel?: string;
  height: number;
  pointSize?: number;
  opacity?: number;
}

export type HeatmapAggregation = "average" | "min" | "max" | "count";

export interface HeatmapConfig {
  id: string;
  logFileId: Id<"files">;
  xChannel: string;
  yChannel: string;
  valueChannel: string;
  xBins: number;
  yBins: number;
  height: number;
  aggregation: HeatmapAggregation;
}

// An AI-suggested scatter pairing (a recommendation, not a chart instance).
export interface ScatterSuggestion {
  xChannel: string;
  yChannel: string;
  colorChannel?: string;
  label: string;
  description: string;
}

export interface PageConfig {
  id: string;
  label: string;
  traces: TraceConfig[];
  scatters?: ScatterConfig[];
  heatmaps?: HeatmapConfig[];
  // Persisted drag-select range for this page (survives reload). Undefined = none.
  selection?: [number, number];
  // Persisted x-axis zoom for this page. Logs are clipped to a fixed lead-in
  // before the race, so this window stays meaningful when a different pass is
  // loaded — "the first three seconds" lands in the same place on every run.
  // Undefined = fitted to the full range.
  zoom?: [number, number];
}

export interface ViewerConfig {
  pages: PageConfig[];
  activePageId: string;
  alignByRaceTime: boolean;
  showAxes?: boolean;
  showAxisLabels?: boolean;
  hiddenLogIds?: string[];
  mirroredLogIds?: string[];
  /** Set once the one-time legend-position reset below has run. */
  legendHomed?: boolean;
  unitSystem?: UnitSystem;
  unitOverrides?: UnitOverrides;
  // Cursor-centered mouse-wheel zoom (default on; factor default 1.25).
  wheelZoomEnabled?: boolean;
  wheelZoomFactor?: number;
  // What a bare wheel does over a chart; the other gesture moves to a modifier.
  // Default "zoom" (shift+wheel scrolls). "scroll" inverts it.
  wheelMode?: "zoom" | "scroll";
  // Size traces to fill the panel by weight instead of using absolute px.
  // Default on.
  fitTraces?: boolean;
  // Collapse the floating channels legend into a one-line strip in the trace
  // header so it stops covering the plot. Default off. The overlay comes back
  // automatically while a range is selected, since the MIN/AVG/MAX/Δ table
  // doesn't fit on one line.
  compactLegend?: boolean;
  // Show AVG over a drag-selected range in the readout (default on).
  avgOnSelection?: boolean;
  // Timeslip overlay strip on traces.
  showTimeslip?: boolean;
  expandedTimeslipIds?: string[];
  // AI scatter suggestions cached for the current set of loaded channels.
  scatterSuggestions?: ScatterSuggestion[];
  scatterSuggestionsKey?: string;
  // Race-start marker line style (defaults: red, width 1.5, dash [4,3]).
  raceLineColor?: string;
  raceLineWidth?: number;
  raceLineDash?: number[];
}

export type ViewerAction =
  | { type: "addTrace"; id?: string; channels?: ChannelOnTrace[] }
  | { type: "removeTrace"; traceId: string }
  | { type: "addChannel"; traceId: string; channel: ChannelOnTrace }
  | { type: "removeChannel"; traceId: string; logFileId: Id<"files">; channelName: string }
  | { type: "setTraceHeight"; traceId: string; height: number }
  | { type: "toggleAlignment" }
  | { type: "setChannelColor"; traceId: string; logFileId: Id<"files">; channelName: string; color: string | undefined }
  | { type: "toggleAxes" }
  | { type: "toggleAxisLabels" }
  | { type: "setChannelOpacity"; traceId: string; logFileId: Id<"files">; channelName: string; opacity: number }
  | { type: "setChannelWidth"; traceId: string; logFileId: Id<"files">; channelName: string; width: number }
  | { type: "setChannelDash"; traceId: string; logFileId: Id<"files">; channelName: string; dash: number[] | undefined }
  | { type: "setChannelAxisRange"; traceId: string; logFileId: Id<"files">; channelName: string; axisMin?: number; axisMax?: number }
  | { type: "toggleLogVisibility"; logFileId: Id<"files"> }
  | { type: "setMirroredLogs"; logFileIds: string[] }
  | { type: "loadConfig"; config: ViewerConfig }
  | { type: "addPage" }
  | { type: "removePage"; pageId: string }
  | { type: "renamePage"; pageId: string; label: string }
  | { type: "switchPage"; pageId: string }
  | { type: "toggleTracePin"; traceId: string }
  | { type: "setUnitSystem"; system: UnitSystem }
  | { type: "cycleUnit"; quantitySlug: string }
  | { type: "addZone"; traceId: string; zone: HighlightZoneConfig }
  | { type: "updateZone"; traceId: string; zoneId: string; updates: Partial<Omit<HighlightZoneConfig, "id">> }
  | { type: "removeZone"; traceId: string; zoneId: string }
  | { type: "toggleZone"; traceId: string; zoneId: string }
  | { type: "setWheelZoomEnabled"; enabled: boolean }
  | { type: "setWheelZoomFactor"; factor: number }
  | { type: "setWheelMode"; mode: "zoom" | "scroll" }
  | { type: "setFitTraces"; enabled: boolean }
  | { type: "setCompactLegend"; enabled: boolean }
  | { type: "setTraceHeights"; heights: { traceId: string; height: number }[] }
  | { type: "toggleTraceCollapsed"; traceId: string }
  | { type: "setChannelsHidden"; traceId: string; keys: string[]; hidden: boolean }
  | { type: "toggleAvgOnSelection" }
  | { type: "setTraceLegendPos"; traceId: string; x: number; y: number }
  | { type: "setChannelColorBy"; traceId: string; logFileId: Id<"files">; channelName: string; colorBy: string | undefined; colorByMin?: number; colorByMax?: number; colorByLowColor?: string; colorByHighColor?: string }
  | { type: "toggleTimeslip" }
  | { type: "toggleTimeslipExpand"; id: string }
  | { type: "addScatter"; scatter: Omit<ScatterConfig, "id">; id?: string }
  | { type: "removeScatter"; scatterId: string }
  | { type: "updateScatter"; scatterId: string; updates: Partial<Omit<ScatterConfig, "id">> }
  | { type: "addHeatmap"; heatmap: Omit<HeatmapConfig, "id">; id?: string }
  | { type: "removeHeatmap"; heatmapId: string }
  | { type: "updateHeatmap"; heatmapId: string; updates: Partial<Omit<HeatmapConfig, "id">> }
  | { type: "setScatterSuggestions"; suggestions: ScatterSuggestion[]; key: string }
  | { type: "setSelection"; selection: [number, number] | null }
  | { type: "setZoom"; zoom: [number, number] | null }
  | { type: "setRaceLineStyle"; color?: string; width?: number; dash?: number[] }
  | { type: "purgeFile"; logFileId: Id<"files"> };

let traceCounter = 0;

/** Map a specific trace by ID across all pages */
function mapTraceById(
  pages: PageConfig[],
  traceId: string,
  fn: (t: TraceConfig) => TraceConfig,
): PageConfig[] {
  return pages.map((p) => ({
    ...p,
    traces: p.traces.map((t) => (t.id === traceId ? fn(t) : t)),
  }));
}

/** Map a specific channel within a specific trace across all pages */
function mapChannelInPages(
  pages: PageConfig[],
  traceId: string,
  logFileId: Id<"files">,
  channelName: string,
  fn: (c: ChannelOnTrace) => ChannelOnTrace,
): PageConfig[] {
  return mapTraceById(pages, traceId, (t) => ({
    ...t,
    channels: t.channels.map((c) =>
      c.logFileId === logFileId && c.channelName === channelName ? fn(c) : c,
    ),
  }));
}

export function viewerReducer(state: ViewerConfig, action: ViewerAction): ViewerConfig {
  switch (action.type) {
    case "addPage": {
      const id = `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const label = `Page ${state.pages.length + 1}`;
      return {
        ...state,
        pages: [...state.pages, { id, label, traces: [] }],
        activePageId: id,
      };
    }
    case "removePage": {
      const next = state.pages.filter((p) => p.id !== action.pageId);
      if (next.length === 0) {
        const id = `page-${Date.now()}`;
        return {
          ...state,
          pages: [{ id, label: "Page 1", traces: [] }],
          activePageId: id,
        };
      }
      return {
        ...state,
        pages: next,
        activePageId:
          state.activePageId === action.pageId ? next[0].id : state.activePageId,
      };
    }
    case "renamePage":
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === action.pageId ? { ...p, label: action.label } : p,
        ),
      };
    case "switchPage":
      return { ...state, activePageId: action.pageId };
    case "toggleTracePin":
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          traces: p.traces.map((t) =>
            t.id === action.traceId ? { ...t, pinned: !t.pinned } : t,
          ),
        })),
      };
    case "addTrace": {
      const id = action.id ?? `trace-${++traceCounter}`;
      const channels = (action.channels ?? []).filter(
        (c, i, arr) =>
          arr.findIndex(
            (o) => o.logFileId === c.logFileId && o.channelName === c.channelName,
          ) === i,
      );
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === state.activePageId
            ? { ...p, traces: [...p.traces, { id, channels, height: 200 }] }
            : p,
        ),
      };
    }
    case "removeTrace":
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          traces: p.traces.filter((t) => t.id !== action.traceId),
        })),
      };
    case "addChannel":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) =>
          // Clicking a channel that's already on this trace shouldn't stack a
          // second copy of the same line on top of the first.
          t.channels.some(
            (c) =>
              c.logFileId === action.channel.logFileId &&
              c.channelName === action.channel.channelName,
          )
            ? t
            : { ...t, channels: [...t.channels, action.channel] },
        ),
      };
    case "removeChannel": {
      const updated = mapTraceById(state.pages, action.traceId, (t) => ({
        ...t,
        channels: t.channels.filter(
          (c) => !(c.logFileId === action.logFileId && c.channelName === action.channelName),
        ),
      }));
      // Remove empty traces
      return {
        ...state,
        pages: updated.map((p) => ({
          ...p,
          traces: p.traces.filter((t) => t.channels.length > 0),
        })),
      };
    }
    case "setTraceHeight":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          height: Math.max(MIN_TRACE_HEIGHT, action.height),
        })),
      };
    // Update several traces in one dispatch — a splitter drag touches a pair,
    // a layout preset touches all of them. One action keeps the 2s Convex save
    // debounce from thrashing.
    case "setTraceHeights": {
      const byId = new Map(
        action.heights.map((h) => [h.traceId, Math.max(MIN_TRACE_HEIGHT, h.height)]),
      );
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          traces: p.traces.map((t) => {
            const h = byId.get(t.id);
            return h === undefined ? t : { ...t, height: h };
          }),
        })),
      };
    }
    case "toggleTraceCollapsed":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          collapsed: !t.collapsed,
        })),
      };
    // Takes a key set so the legend's per-log checkbox (which flips every
    // channel of one log) stays a single dispatch.
    case "setChannelsHidden":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => {
          const next = new Set(t.hiddenChannels ?? []);
          for (const k of action.keys) {
            if (action.hidden) next.add(k);
            else next.delete(k);
          }
          return { ...t, hiddenChannels: next.size > 0 ? Array.from(next) : undefined };
        }),
      };
    case "toggleAlignment":
      return { ...state, alignByRaceTime: !state.alignByRaceTime };
    case "setChannelColor":
      return {
        ...state,
        pages: mapChannelInPages(
          state.pages, action.traceId, action.logFileId, action.channelName,
          (c) => ({ ...c, color: action.color }),
        ),
      };
    case "toggleAxes":
      return { ...state, showAxes: !state.showAxes };
    case "toggleAxisLabels":
      return { ...state, showAxisLabels: !state.showAxisLabels };
    case "setChannelOpacity":
      return {
        ...state,
        pages: mapChannelInPages(
          state.pages, action.traceId, action.logFileId, action.channelName,
          (c) => ({ ...c, opacity: action.opacity }),
        ),
      };
    case "setChannelWidth":
      return {
        ...state,
        pages: mapChannelInPages(
          state.pages, action.traceId, action.logFileId, action.channelName,
          (c) => ({ ...c, width: action.width }),
        ),
      };
    case "setChannelDash":
      return {
        ...state,
        pages: mapChannelInPages(
          state.pages, action.traceId, action.logFileId, action.channelName,
          (c) => ({ ...c, dash: action.dash }),
        ),
      };
    case "setChannelAxisRange":
      return {
        ...state,
        pages: mapChannelInPages(
          state.pages, action.traceId, action.logFileId, action.channelName,
          (c) => ({ ...c, axisMin: action.axisMin, axisMax: action.axisMax }),
        ),
      };
    case "toggleLogVisibility": {
      const hidden = state.hiddenLogIds ?? [];
      const id = action.logFileId as string;
      const isHidden = hidden.includes(id);
      return {
        ...state,
        hiddenLogIds: isHidden ? hidden.filter((h) => h !== id) : [...hidden, id],
      };
    }
    // Every overlaid log follows the first one's channels. The set is derived
    // from what's loaded rather than chosen per log, so this replaces the list
    // wholesale instead of toggling one entry.
    case "setMirroredLogs":
      return { ...state, mirroredLogIds: action.logFileIds };
    case "setUnitSystem":
      return { ...state, unitSystem: action.system };
    case "cycleUnit": {
      const current = state.unitOverrides ?? {};
      return { ...state, unitOverrides: cycleUnitFn(action.quantitySlug, state.unitSystem ?? "imperial", current) };
    }
    case "addZone":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          highlightZones: [...(t.highlightZones ?? []), action.zone],
        })),
      };
    case "setTraceLegendPos":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          legendPos: { x: action.x, y: action.y },
        })),
      };
    case "updateZone":
      // Zones can display on traces other than their owner (showOnAllTraces),
      // so update by zone id wherever it lives.
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          traces: p.traces.map((t) => ({
            ...t,
            highlightZones: (t.highlightZones ?? []).map((z) =>
              z.id === action.zoneId ? { ...z, ...action.updates } : z,
            ),
          })),
        })),
      };
    case "removeZone":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          highlightZones: (t.highlightZones ?? []).filter((z) => z.id !== action.zoneId),
        })),
      };
    case "toggleZone":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          highlightZones: (t.highlightZones ?? []).map((z) =>
            z.id === action.zoneId ? { ...z, enabled: !z.enabled } : z,
          ),
        })),
      };
    case "setWheelZoomEnabled":
      return { ...state, wheelZoomEnabled: action.enabled };
    case "setWheelZoomFactor":
      return { ...state, wheelZoomFactor: action.factor };
    case "setWheelMode":
      return { ...state, wheelMode: action.mode };
    case "setFitTraces":
      return { ...state, fitTraces: action.enabled };
    case "setCompactLegend":
      return { ...state, compactLegend: action.enabled };
    case "toggleAvgOnSelection":
      return { ...state, avgOnSelection: !(state.avgOnSelection ?? true) };
    case "setChannelColorBy":
      return {
        ...state,
        pages: mapChannelInPages(
          state.pages, action.traceId, action.logFileId, action.channelName,
          (c) => ({ ...c, colorBy: action.colorBy, colorByMin: action.colorByMin, colorByMax: action.colorByMax, colorByLowColor: action.colorByLowColor, colorByHighColor: action.colorByHighColor }),
        ),
      };
    case "toggleTimeslip":
      // Default (undefined) = shown, so the first toggle hides it.
      return { ...state, showTimeslip: state.showTimeslip === false ? true : false };
    case "toggleTimeslipExpand": {
      const ids = state.expandedTimeslipIds ?? [];
      const has = ids.includes(action.id);
      return { ...state, expandedTimeslipIds: has ? ids.filter((i) => i !== action.id) : [...ids, action.id] };
    }
    case "addScatter": {
      const id = action.id ?? `scatter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === state.activePageId
            ? { ...p, scatters: [...(p.scatters ?? []), { ...action.scatter, id }] }
            : p,
        ),
      };
    }
    case "removeScatter":
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          scatters: (p.scatters ?? []).filter((s) => s.id !== action.scatterId),
        })),
      };
    case "updateScatter":
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          scatters: (p.scatters ?? []).map((s) =>
            s.id === action.scatterId ? { ...s, ...action.updates } : s,
          ),
        })),
      };
    case "addHeatmap": {
      const id = action.id ?? `hm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === state.activePageId
            ? { ...p, heatmaps: [...(p.heatmaps ?? []), { ...action.heatmap, id }] }
            : p,
        ),
      };
    }
    case "removeHeatmap":
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          heatmaps: (p.heatmaps ?? []).filter((h) => h.id !== action.heatmapId),
        })),
      };
    case "updateHeatmap":
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          heatmaps: (p.heatmaps ?? []).map((h) =>
            h.id === action.heatmapId ? { ...h, ...action.updates } : h,
          ),
        })),
      };
    case "setScatterSuggestions":
      return { ...state, scatterSuggestions: action.suggestions, scatterSuggestionsKey: action.key };
    case "setSelection":
      return {
        ...state,
        pages: state.pages.map((p) => {
          if (p.id !== state.activePageId) return p;
          if (action.selection) return { ...p, selection: action.selection };
          const { selection: _drop, ...rest } = p;
          return rest;
        }),
      };
    case "setZoom":
      return {
        ...state,
        pages: state.pages.map((p) => {
          if (p.id !== state.activePageId) return p;
          if (action.zoom) return { ...p, zoom: action.zoom };
          const next = { ...p };
          delete next.zoom;
          return next;
        }),
      };
    case "setRaceLineStyle":
      return { ...state, raceLineColor: action.color, raceLineWidth: action.width, raceLineDash: action.dash };
    case "purgeFile": {
      const fid = action.logFileId as string;
      // Mirroring is defined against another log. Removing one can leave the
      // survivor flagged as mirroring something that's gone, so drop the flag
      // for any log that no longer has channels of its own to mirror from.
      const remainingMirrored = (state.mirroredLogIds ?? []).filter((id) => id !== fid);
      const stillHasSource = state.pages.some((p) =>
        p.traces.some((t) =>
          t.channels.some(
            (c) =>
              (c.logFileId as string) !== fid &&
              !remainingMirrored.includes(c.logFileId as string),
          ),
        ),
      );
      return {
        ...state,
        hiddenLogIds: state.hiddenLogIds?.filter((id) => id !== fid),
        mirroredLogIds: stillHasSource ? remainingMirrored : [],
        pages: state.pages.map((page) => ({
          ...page,
          // Traces emptied by removing a log are kept, not deleted: their
          // height, zones and position survive so re-adding the log leaves the
          // layout where it was.
          traces: page.traces.map((t) => ({
            ...t,
            channels: t.channels.filter((c) => (c.logFileId as string) !== fid),
          })),
          ...(page.scatters ? { scatters: page.scatters.filter((s) => (s.logFileId as string) !== fid) } : {}),
          ...(page.heatmaps ? { heatmaps: page.heatmaps.filter((h) => (h.logFileId as string) !== fid) } : {}),
        })),
      };
    }
    case "loadConfig":
      return action.config;
  }
}

/**
 * Get the effective traces to display: active page's traces + pinned traces from other pages.
 */
export function getEffectiveTraces(config: ViewerConfig): TraceConfig[] {
  const activePage = config.pages.find((p) => p.id === config.activePageId);
  const pageTraces = activePage?.traces ?? [];

  const activeTraceIds = new Set(pageTraces.map((t) => t.id));
  const pinnedFromOther = config.pages
    .filter((p) => p.id !== config.activePageId)
    .flatMap((p) => p.traces)
    .filter((t) => t.pinned && !activeTraceIds.has(t.id));

  return [...pinnedFromOther, ...pageTraces];
}

/**
 * Get the set of trace IDs that are pinned from other pages (not the active page).
 */
export function getPinnedFromOtherIds(config: ViewerConfig): Set<string> {
  const activePage = config.pages.find((p) => p.id === config.activePageId);
  const activeTraceIds = new Set(activePage?.traces.map((t) => t.id) ?? []);
  const ids = new Set<string>();
  for (const page of config.pages) {
    if (page.id === config.activePageId) continue;
    for (const trace of page.traces) {
      if (trace.pinned && !activeTraceIds.has(trace.id)) {
        ids.add(trace.id);
      }
    }
  }
  return ids;
}

/**
 * Migrate a saved config from the old flat-traces format to the pages format.
 */
/** Strip stale color overrides from channels — the palette now handles colors. */
function stripStaleColors(pages: PageConfig[]): PageConfig[] {
  return pages.map((p) => ({
    ...p,
    traces: p.traces.map((t) => ({
      ...t,
      channels: t.channels.map((c) => {
        if (!c.color) return c;
        const { color: _, ...rest } = c;
        return rest;
      }),
    })),
  }));
}

/**
 * Unit preferences used to be keyed by a canonical unit string ("kPa", "K")
 * with ad-hoc option keys. They are now keyed by quantity slug with the unit
 * table's own alternate keys. Unmapped entries would silently revert the user
 * to system defaults, so translate the old spellings on load.
 */
const LEGACY_UNIT_KEYS: Record<string, { slug: string; options: Record<string, string> }> = {
  kPa: { slug: "pressure", options: { psi: "psi", kpa: "kpa", bar: "bar-abs", inhg: "inhg" } },
  K: { slug: "temperature", options: { F: "degf", C: "degc", K: "degc" } },
  "km/h": { slug: "speed", options: { mph: "mph", kmh: "km-h" } },
  km: { slug: "driven-distance", options: { mi: "mi", km: "km" } },
  "m/s^2": { slug: "acceleration", options: { g: "g", ms2: "m-s2" } },
  lambda: {
    slug: "afr",
    options: {
      lambda: "lambda", afr_gas: "afr-14-71", afr_e85: "afr-e85",
      afr_meth: "afr-6-47", afr_diesel: "afr-diesel",
    },
  },
  "cc/min": {
    slug: "flow",
    options: {
      ccmin: "cc-min", lbhr_gas: "lbhr-gas", lbhr_e85: "lbhr-e85",
      lbhr_meth: "meth-lb-hr",
    },
  },
};

function migrateUnitOverrides(raw: unknown): UnitOverrides | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: UnitOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, string>)) {
    const legacy = LEGACY_UNIT_KEYS[key];
    if (legacy) {
      const mapped = legacy.options[value];
      if (mapped) out[legacy.slug] = mapped;
    } else {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Computed channels renamed after the fact. Saved workspaces reference channels
 * by name, so without this a rename silently drops them from every trace they
 * were on — and the debounced save then makes that permanent.
 */
const RENAMED_CHANNELS: Record<string, string> = {
  "Bank 1 Average": "Bank 1 Lambda Average",
  "Bank 2 Average": "Bank 2 Lambda Average",
};

/** Rewrite every place a config refers to a channel by name. */
function applyChannelRenames(config: ViewerConfig): ViewerConfig {
  const rename = (name: string) => RENAMED_CHANNELS[name] ?? name;
  const touched = (name: string | undefined) => name !== undefined && name in RENAMED_CHANNELS;

  return {
    ...config,
    pages: config.pages.map((page) => ({
      ...page,
      traces: page.traces.map((t) => ({
        ...t,
        channels: t.channels.map((c) =>
          touched(c.channelName) || touched(c.colorBy)
            ? { ...c, channelName: rename(c.channelName), ...(c.colorBy ? { colorBy: rename(c.colorBy) } : {}) }
            : c,
        ),
        // Keys embed the channel name, so they have to follow it.
        ...(t.hiddenChannels
          ? {
              hiddenChannels: t.hiddenChannels.map((k) => {
                const i = k.indexOf(":");
                return i < 0 ? k : `${k.slice(0, i)}:${rename(k.slice(i + 1))}`;
              }),
            }
          : {}),
        // Zone expressions reference channels as {Name}.
        ...(t.highlightZones
          ? {
              highlightZones: t.highlightZones.map((z) => {
                let expression = z.expression;
                for (const [from, to] of Object.entries(RENAMED_CHANNELS)) {
                  expression = expression.split(`{${from}}`).join(`{${to}}`);
                }
                return expression === z.expression ? z : { ...z, expression };
              }),
            }
          : {}),
      })),
      ...(page.scatters
        ? {
            scatters: page.scatters.map((s) => ({
              ...s,
              xChannel: rename(s.xChannel),
              yChannel: rename(s.yChannel),
              ...(s.colorChannel ? { colorChannel: rename(s.colorChannel) } : {}),
            })),
          }
        : {}),
      ...(page.heatmaps
        ? {
            heatmaps: page.heatmaps.map((h) => ({
              ...h,
              xChannel: rename(h.xChannel),
              yChannel: rename(h.yChannel),
              valueChannel: rename(h.valueChannel),
            })),
          }
        : {}),
    })),
  };
}

/**
 * Legends used to open in the top left, so saved workspaces carry positions
 * that were chosen to dodge that corner. The default is the top right now, and
 * a stored position outranks it — so clear them once and let people drag again
 * from somewhere sensible.
 */
function homeLegends(config: ViewerConfig): ViewerConfig {
  if (config.legendHomed) return config;
  return {
    ...config,
    legendHomed: true,
    pages: config.pages.map((page) => ({
      ...page,
      traces: page.traces.map(({ legendPos: _drop, ...t }) => t),
    })),
  };
}

export function migrateConfig(raw: Record<string, unknown>): ViewerConfig {
  if (raw.unitOverrides) {
    raw = { ...raw, unitOverrides: migrateUnitOverrides(raw.unitOverrides) };
  }
  if (raw.pages && Array.isArray(raw.pages)) {
    const config = raw as unknown as ViewerConfig;
    return homeLegends(applyChannelRenames({ ...config, pages: stripStaleColors(config.pages) }));
  }
  // Old format: flat traces array
  if (raw.traces && Array.isArray(raw.traces)) {
    const pageId = `page-migrated`;
    return {
      pages: stripStaleColors([{ id: pageId, label: "Page 1", traces: raw.traces as TraceConfig[] }]),
      activePageId: pageId,
      alignByRaceTime: (raw.alignByRaceTime as boolean) ?? false,
      showAxes: raw.showAxes as boolean | undefined,
      showAxisLabels: raw.showAxisLabels as boolean | undefined,
      hiddenLogIds: raw.hiddenLogIds as string[] | undefined,
      mirroredLogIds: raw.mirroredLogIds as string[] | undefined,
    };
  }
  return defaultViewerConfig;
}

/**
 * Apply mirror sync: for each mirrored log, ensure its channels on each trace
 * match the non-mirrored channel names. Adds missing, removes extras.
 * Operates across all pages.
 */
function applyMirror(
  state: ViewerConfig,
  channelsByLog: Map<string, Set<string>>,
): ViewerConfig {
  const mirrored = state.mirroredLogIds;
  if (!mirrored || mirrored.length === 0) return state;

  const activeMirrored = mirrored.filter((id) => channelsByLog.has(id));
  if (activeMirrored.length === 0) return state;

  let anyChanged = false;
  const newPages = state.pages.map((page) => {
    let pageChanged = false;
    const newTraces = page.traces.map((t) => {
      const sourceNames = new Set<string>();
      for (const c of t.channels) {
        if (!activeMirrored.includes(c.logFileId as string)) {
          sourceNames.add(c.channelName);
        }
      }

      if (sourceNames.size === 0) return t;

      let newChannels = t.channels;

      for (const mirrorId of activeMirrored) {
        const available = channelsByLog.get(mirrorId);
        if (!available) continue;

        const existing = new Map<string, ChannelOnTrace>();
        for (const c of newChannels) {
          if ((c.logFileId as string) === mirrorId) {
            existing.set(c.channelName, c);
          }
        }

        for (const name of sourceNames) {
          if (!existing.has(name) && available.has(name)) {
            if (newChannels === t.channels) newChannels = [...t.channels];
            newChannels.push({ logFileId: mirrorId as Id<"files">, channelName: name });
            pageChanged = true;
          }
        }

        for (const name of existing.keys()) {
          if (!sourceNames.has(name)) {
            if (newChannels === t.channels) newChannels = [...t.channels];
            newChannels = newChannels.filter(
              (c) => !((c.logFileId as string) === mirrorId && c.channelName === name),
            );
            pageChanged = true;
          }
        }
      }

      if (newChannels !== t.channels) return { ...t, channels: newChannels };
      return t;
    });

    if (!pageChanged) return page;
    anyChanged = true;
    // Keep traces that mirror sync emptied, for the same reason the remap does:
    // an empty trace can be refilled, a removed one can't.
    return { ...page, traces: newTraces };
  });

  if (!anyChanged) return state;
  return { ...state, pages: newPages };
}

/**
 * Create a reducer that applies mirror sync after every action.
 */
export function createViewerReducer(channelsByLog: Map<string, Set<string>>) {
  return (state: ViewerConfig, action: ViewerAction): ViewerConfig => {
    const next = viewerReducer(state, action);
    return applyMirror(next, channelsByLog);
  };
}

/**
 * Remap a workspace config's file IDs to the currently loaded files.
 * Matches channels by name so the layout works across different log files
 * from the same vehicle/ECU.
 */
export function remapConfigToFiles(
  config: ViewerConfig,
  logs: LoadedLog[],
): ViewerConfig {
  if (logs.length === 0) return config;

  const loadedFileIds = new Set(logs.map((l) => l.fileId as string));

  // Check if any config file IDs are missing from loaded files
  let needsRemap = false;
  for (const page of config.pages) {
    for (const trace of page.traces) {
      for (const ch of trace.channels) {
        if (!loadedFileIds.has(ch.logFileId as string)) {
          needsRemap = true;
          break;
        }
      }
      if (needsRemap) break;
    }
    if (needsRemap) break;
  }

  // Build channel-name → first loaded fileId map
  const channelToFile = new Map<string, Id<"files">>();
  if (needsRemap) {
    for (const log of logs) {
      for (const def of log.parsed.channelDefs) {
        if (!channelToFile.has(def.name)) {
          channelToFile.set(def.name, log.fileId);
        }
      }
    }
  }

  // Always deduplicate, and remap stale file IDs if needed
  const dedupPages = config.pages.map((page) => ({
    ...page,
    traces: page.traces
      .map((trace) => {
        // hiddenChannels keys embed a file id, so they have to follow their
        // channel across a remap or the hidden channels silently reappear.
        const hidden = new Set(trace.hiddenChannels ?? []);
        const keptHidden = new Set<string>();
        const channels = trace.channels
          .map((ch) => {
            const wasHidden = hidden.has(`${ch.logFileId}:${ch.channelName}`);
            let out: ChannelOnTrace | null;
            if (loadedFileIds.has(ch.logFileId as string)) {
              out = ch;
            } else if (!needsRemap) {
              out = null;
            } else {
              const newFileId = channelToFile.get(ch.channelName);
              out = newFileId ? { ...ch, logFileId: newFileId } : null;
            }
            if (out && wasHidden) keptHidden.add(`${out.logFileId}:${out.channelName}`);
            return out;
          })
          .filter((ch): ch is ChannelOnTrace => ch !== null)
          .filter((ch, i, arr) =>
            arr.findIndex((c) => c.logFileId === ch.logFileId && c.channelName === ch.channelName) === i
          );
        return {
          ...trace,
          channels,
          hiddenChannels: keptHidden.size > 0 ? Array.from(keptHidden) : undefined,
        };
      }),
    // Traces whose channels didn't survive the remap are kept, not deleted. A
    // log recorded with different channel names would otherwise silently empty
    // a saved layout, and the debounced save would then make that permanent.
    // An empty trace is visible and fixable; a deleted one is gone.
    // Non-trace viz panels reference a single log; remap stale ids to a loaded
    // log (channels are shared across same-vehicle logs).
    ...(page.scatters ? { scatters: page.scatters.map((s) => loadedFileIds.has(s.logFileId as string) ? s : { ...s, logFileId: logs[0].fileId }) } : {}),
    ...(page.heatmaps ? { heatmaps: page.heatmaps.map((h) => loadedFileIds.has(h.logFileId as string) ? h : { ...h, logFileId: logs[0].fileId }) } : {}),
  }));

  return {
    ...config,
    ...(needsRemap ? { hiddenLogIds: undefined, mirroredLogIds: undefined } : {}),
    pages: dedupPages,
  };
}

const defaultPageId = "page-1";
export const defaultViewerConfig: ViewerConfig = {
  pages: [{ id: defaultPageId, label: "Page 1", traces: [] }],
  activePageId: defaultPageId,
  alignByRaceTime: false,
  unitSystem: "imperial",
};

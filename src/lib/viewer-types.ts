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
}

export interface HighlightZoneConfig {
  id: string;
  expression: string;
  color: string;
  label: string;
  enabled: boolean;
}

export interface TraceConfig {
  id: string;
  channels: ChannelOnTrace[];
  height: number;
  pinned?: boolean;
  highlightZones?: HighlightZoneConfig[];
}

export interface PageConfig {
  id: string;
  label: string;
  traces: TraceConfig[];
}

export interface ViewerConfig {
  pages: PageConfig[];
  activePageId: string;
  alignByRaceTime: boolean;
  showAxes?: boolean;
  showAxisLabels?: boolean;
  hiddenLogIds?: string[];
  mirroredLogIds?: string[];
  unitSystem?: UnitSystem;
  unitOverrides?: UnitOverrides;
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
  | { type: "toggleMirrorLog"; logFileId: Id<"files"> }
  | { type: "loadConfig"; config: ViewerConfig }
  | { type: "addPage" }
  | { type: "removePage"; pageId: string }
  | { type: "renamePage"; pageId: string; label: string }
  | { type: "switchPage"; pageId: string }
  | { type: "toggleTracePin"; traceId: string }
  | { type: "setUnitSystem"; system: UnitSystem }
  | { type: "cycleUnit"; metricUnit: string }
  | { type: "addZone"; traceId: string; zone: HighlightZoneConfig }
  | { type: "updateZone"; traceId: string; zoneId: string; updates: Partial<Omit<HighlightZoneConfig, "id">> }
  | { type: "removeZone"; traceId: string; zoneId: string }
  | { type: "toggleZone"; traceId: string; zoneId: string }
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
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === state.activePageId
            ? { ...p, traces: [...p.traces, { id, channels: action.channels ?? [], height: 200 }] }
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
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          channels: [...t.channels, action.channel],
        })),
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
          height: action.height,
        })),
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
    case "toggleMirrorLog": {
      const mirrored = state.mirroredLogIds ?? [];
      const id = action.logFileId as string;
      const isMirrored = mirrored.includes(id);
      return {
        ...state,
        mirroredLogIds: isMirrored ? mirrored.filter((m) => m !== id) : [...mirrored, id],
      };
    }
    case "setUnitSystem":
      return { ...state, unitSystem: action.system };
    case "cycleUnit": {
      const current = state.unitOverrides ?? {};
      return { ...state, unitOverrides: cycleUnitFn(action.metricUnit, state.unitSystem ?? "imperial", current) };
    }
    case "addZone":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          highlightZones: [...(t.highlightZones ?? []), action.zone],
        })),
      };
    case "updateZone":
      return {
        ...state,
        pages: mapTraceById(state.pages, action.traceId, (t) => ({
          ...t,
          highlightZones: (t.highlightZones ?? []).map((z) =>
            z.id === action.zoneId ? { ...z, ...action.updates } : z,
          ),
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
    case "purgeFile": {
      const fid = action.logFileId as string;
      return {
        ...state,
        hiddenLogIds: state.hiddenLogIds?.filter((id) => id !== fid),
        mirroredLogIds: state.mirroredLogIds?.filter((id) => id !== fid),
        pages: state.pages.map((page) => ({
          ...page,
          traces: page.traces
            .map((t) => ({
              ...t,
              channels: t.channels.filter((c) => (c.logFileId as string) !== fid),
            }))
            .filter((t) => t.channels.length > 0),
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

export function migrateConfig(raw: Record<string, unknown>): ViewerConfig {
  if (raw.pages && Array.isArray(raw.pages)) {
    const config = raw as unknown as ViewerConfig;
    return { ...config, pages: stripStaleColors(config.pages) };
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
    const filtered = newTraces.filter((t) => t.channels.length > 0);
    return { ...page, traces: filtered };
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
      .map((trace) => ({
        ...trace,
        channels: trace.channels
          .map((ch) => {
            if (loadedFileIds.has(ch.logFileId as string)) return ch;
            if (!needsRemap) return null;
            const newFileId = channelToFile.get(ch.channelName);
            if (!newFileId) return null;
            return { ...ch, logFileId: newFileId };
          })
          .filter((ch): ch is ChannelOnTrace => ch !== null)
          .filter((ch, i, arr) =>
            arr.findIndex((c) => c.logFileId === ch.logFileId && c.channelName === ch.channelName) === i
          ),
      }))
      .filter((trace) => trace.channels.length > 0),
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

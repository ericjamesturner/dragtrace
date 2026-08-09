import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import type { LoadedLog, ChannelOnTrace, TraceConfig, HighlightZoneConfig } from "@/lib/viewer-types";
import { resolveChannelStyle, CHART_COLORS, MIN_TRACE_HEIGHT } from "@/lib/viewer-types";
import type { Id } from "../../../convex/_generated/dataModel";
import { TraceChart } from "./TraceChart";
import { TraceSettingsPanel, ChannelPicker } from "./TraceSettingsPanel";
import { findValueAtTime, formatValue, formatChannelValue, computeRangeStats } from "@/lib/cursor-utils";
import { convertForDisplay, convertFromDisplay, getDisplayUnit, getDisplayPrecision, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { useEvaluatedZones, type EvaluatedZone } from "@/hooks/useEvaluatedZones";
import { XIcon, SlidersHorizontalIcon, ChevronDownIcon, ChevronRightIcon, GripHorizontalIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

interface ContextMenuState {
  x: number;
  y: number;
  logFileId: Id<"files">;
  channelName: string;
}

/**
 * Header + borders + resize handle around a trace's chart area. Only used to
 * set the flex min-height so the *chart* can still reach MIN_TRACE_HEIGHT;
 * being a few px off just nudges where the scroll fallback kicks in.
 */
export const TRACE_CHROME_PX = 34;

const WIDTH_OPTIONS = [1, 1.5, 2.5, 4];
const STYLE_OPTIONS: { label: string; dash: number[] | undefined }[] = [
  { label: "Solid", dash: undefined },
  { label: "Dashed", dash: [7, 5] },
  { label: "Dotted", dash: [2, 4] },
];

// Race line defaults to dashed when unset, so "Solid" is an explicit [] (empty)
// to distinguish it from "use default".
const RACE_STYLE_OPTIONS: { label: string; dash: number[] }[] = [
  { label: "Solid", dash: [] },
  { label: "Dashed", dash: [7, 5] },
  { label: "Dotted", dash: [2, 4] },
];

/** Inline axis min/max editor for the channel context menu (display units). */
function AxisInputs({
  minRaw,
  maxRaw,
  minPlaceholder = "Auto",
  maxPlaceholder = "Auto",
  toDisplay,
  fromDisplay,
  onCommit,
}: {
  minRaw?: number;
  maxRaw?: number;
  /** Shown when the field is empty (auto) — the resolved current axis value. */
  minPlaceholder?: string;
  maxPlaceholder?: string;
  toDisplay: (v: number) => number;
  fromDisplay: (v: number) => number;
  onCommit: (min?: number, max?: number) => void;
}) {
  const fmt = (v?: number) => (v === undefined ? "" : formatValue(toDisplay(v)));
  const [minInput, setMinInput] = useState(() => fmt(minRaw));
  const [maxInput, setMaxInput] = useState(() => fmt(maxRaw));

  useEffect(() => {
    setMinInput(fmt(minRaw));
    setMaxInput(fmt(maxRaw));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minRaw, maxRaw]);

  const commit = () => {
    const parse = (s: string) => {
      if (s.trim() === "") return undefined;
      const v = parseFloat(s);
      return isNaN(v) ? undefined : fromDisplay(v);
    };
    onCommit(parse(minInput), parse(maxInput));
  };

  const inputCls =
    "w-full px-2 py-1 rounded bg-muted border border-border text-sm font-mono placeholder:text-muted-foreground/70 outline-none focus:border-primary";

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        inputMode="decimal"
        placeholder={minPlaceholder}
        title={minRaw === undefined ? `Auto — currently ${minPlaceholder}` : undefined}
        value={minInput}
        onChange={(e) => setMinInput(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        className={inputCls}
      />
      <span className="text-muted-foreground text-xs shrink-0">–</span>
      <input
        type="text"
        inputMode="decimal"
        placeholder={maxPlaceholder}
        title={maxRaw === undefined ? `Auto — currently ${maxPlaceholder}` : undefined}
        value={maxInput}
        onChange={(e) => setMaxInput(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        className={inputCls}
      />
    </div>
  );
}

const COLORBY_STOPS = ["#0000b4", "#0064ff", "#00c8c8", "#00c850", "#b4dc00", "#ffc800", "#ff7800", "#ff0000"];
const COLORBY_CSS_GRADIENT = `linear-gradient(to right, ${COLORBY_STOPS.join(",")})`;

/** Compact color-by-channel editor for the context menu (display-unit range). */
function ColorByEditor({
  ch,
  pickerLogs,
  selfName,
  onSet,
}: {
  ch?: ChannelOnTrace;
  pickerLogs: LoadedLog[];
  selfName: string;
  onSet: (colorBy?: string, min?: number, max?: number, lowColor?: string, highColor?: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [lowInput, setLowInput] = useState(ch?.colorByMin?.toString() ?? "");
  const [highInput, setHighInput] = useState(ch?.colorByMax?.toString() ?? "");

  useEffect(() => {
    setLowInput(ch?.colorByMin?.toString() ?? "");
    setHighInput(ch?.colorByMax?.toString() ?? "");
  }, [ch?.colorByMin, ch?.colorByMax]);

  const lowColor = ch?.colorByLowColor;
  const highColor = ch?.colorByHighColor;
  const gradientCss =
    lowColor && highColor
      ? `linear-gradient(to right, ${lowColor}, ${highColor})`
      : COLORBY_CSS_GRADIENT;

  const parse = (s: string) => {
    if (s.trim() === "") return undefined;
    const v = parseFloat(s);
    return isNaN(v) ? undefined : v;
  };

  const commitRange = () => {
    onSet(ch?.colorBy, parse(lowInput), parse(highInput), lowColor, highColor);
  };

  const setColors = (lo: string | undefined, hi: string | undefined) => {
    onSet(ch?.colorBy, parse(lowInput), parse(highInput), lo, hi);
  };

  const inputCls =
    "w-full px-2 py-1 rounded bg-muted border border-border text-sm font-mono placeholder:text-muted-foreground/70 placeholder:font-sans outline-none focus:border-primary";

  if (!ch?.colorBy) {
    return showPicker ? (
      <ChannelPicker
        logs={pickerLogs}
        selected=""
        onSelect={(name) => {
          if (name === selfName) return; // can't color by self
          onSet(name, ch?.colorByMin, ch?.colorByMax);
          setShowPicker(false);
        }}
      />
    ) : (
      <button
        onClick={() => setShowPicker(true)}
        className="text-sm text-primary hover:text-primary/80 cursor-pointer"
      >
        Color by a channel…
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-primary font-medium truncate" title={ch.colorBy}>
          {ch.colorBy}
        </span>
        <button
          onClick={() => setShowPicker((v) => !v)}
          className="ml-auto text-[11px] text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
        >
          {showPicker ? "Hide" : "Change…"}
        </button>
        <button
          onClick={() => {
            onSet(undefined, undefined, undefined);
            setLowInput("");
            setHighInput("");
          }}
          title="Clear color-by"
          className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      {showPicker && (
        <ChannelPicker
          logs={pickerLogs}
          selected={ch.colorBy}
          onSelect={(name) => {
            if (name === selfName) return;
            onSet(name, ch.colorByMin, ch.colorByMax, lowColor, highColor);
            setShowPicker(false);
          }}
        />
      )}
      <div className="flex items-center gap-1.5">
        <div className="h-3 rounded flex-1" style={{ background: gradientCss }} />
        {(lowColor || highColor) && (
          <button
            title="Reset gradient colors"
            onClick={() => setColors(undefined, undefined)}
            className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
          >
            ↺
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <label className="relative shrink-0 cursor-pointer" title="Low end color">
          <span
            className="block w-4 h-4 rounded-full border border-white/30"
            style={{ backgroundColor: lowColor ?? COLORBY_STOPS[0] }}
          />
          <input
            type="color"
            value={lowColor ?? COLORBY_STOPS[0]}
            onChange={(e) => setColors(e.target.value, highColor ?? COLORBY_STOPS[COLORBY_STOPS.length - 1])}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
        <input
          type="text"
          inputMode="decimal"
          placeholder="Low value"
          value={lowInput}
          onChange={(e) => setLowInput(e.target.value)}
          onBlur={commitRange}
          onKeyDown={(e) => { if (e.key === "Enter") commitRange(); }}
          className={inputCls}
        />
        <input
          type="text"
          inputMode="decimal"
          placeholder="High value"
          value={highInput}
          onChange={(e) => setHighInput(e.target.value)}
          onBlur={commitRange}
          onKeyDown={(e) => { if (e.key === "Enter") commitRange(); }}
          className={inputCls}
        />
        <label className="relative shrink-0 cursor-pointer" title="High end color">
          <span
            className="block w-4 h-4 rounded-full border border-white/30"
            style={{ backgroundColor: highColor ?? COLORBY_STOPS[COLORBY_STOPS.length - 1] }}
          />
          <input
            type="color"
            value={highColor ?? COLORBY_STOPS[COLORBY_STOPS.length - 1]}
            onChange={(e) => setColors(lowColor ?? COLORBY_STOPS[0], e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
}

interface Props {
  trace: TraceConfig;
  logs: LoadedLog[];
  width: number;
  syncKey: string;
  zoomRange: [number, number] | null;
  globalRange: [number, number];
  offsets: Map<Id<"files">, number>;
  hiddenLogIds: string[];
  mirroredLogIds: string[];
  selection: [number, number] | null;
  onSelection: (min: number, max: number) => void;
  onClearSelection: () => void;
  onDragPreview: (sel: [number, number] | null) => void;
  onCursorTime: (time: number | null) => void;
  onZoom?: (min: number, max: number) => void;
  onResetZoom?: () => void;
  wheelZoomEnabled?: boolean;
  wheelZoomFactor?: number;
  wheelMode?: "zoom" | "scroll";
  avgOnSelection?: boolean;
  onRemoveTrace: () => void;
  onRemoveChannel: (logFileId: Id<"files">, channelName: string) => void;
  onAddChannel: (channel: ChannelOnTrace) => void;
  onMoveChannel: (sourceTraceId: string, logFileId: Id<"files">, channelName: string) => void;
  onResizeHeight: (height: number) => void;
  /** Fit mode: `trace.height` is a flex weight, not px. */
  fitTraces?: boolean;
  /**
   * Splitter drag against the trace below. `deltaPx` is the cumulative move
   * since mousedown; `commit` marks the final call on mouseup.
   */
  onSplitterDrag?: (deltaPx: number, commit: boolean) => void;
  /** No trace below this one to trade height with, so no resize handle. */
  isLastExpanded?: boolean;
  onToggleCollapsed?: () => void;
  onSetChannelsHidden?: (keys: string[], hidden: boolean) => void;
  /** Put the channels legend in the header strip instead of over the plot. */
  compactLegend?: boolean;
  showAxes: boolean;
  showAxisLabels: boolean;
  onSetChannelColor: (logFileId: Id<"files">, channelName: string, color: string | undefined) => void;
  onSetChannelOpacity: (logFileId: Id<"files">, channelName: string, opacity: number) => void;
  onSetChannelWidth: (logFileId: Id<"files">, channelName: string, width: number) => void;
  onSetChannelDash: (logFileId: Id<"files">, channelName: string, dash: number[] | undefined) => void;
  onSetChannelAxisRange: (logFileId: Id<"files">, channelName: string, axisMin?: number, axisMax?: number) => void;
  onSetChannelColorBy: (logFileId: Id<"files">, channelName: string, colorBy?: string, colorByMin?: number, colorByMax?: number, colorByLowColor?: string, colorByHighColor?: string) => void;
  isActive: boolean;
  onSetActive: () => void;
  pinned: boolean;
  isPinnedFromOther: boolean;
  onTogglePin: () => void;
  cursorTime: number | null;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  onAddZone?: (zone: HighlightZoneConfig) => void;
  onUpdateZone?: (zoneId: string, updates: Partial<Omit<HighlightZoneConfig, "id">>) => void;
  onRemoveZone?: (zoneId: string) => void;
  onToggleZone?: (zoneId: string) => void;
  // Timeslip overlay: synthetic zones (one per file timeslip) + persisted expand state.
  timeslipZones?: EvaluatedZone[];
  /** Cross-chart union range per scale group (e.g. "lambda") from the page. */
  groupYRanges?: Map<string, [number, number]>;
  /** Zones (from any trace) flagged to display on every trace. */
  sharedZones?: HighlightZoneConfig[];
  /** Persist the dragged channels-legend position. */
  onSetLegendPos?: (x: number, y: number) => void;
  expandedTimeslipIds?: string[];
  onToggleTimeslipExpand?: (id: string) => void;
  // Race-start marker line style + setter (global; persisted in config).
  raceLine?: { color?: string; width?: number; dash?: number[] };
  onSetRaceLineStyle?: (style: { color?: string; width?: number; dash?: number[] }) => void;
  isTopTrace?: boolean;
  maxYAxes?: number;
}

export function TraceContainer({
  trace,
  logs,
  width,
  syncKey,
  zoomRange,
  globalRange,
  offsets,
  hiddenLogIds,
  selection,
  onSelection,
  onClearSelection,
  onDragPreview,
  onCursorTime,
  onZoom,
  onResetZoom,
  wheelZoomEnabled,
  wheelZoomFactor,
  wheelMode,
  avgOnSelection = true,
  onRemoveTrace,
  onRemoveChannel,
  onAddChannel,
  onMoveChannel,
  onResizeHeight,
  fitTraces = true,
  onSplitterDrag,
  isLastExpanded,
  onToggleCollapsed,
  onSetChannelsHidden,
  compactLegend = false,
  showAxes,
  showAxisLabels,
  onSetChannelColor,
  onSetChannelOpacity,
  onSetChannelWidth,
  onSetChannelDash,
  onSetChannelAxisRange,
  onSetChannelColorBy,
  isActive,
  onSetActive,
  pinned,
  isPinnedFromOther,
  onTogglePin,
  cursorTime,
  unitSystem,
  unitOverrides,
  onAddZone,
  onUpdateZone,
  onRemoveZone,
  onToggleZone,
  timeslipZones,
  groupYRanges,
  sharedZones,
  onSetLegendPos,
  expandedTimeslipIds,
  onToggleTimeslipExpand,
  raceLine,
  onSetRaceLineStyle,
  isTopTrace,
  maxYAxes,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Appearance section of the channel context menu (collapsed by default)
  const [cmAppearanceOpen, setCmAppearanceOpen] = useState(false);
  // Resolved y-range per channel, reported by the chart after auto-scaling —
  // this is what "Auto" actually is right now.
  const [resolvedRanges, setResolvedRanges] = useState<Map<string, [number, number]>>(
    () => new Map(),
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Race-start marker line right-click menu.
  const [raceMenu, setRaceMenu] = useState<{ x: number; y: number } | null>(null);
  // Live color preview while hovering a swatch in the context menu.
  const [colorPreview, setColorPreview] = useState<{ key: string; color: string } | null>(null);
  // Clear any preview whenever the menu opens, moves, or closes.
  useEffect(() => {
    setColorPreview(null);
  }, [contextMenu]);

  // null means "wherever the default corner is" — top right, anchored so it
  // stays there as the trace is resized. Dragging pins it to a left/top pair.
  const [legendPos, setLegendPos] = useState<{ x: number; y: number } | null>(
    trace.legendPos ?? null,
  );
  const legendRef = useRef<HTMLDivElement>(null);

  // Follow externally-loaded positions (workspace switch, other session)
  useEffect(() => {
    setLegendPos(trace.legendPos ?? null);
  }, [trace.legendPos?.x, trace.legendPos?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const [legendMinimized, setLegendMinimized] = useState(false);
  const legendDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const hiddenChannels = useMemo(
    () => new Set(trace.hiddenChannels ?? []),
    [trace.hiddenChannels],
  );

  // In fit mode the chart area is sized by flexbox, so its height has to be
  // measured rather than read from config. Seeded with trace.height so the
  // first paint isn't zero-height.
  const [measuredHeight, setMeasuredHeight] = useState(trace.height);
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el || !fitTraces || trace.collapsed) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setMeasuredHeight(Math.round(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitTraces, trace.collapsed]);

  const chartHeight = fitTraces ? measuredHeight : trace.height;
  const collapsed = trace.collapsed ?? false;

  // Identifies the trace in the (sticky) header and when collapsed — the header
  // otherwise carries no label at all.
  const traceTitle = useMemo(
    () => Array.from(new Set(trace.channels.map((c) => c.channelName))).join(" · "),
    [trace.channels],
  );

  // Evaluate highlight zones
  const evaluatedZones = useEvaluatedZones(
    trace.highlightZones,
    logs,
    offsets,
    unitSystem,
    unitOverrides,
  );

  // Shared zones from other traces (showOnAllTraces), excluding ones this
  // trace already owns.
  const foreignSharedZones = useMemo(
    () =>
      (sharedZones ?? []).filter(
        (z) => !(trace.highlightZones ?? []).some((own) => own.id === z.id),
      ),
    [sharedZones, trace.highlightZones],
  );
  const evaluatedSharedZones = useEvaluatedZones(
    foreignSharedZones,
    logs,
    offsets,
    unitSystem,
    unitOverrides,
  );

  // Timeslips don't go through the zone plugin — they get their own solid band
  // across the bottom of the chart (see TraceChart's timeslip plugin).
  const allZones = useMemo(
    () => [...evaluatedZones, ...evaluatedSharedZones],
    [evaluatedZones, evaluatedSharedZones],
  );
  const mergedExpanded = useMemo(
    () =>
      new Set<string>([
        ...(trace.highlightZones ?? []).filter((z) => z.expanded).map((z) => z.id),
        ...foreignSharedZones.filter((z) => z.expanded).map((z) => z.id),
        ...(expandedTimeslipIds ?? []),
      ]),
    [trace.highlightZones, foreignSharedZones, expandedTimeslipIds],
  );

  const handleToggleZoneExpand = useCallback(
    (zoneId: string) => {
      if (zoneId.startsWith("timeslip:")) {
        onToggleTimeslipExpand?.(zoneId);
        return;
      }
      // Persisted on the zone config so it survives refresh and follows the
      // zone across traces/logs (updateZone resolves by id anywhere).
      const zone =
        (trace.highlightZones ?? []).find((z) => z.id === zoneId) ??
        foreignSharedZones.find((z) => z.id === zoneId);
      onUpdateZone?.(zoneId, { expanded: !zone?.expanded });
    },
    [onToggleTimeslipExpand, onUpdateZone, trace.highlightZones, foreignSharedZones],
  );

  const handleLegendMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Undragged legends are anchored to a corner rather than to coordinates,
    // so the drag starts from where the element actually sits.
    const el = legendRef.current;
    const origin = legendPos ?? { x: el?.offsetLeft ?? 8, y: el?.offsetTop ?? 8 };
    legendDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: origin.x,
      originY: origin.y,
    };

    let lastX = origin.x;
    let lastY = origin.y;
    let moved = false;
    const handleMove = (ev: MouseEvent) => {
      if (!legendDragRef.current || !chartAreaRef.current) return;
      const bounds = chartAreaRef.current.getBoundingClientRect();
      const dx = ev.clientX - legendDragRef.current.startX;
      const dy = ev.clientY - legendDragRef.current.startY;
      lastX = Math.max(0, Math.min(bounds.width - 40, legendDragRef.current.originX + dx));
      lastY = Math.max(0, Math.min(bounds.height - 20, legendDragRef.current.originY + dy));
      moved = true;
      setLegendPos({ x: lastX, y: lastY });
    };

    const handleUp = () => {
      legendDragRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      if (moved) onSetLegendPos?.(lastX, lastY); // persist to workspace
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [legendPos, onSetLegendPos]);

  // Close context menus on click outside or escape
  useEffect(() => {
    if (!contextMenu && !raceMenu) return;
    const close = () => { setContextMenu(null); setRaceMenu(null); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu, raceMenu]);

  // Group channels by log file
  const channelsByLog = new Map<Id<"files">, ChannelOnTrace[]>();
  for (const ch of trace.channels) {
    const existing = channelsByLog.get(ch.logFileId) ?? [];
    existing.push(ch);
    channelsByLog.set(ch.logFileId, existing);
  }

  // Find which logs have channels on this trace
  const logsWithChannels = logs.filter((l) => channelsByLog.has(l.fileId));

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          logFileId: Id<"files">;
          channelName: string;
          sourceTraceId?: string;
        };
        if (parsed.logFileId && parsed.channelName) {
          // If moving from another trace, remove from source first
          if (parsed.sourceTraceId && parsed.sourceTraceId !== trace.id) {
            onMoveChannel(parsed.sourceTraceId, parsed.logFileId, parsed.channelName);
          }
          // Don't add duplicate
          const exists = trace.channels.some(
            (c) => c.logFileId === parsed.logFileId && c.channelName === parsed.channelName
          );
          if (!exists) {
            onAddChannel({ logFileId: parsed.logFileId, channelName: parsed.channelName });
          }
        }
      } catch {
        // Not valid JSON — ignore
      }
    },
    [trace.id, trace.channels, onAddChannel, onMoveChannel]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = trace.height;

      // Fit mode: the handle is a splitter between this trace and the one
      // below, so the parent redistributes the pair's weight. Otherwise it's
      // the plain absolute-px resize.
      const handleMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        if (fitTraces) onSplitterDrag?.(delta, false);
        else onResizeHeight(Math.max(MIN_TRACE_HEIGHT, startHeight + delta));
      };

      const handleUp = (ev: MouseEvent) => {
        if (fitTraces) onSplitterDrag?.(ev.clientY - startY, true);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [trace.height, onResizeHeight, fitTraces, onSplitterDrag]
  );

  // Compute shared y-ranges across all logs for each channel name
  // so overlaid charts use the same y-scale
  const sharedYRanges = useMemo(() => {
    const ranges = new Map<string, [number, number]>();
    for (const log of logsWithChannels) {
      const session = log.parsed.sessions[log.activeSessionIndex];
      if (!session) continue;
      const logChannels = channelsByLog.get(log.fileId) ?? [];
      for (const ch of logChannels) {
        const data = session.channels.get(ch.channelName);
        if (!data) continue;
        const existing = ranges.get(ch.channelName);
        let min = existing?.[0] ?? Infinity;
        let max = existing?.[1] ?? -Infinity;
        for (let j = 0; j < data.length; j++) {
          const v = data[j];
          if (v !== v) continue; // NaN
          if (v < min) min = v;
          if (v > max) max = v;
        }
        ranges.set(ch.channelName, [min, max]);
      }
    }
    return ranges;
  }, [logsWithChannels, channelsByLog]);

  // Build log groups for the single combined chart (filter hidden logs)
  const hiddenSet = useMemo(() => new Set(hiddenLogIds), [hiddenLogIds]);

  const logGroups = useMemo(() => {
    return logsWithChannels
      .filter((log) => !hiddenSet.has(log.fileId))
      .map((log) => ({
        log,
        channels: (channelsByLog.get(log.fileId) ?? []).filter(
          (ch) => !hiddenChannels.has(`${ch.logFileId}:${ch.channelName}`)
        ),
        timeOffset: offsets.get(log.fileId) ?? 0,
      }))
      .filter((g) => g.channels.length > 0);
  }, [logsWithChannels, channelsByLog, offsets, hiddenSet, hiddenChannels]);

  // Collect race start times for markers
  const raceStartTimes = useMemo(() => {
    return logsWithChannels
      .filter((l) => l.raceStartTime !== null)
      .map((l) => ({
        time: l.raceStartTime!,
        offset: offsets.get(l.fileId) ?? 0,
      }));
  }, [logsWithChannels, offsets]);

  // Chart area width
  const chartWidth = Math.max(100, width - 8);

  // A RANGE selection (not a click/point) drives the AVG readout, when enabled.
  const avgRange: [number, number] | null =
    avgOnSelection && selection && selection[0] !== selection[1] ? selection : null;

  // Everything both legend renderers need, computed once. The floating overlay
  // and the compact header strip show the same numbers; only the layout differs.
  const legendGroups = useMemo(() => {
    const logFileOrder: string[] = [];
    const channelsByLogId = new Map<string, ChannelOnTrace[]>();
    for (const ch of trace.channels) {
      const id = ch.logFileId as string;
      if (!channelsByLogId.has(id)) {
        logFileOrder.push(id);
        channelsByLogId.set(id, []);
      }
      channelsByLogId.get(id)!.push(ch);
    }
    const multiLog = logFileOrder.length > 1;

    return logFileOrder.map((logId) => {
      const logChannels = channelsByLogId.get(logId)!;
      const log = logs.find((l) => (l.fileId as string) === logId);
      const isLogHidden = hiddenSet.has(logId as Id<"files">);
      const allLogChKeys = logChannels.map((c) => `${c.logFileId}:${c.channelName}`);
      const allLogHidden = allLogChKeys.every((k) => hiddenChannels.has(k));
      const someLogHidden = allLogChKeys.some((k) => hiddenChannels.has(k));

      const rows = logChannels.map((ch, chIdx) => {
        const chKey = `${ch.logFileId}:${ch.channelName}`;
        const isChHidden = hiddenChannels.has(chKey);
        const resolved = resolveChannelStyle(ch, chIdx, log?.logIndex ?? 0);

        let valueStr: string | null = null;
        let minStr: string | null = null;
        let maxStr: string | null = null;
        let deltaStr: string | null = null;
        let unitLabel = "";
        let isAvg = false;
        const def = log?.parsed.channelDefs.find((d) => d.name === ch.channelName);
        if (avgRange && log && !isLogHidden && !isChHidden && !def?.enumValues) {
          const offset = offsets.get(log.fileId) ?? 0;
          const stats = computeRangeStats(log, ch.channelName, avgRange, offset);
          if (stats !== null) {
            const mu = def?.quantitySlug ?? "";
            const conv = (v: number) =>
              mu ? convertForDisplay(v, mu, unitSystem, unitOverrides) : v;
            valueStr = formatValue(conv(stats.avg));
            minStr = formatValue(conv(stats.min));
            maxStr = formatValue(conv(stats.max));
            unitLabel = mu ? getDisplayUnit(mu, unitSystem, unitOverrides) : "";
            isAvg = true;
            // Start -> end change over the selection, in display units
            // (convert endpoints first: some conversions have offsets).
            const startV = findValueAtTime(log, ch.channelName, Math.min(avgRange[0], avgRange[1]), offset);
            const endV = findValueAtTime(log, ch.channelName, Math.max(avgRange[0], avgRange[1]), offset);
            if (startV !== null && endV !== null) {
              const d = conv(endV) - conv(startV);
              deltaStr = `${d >= 0 ? "+" : ""}${formatValue(d)}`;
            }
          }
        } else if (cursorTime !== null && log && !isLogHidden && !isChHidden) {
          const offset = offsets.get(log.fileId) ?? 0;
          const val = findValueAtTime(log, ch.channelName, cursorTime, offset);
          if (val !== null) {
            const mu = def?.quantitySlug ?? "";
            if (def?.enumValues) {
              // A state channel reads as its label, with no unit suffix.
              valueStr = formatChannelValue(val, { enumValues: def.enumValues });
              unitLabel = "";
            } else {
              const converted = mu ? convertForDisplay(val, mu, unitSystem, unitOverrides) : val;
              valueStr = formatChannelValue(converted, {
                decimals: getDisplayPrecision(mu, unitSystem, unitOverrides),
              });
              unitLabel = mu ? getDisplayUnit(mu, unitSystem, unitOverrides) : "";
            }
          }
        }

        return {
          chKey, ch, indent: multiLog, isLogHidden, isChHidden,
          logName: log ? log.fileName.replace(/\.[^.]+$/, "") : "",
          logColor: log?.logColor ?? "#3b82f6",
          logIndex: log?.logIndex ?? 0,
          color: resolved.color, opacity: resolved.opacity,
          valueStr, minStr, maxStr, deltaStr, unitLabel, isAvg,
        };
      });

      return { logId, log, isLogHidden, multiLog, allLogChKeys, allLogHidden, someLogHidden, rows };
    });
  }, [
    trace.channels, logs, hiddenSet, hiddenChannels, avgRange,
    cursorTime, offsets, unitSystem, unitOverrides,
  ]);

  // Compact mode puts the legend in the header, but the MIN/AVG/MAX/Δ table
  // needs the roomy overlay — so a range selection temporarily brings it back.
  const legendInHeader = compactLegend && !avgRange && trace.channels.length > 0;

  // For the header strip, collapse the per-log rows into one entry per channel
  // NAME, with that channel's value from each log side by side. Comparing two
  // logs is the whole point of the overlay, and this is both half the width of
  // one-chip-per-series and easier to read: the numbers you're comparing end up
  // adjacent instead of a screen apart.
  const compactChannels = useMemo(() => {
    const byName = new Map<string, typeof legendGroups[number]["rows"]>();
    for (const g of legendGroups) {
      for (const row of g.rows) {
        const existing = byName.get(row.ch.channelName);
        if (existing) existing.push(row);
        else byName.set(row.ch.channelName, [row]);
      }
    }
    return [...byName.entries()].map(([name, rows]) => ({
      name,
      // Stable log order, so a value sits in the same position in every group
      // even when one log is missing that channel.
      rows: [...rows].sort((a, b) => a.logIndex - b.logIndex),
      unitLabel: rows.find((r) => r.unitLabel)?.unitLabel ?? "",
    }));
  }, [legendGroups]);

  /**
   * The logs represented on this trace, in log order. When there's more than
   * one, the compact strip colours values by LOG rather than by series: within
   * a channel group every value is the same channel, so the log is the only
   * thing that distinguishes them. These are the same identity colours the
   * sidebar puts next to each log name.
   */
  const traceLogs = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string; index: number }>();
    for (const g of legendGroups) {
      for (const r of g.rows) {
        if (!seen.has(r.ch.logFileId as string)) {
          seen.set(r.ch.logFileId as string, {
            id: r.ch.logFileId as string,
            name: r.logName,
            color: r.logColor,
            index: r.logIndex,
          });
        }
      }
    }
    const list = [...seen.values()].sort((a, b) => a.index - b.index);
    // Short tag for the key: racers name runs "Q1", "E1 6.325 @ 227" — the
    // leading token is the useful part. Fall back to the full name on a clash.
    const tags = list.map((l) => l.name.trim().split(/\s+/)[0] || l.name);
    const unique = new Set(tags).size === tags.length;
    return list.map((l, i) => ({ ...l, tag: unique ? tags[i] : l.name }));
  }, [legendGroups]);

  const multiLogTrace = traceLogs.length > 1;

  return (
    <div
      data-trace-id={trace.id}
      className={`flex flex-col border rounded-lg mb-2 ${collapsed ? "shrink-0" : "min-h-0"} ${dragOver ? "border-primary bg-primary/5" : isPinnedFromOther ? "border-primary/30 border-dashed" : isActive ? "border-primary/50" : "border-border"}`}
      // Fit mode: trace.height is a weight, and flexbox turns it into pixels.
      // A collapsed trace leaves the budget entirely (basis auto, no grow).
      style={
        fitTraces && !collapsed
          ? { flexGrow: trace.height, flexBasis: 0, minHeight: MIN_TRACE_HEIGHT + TRACE_CHROME_PX }
          : undefined
      }
      onClick={onSetActive}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header — collapse toggle, channel summary, action buttons */}
      <div className="sticky top-0 z-20 flex items-center gap-1.5 px-2 py-1 border-b bg-muted rounded-t-lg shrink-0">
        <Tip content={collapsed ? "Expand trace" : "Collapse trace"}>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapsed?.(); }}
            className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
          >
            {collapsed ? <ChevronRightIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
          </button>
        </Tip>
        {trace.channels.length === 0 ? (
          <span className="text-xs text-muted-foreground flex-1 truncate">
            Drop channels here or click a channel in the sidebar
          </span>
        ) : legendInHeader && !collapsed ? (
          // Compact legend: one scrollable line of channel chips. Same
          // interactions as the overlay rows — toggle, hover-to-highlight,
          // drag to another trace, right-click to style.
          <div className="flex-1 min-w-0 flex items-center overflow-x-auto whitespace-nowrap">
            {/* Colour key: which run is which. Same colours the sidebar shows
                against each log, and the same order the values appear in. */}
            {multiLogTrace && (
              <div className="flex items-baseline gap-2 shrink-0 pr-2.5">
                {traceLogs.map((l) => (
                  <span
                    key={l.id}
                    title={l.name}
                    className="text-[10px] font-bold uppercase tracking-wider max-w-[84px] truncate"
                    style={{ color: l.color }}
                  >
                    {l.tag}
                  </span>
                ))}
              </div>
            )}
            {compactChannels.map(({ name, rows, unitLabel }, gi) => (
              <div
                key={name}
                className={`flex items-baseline gap-1.5 shrink-0 px-2.5 ${
                  gi > 0 || multiLogTrace ? "border-l border-border/60" : "pl-0"
                }`}
              >
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 max-w-[104px] truncate">
                  {name}
                </span>
                {rows.map((r) => {
                  const isHovered = hoveredChannel === r.chKey;
                  const isDimmed = hoveredChannel !== null && !isHovered;
                  const muted = r.isChHidden || r.isLogHidden;
                  return (
                    <span
                      key={r.chKey}
                      draggable
                      // The value IS the control: click toggles that series,
                      // so no checkbox chrome is needed in the strip.
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetChannelsHidden?.([r.chKey], !r.isChHidden);
                      }}
                      onMouseEnter={() => setHoveredChannel(r.chKey)}
                      onMouseLeave={() => setHoveredChannel(null)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "text/plain",
                          JSON.stringify({
                            logFileId: r.ch.logFileId,
                            channelName: r.ch.channelName,
                            sourceTraceId: trace.id,
                          }),
                        );
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCmAppearanceOpen(false);
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          logFileId: r.ch.logFileId,
                          channelName: r.ch.channelName,
                        });
                      }}
                      title={`${r.logName ? `${r.logName} · ` : ""}${name}${
                        r.isChHidden ? " (hidden)" : ""
                      } — click to ${r.isChHidden ? "show" : "hide"}, drag to move, right-click to style`}
                      data-log={r.logName}
                      className={`font-mono text-[13px] font-semibold tabular-nums text-right min-w-[4ch] cursor-pointer rounded-sm px-0.5 transition-all ${
                        muted ? "line-through decoration-1" : ""
                      } ${isDimmed ? "opacity-40" : ""} ${
                        isHovered ? "bg-foreground/15" : ""
                      }`}
                      style={{
                        // Comparing logs: colour identifies the RUN. Single
                        // log: it identifies the channel's own line.
                        color:
                          muted || r.valueStr === null
                            ? undefined
                            : multiLogTrace
                              ? r.logColor
                              : r.color,
                        opacity: muted ? 0.35 : r.opacity,
                      }}
                    >
                      {r.valueStr ?? "–"}
                    </span>
                  );
                })}
                {unitLabel && (
                  <span className="text-[9px] text-muted-foreground/60 shrink-0">{unitLabel}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground flex-1 truncate" title={traceTitle}>
            {traceTitle}
          </span>
        )}
        <Tip content={pinned ? "Unpin from all pages" : "Pin across all pages"}>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            className={`cursor-pointer ${pinned ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
              <path d="M6 1h4v5l2 2v2H9v5H7v-5H4V8l2-2V1z" />
            </svg>
          </button>
        </Tip>
        <Tip content="Highlight zones">
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <SlidersHorizontalIcon className="size-4" />
          </button>
        </Tip>
        <Tip content="Remove trace">
          <button
            onClick={onRemoveTrace}
            className="text-muted-foreground hover:text-destructive cursor-pointer"
          >
            <XIcon className="size-4" />
          </button>
        </Tip>
      </div>

      {/* Chart area with legend overlay */}
      {!collapsed && (
      <div
        ref={chartAreaRef}
        className={`relative ${fitTraces ? "flex-1 min-h-0" : ""}`}
        style={fitTraces ? undefined : { height: trace.height }}
      >
        {logGroups.length > 0 ? (
          <TraceChart
            logGroups={logGroups}
            width={chartWidth}
            height={chartHeight}
            syncKey={syncKey}
            zoomRange={zoomRange}
            globalRange={globalRange}
            sharedYRanges={sharedYRanges}
            groupYRanges={groupYRanges}
            onResolvedScaleRanges={setResolvedRanges}
            showAxes={showAxes}
            showAxisLabels={showAxisLabels}
            raceStartTimes={raceStartTimes}
            unitSystem={unitSystem}
            unitOverrides={unitOverrides}
            selection={selection}
            onSelection={onSelection}
            onClearSelection={onClearSelection}
            onDragPreview={onDragPreview}
            onCursorTime={onCursorTime}
            onZoom={onZoom}
            onResetZoom={onResetZoom}
            wheelZoomEnabled={wheelZoomEnabled}
            wheelZoomFactor={wheelZoomFactor}
            wheelMode={wheelMode}
            evaluatedZones={allZones}
            timeslipZones={timeslipZones}
            expandedZoneIds={mergedExpanded}
            onToggleZoneExpand={handleToggleZoneExpand}
            onMoveZoneLabel={(zoneId, frac) => onUpdateZone?.(zoneId, { labelYFraction: frac })}
            onChannelContextMenu={(logFileId, channelName, x, y) =>
              { setCmAppearanceOpen(false); setContextMenu({ x, y, logFileId: logFileId as Id<"files">, channelName }); }
            }
            raceLine={raceLine}
            onRaceLineContextMenu={(x, y) => setRaceMenu({ x, y })}
            isTopTrace={isTopTrace}
            previewColorKey={colorPreview?.key ?? null}
            previewColor={colorPreview?.color ?? null}
            highlightKey={hoveredChannel}
            maxYAxes={maxYAxes}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Drag channels from the sidebar to add them
          </div>
        )}

        {/* Floating channel legend — suppressed while it lives in the header */}
        {trace.channels.length > 0 && !legendInHeader && (
          <div
            ref={legendRef}
            className="absolute z-10 rounded border border-white bg-black/60 backdrop-blur-sm select-none overflow-hidden"
            style={legendPos ? { left: legendPos.x, top: legendPos.y } : { right: 8, top: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Legend header — drag handle */}
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 cursor-move border-b border-white/10"
              onMouseDown={handleLegendMouseDown}
            >
              <GripHorizontalIcon className="size-3 text-white/30" />
              <span className="text-[10px] text-white/40 flex-1">Channels</span>
              <button
                className="text-white/40 hover:text-white/70 cursor-pointer"
                onClick={() => setLegendMinimized((v) => !v)}
              >
                {legendMinimized
                  ? <ChevronRightIcon className="size-3" />
                  : <ChevronDownIcon className="size-3" />}
              </button>
            </div>

            {/* Channel rows */}
            {!legendMinimized && (
              <div className="flex flex-col gap-0.5 px-2 py-1">
                {/* Comparing runs: one row per CHANNEL with that channel's
                    value from each log side by side, rather than repeating
                    every channel name once per log. Same structure the compact
                    strip uses, so switching between them changes only where the
                    legend sits, not how it reads. Range mode keeps the per-log
                    grouping below, since MIN/AVG/MAX/delta per log won't fit. */}
                {avgRange ? (
                  // Range selected: the stat labels belong in a header row, not
                  // repeated on every line, and a channel is named once with a
                  // row per run beneath it.
                  <>
                    <div className="flex items-center gap-1.5 text-[9px] font-semibold leading-tight pb-0.5 mb-0.5 border-b border-white/10">
                      <span className="flex-1 text-white/40 uppercase tracking-wider">
                        {multiLogTrace ? "Channel / run" : "Channel"}
                      </span>
                      <span className="w-14 text-right text-white/40">MIN</span>
                      <span className="w-14 text-right text-amber-400">AVG</span>
                      <span className="w-14 text-right text-white/40">MAX</span>
                      <span className="w-14 text-right text-sky-400">Δ</span>
                      <span className="w-8 shrink-0" />
                    </div>
                    {compactChannels.map(({ name, rows, unitLabel }) => {
                      const keys = rows.map((r) => r.chKey);
                      const allHidden = rows.every((r) => r.isChHidden);
                      const someHidden = rows.some((r) => r.isChHidden);
                      const stats = (r: typeof rows[number], showTag: boolean) => (
                        <>
                          {showTag && (
                            <span
                              className="font-bold uppercase tracking-wider text-[10px] truncate max-w-[84px] pl-4 flex-1"
                              style={{ color: r.logColor }}
                            >
                              {traceLogs.find((l) => l.id === (r.ch.logFileId as string))?.tag ?? r.logName}
                            </span>
                          )}
                          <span className="font-mono font-medium text-white/70 w-14 text-right tabular-nums">{r.minStr ?? "---"}</span>
                          <span className="font-mono font-medium text-white w-14 text-right tabular-nums">{r.valueStr ?? "---"}</span>
                          <span className="font-mono font-medium text-white/70 w-14 text-right tabular-nums">{r.maxStr ?? "---"}</span>
                          <span className="font-mono font-medium text-sky-200/90 w-14 text-right tabular-nums">{r.deltaStr ?? "---"}</span>
                          <span className="text-[9px] text-white/40 min-w-8 whitespace-nowrap shrink-0">{unitLabel}</span>
                        </>
                      );
                      return (
                        <div key={name}>
                          <div className={`flex items-center gap-1.5 text-xs leading-tight ${allHidden ? "opacity-40" : ""}`}>
                            <input
                              type="checkbox"
                              checked={!allHidden}
                              ref={(el) => { if (el) el.indeterminate = someHidden && !allHidden; }}
                              onChange={() => onSetChannelsHidden?.(keys, !allHidden)}
                              className="accent-white/60 cursor-pointer shrink-0"
                              style={{ width: 10, height: 10 }}
                            />
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: rows[0]?.color, opacity: rows[0]?.opacity ?? 1 }} />
                            <span className="text-white/70 truncate max-w-[140px] flex-1">{name}</span>
                            {/* One run: its numbers sit on the name row. */}
                            {!multiLogTrace && rows[0] && stats(rows[0], false)}
                          </div>
                          {multiLogTrace &&
                            rows.map((r) => (
                              <div
                                key={r.chKey}
                                className={`flex items-center gap-1.5 text-xs leading-tight ${
                                  r.isChHidden || r.isLogHidden ? "opacity-40" : ""
                                }`}
                                onMouseEnter={() => setHoveredChannel(r.chKey)}
                                onMouseLeave={() => setHoveredChannel(null)}
                              >
                                {stats(r, true)}
                              </div>
                            ))}
                        </div>
                      );
                    })}
                  </>
                ) : multiLogTrace ? (
                  <>
                    <div className="flex items-center gap-1.5 text-[10px] leading-tight pb-0.5 mb-0.5 border-b border-white/10">
                      <span className="shrink-0" style={{ width: 10 }} />
                      <span className="w-2 shrink-0" />
                      <span className="text-white/40 truncate max-w-[140px] flex-1">Channel</span>
                      {traceLogs.map((l) => (
                        <span
                          key={l.id}
                          title={l.name}
                          className="font-bold uppercase tracking-wider w-14 text-right truncate"
                          style={{ color: l.color }}
                        >
                          {l.tag}
                        </span>
                      ))}
                      <span className="w-8 shrink-0" />
                    </div>
                    {compactChannels.map(({ name, rows, unitLabel }) => {
                      const keys = rows.map((r) => r.chKey);
                      const allHidden = rows.every((r) => r.isChHidden);
                      const someHidden = rows.some((r) => r.isChHidden);
                      const dot = rows[0]?.color;
                      return (
                        <div key={name} className="flex items-center gap-1.5 text-xs leading-tight">
                          <input
                            type="checkbox"
                            checked={!allHidden}
                            ref={(el) => { if (el) el.indeterminate = someHidden && !allHidden; }}
                            onChange={() => onSetChannelsHidden?.(keys, !allHidden)}
                            className="accent-white/60 cursor-pointer shrink-0"
                            style={{ width: 10, height: 10 }}
                          />
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: dot, opacity: rows[0]?.opacity ?? 1 }}
                          />
                          <span className={`text-white/70 truncate max-w-[140px] flex-1 ${allHidden ? "opacity-40" : ""}`}>
                            {name}
                          </span>
                          {traceLogs.map((l) => {
                            const r = rows.find((x) => (x.ch.logFileId as string) === l.id);
                            if (!r) {
                              return <span key={l.id} className="w-14 text-right text-white/20 font-mono tabular-nums">—</span>;
                            }
                            const isHovered = hoveredChannel === r.chKey;
                            const isDimmed = hoveredChannel !== null && !isHovered;
                            const muted = r.isChHidden || r.isLogHidden;
                            return (
                              <span
                                key={l.id}
                                draggable
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSetChannelsHidden?.([r.chKey], !r.isChHidden);
                                }}
                                onMouseEnter={() => setHoveredChannel(r.chKey)}
                                onMouseLeave={() => setHoveredChannel(null)}
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    "text/plain",
                                    JSON.stringify({
                                      logFileId: r.ch.logFileId,
                                      channelName: r.ch.channelName,
                                      sourceTraceId: trace.id,
                                    }),
                                  );
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setCmAppearanceOpen(false);
                                  setContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    logFileId: r.ch.logFileId,
                                    channelName: r.ch.channelName,
                                  });
                                }}
                                title={`${l.name} · ${name}${r.isChHidden ? " (hidden)" : ""} — click to ${r.isChHidden ? "show" : "hide"}, drag to move, right-click to style`}
                                className={`font-mono font-medium w-14 text-right tabular-nums cursor-pointer rounded-sm px-0.5 transition-all ${
                                  muted ? "line-through decoration-1 opacity-40" : ""
                                } ${isDimmed ? "opacity-40" : ""} ${isHovered ? "bg-white/15" : ""}`}
                                style={{ color: l.color }}
                              >
                                {r.valueStr ?? "---"}
                              </span>
                            );
                          })}
                          <span className="text-[9px] text-white/40 min-w-8 whitespace-nowrap shrink-0">{unitLabel}</span>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  (() => {
                  return legendGroups.map(({ logId, log, isLogHidden: isHidden, multiLog, allLogChKeys, allLogHidden, someLogHidden, rows }) => {
                    return (
                      <div key={logId} className={isHidden ? "opacity-30" : ""}>
                        {multiLog && log && (
                          <div className="flex items-center gap-1 text-[10px] text-white/40 truncate mt-1 first:mt-0 mb-0.5">
                            <input
                              type="checkbox"
                              checked={!allLogHidden}
                              ref={(el) => { if (el) el.indeterminate = someLogHidden && !allLogHidden; }}
                              onChange={() => {
                                onSetChannelsHidden?.(allLogChKeys, !allLogHidden);
                              }}
                              className="accent-white/60 cursor-pointer"
                            />
                            {log.fileName.replace(/\.[^.]+$/, "")}
                          </div>
                        )}
                        {rows.map(({ chKey, ch, indent, isChHidden, color, opacity, valueStr, minStr, maxStr, deltaStr, unitLabel, isAvg }) => {
                          const isHovered = hoveredChannel === chKey;
                          const isDimmed = hoveredChannel !== null && !isHovered;
                          return (
                            <div
                              key={chKey}
                              className={`flex items-center gap-1.5 text-xs leading-tight transition-opacity ${
                                isChHidden ? "opacity-30" : isDimmed ? "opacity-40" : ""
                              } ${isHovered ? "bg-white/10 -mx-1 px-1 rounded" : ""} ${indent ? "ml-3" : ""}`}
                              draggable
                              onMouseEnter={() => setHoveredChannel(chKey)}
                              onMouseLeave={() => setHoveredChannel(null)}
                              onDragStart={(e) => {
                                e.dataTransfer.setData(
                                  "text/plain",
                                  JSON.stringify({
                                    logFileId: ch.logFileId,
                                    channelName: ch.channelName,
                                    sourceTraceId: trace.id,
                                  })
                                );
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setCmAppearanceOpen(false);
                                setContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  logFileId: ch.logFileId,
                                  channelName: ch.channelName,
                                });
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!isChHidden}
                                onChange={() => {
                                  onSetChannelsHidden?.([chKey], !isChHidden);
                                }}
                                className="accent-white/60 cursor-pointer shrink-0"
                                style={{ width: 10, height: 10 }}
                              />
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, opacity }} />
                              <span className="text-white/70 truncate max-w-[140px]">
                                {ch.channelName}
                              </span>
                              {isAvg ? (
                                <>
                                  <span className="text-[9px] font-semibold text-white/40 ml-auto self-center shrink-0">
                                    MIN
                                  </span>
                                  <span className="font-mono font-medium text-white/70 w-14 text-right tabular-nums">
                                    {minStr ?? "---"}
                                  </span>
                                  <span className="text-[9px] font-semibold text-amber-400 pl-1 self-center shrink-0">
                                    AVG
                                  </span>
                                  <span className="font-mono font-medium text-white w-14 text-right tabular-nums">
                                    {valueStr ?? "---"}
                                  </span>
                                  <span className="text-[9px] font-semibold text-white/40 pl-1 self-center shrink-0">
                                    MAX
                                  </span>
                                  <span className="font-mono font-medium text-white/70 w-14 text-right tabular-nums">
                                    {maxStr ?? "---"}
                                  </span>
                                  <span className="text-[9px] font-semibold text-sky-400 pl-1 self-center shrink-0">
                                    Δ
                                  </span>
                                  <span className="font-mono font-medium text-sky-200/90 w-14 text-right tabular-nums">
                                    {deltaStr ?? "---"}
                                  </span>
                                </>
                              ) : (
                                <span className="font-mono font-medium text-white ml-auto pl-2 w-16 text-right tabular-nums">
                                  {valueStr ?? "---"}
                                </span>
                              )}
                              <span className="text-white/50 text-[10px] min-w-8 whitespace-nowrap shrink-0">
                                {unitLabel || ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                  })()
                )}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Resize handle. In fit mode it's a splitter against the trace below, so
          the last expanded trace has nothing to trade with and gets none. */}
      {!collapsed && !(fitTraces && isLastExpanded) && (
        <div
          className="h-1.5 shrink-0 cursor-ns-resize hover:bg-primary/20 transition-colors"
          onMouseDown={handleResizeMouseDown}
        />
      )}

      {/* Context menu (channel row right-click OR chart line right-click) */}
      {contextMenu && (() => {
        const cmKey = `${contextMenu.logFileId}:${contextMenu.channelName}`;
        const cmCh = trace.channels.find(
          (c) => (c.logFileId as string) === (contextMenu.logFileId as string) && c.channelName === contextMenu.channelName
        );
        const curWidth = cmCh?.width ?? 1.5;
        const curDash = cmCh?.dash;
        const item = "w-full text-left px-3 py-1.5 text-sm hover:bg-muted cursor-pointer flex items-center gap-2";
        const seg = "flex-1 h-6 rounded border flex items-center justify-center cursor-pointer";
        // Data extent of the right-clicked channel, for quick axis actions
        const cmLog = logs.find((l) => l.fileId === contextMenu.logFileId);
        const cmSession = cmLog?.parsed.sessions[cmLog.activeSessionIndex];
        const cmData = cmSession?.channels.get(contextMenu.channelName);
        let cmExtent: { min: number; max: number } | null = null;
        if (cmData) {
          let min = Infinity;
          let max = -Infinity;
          for (let i = 0; i < cmData.length; i++) {
            const v = cmData[i];
            if (v !== v) continue;
            if (v < min) min = v;
            if (v > max) max = v;
          }
          if (min <= max) cmExtent = { min, max };
        }
        const hasManualAxis = cmCh?.axisMin !== undefined || cmCh?.axisMax !== undefined;
        const cmDef = cmLog?.parsed.channelDefs.find((d) => d.name === contextMenu.channelName);
        const cmMu = cmDef?.quantitySlug ?? "";
        const cmToDisplay = (v: number) =>
          cmMu ? convertForDisplay(v, cmMu, unitSystem, unitOverrides) : v;
        const cmDisplayUnit = cmMu ? getDisplayUnit(cmMu, unitSystem, unitOverrides) : "";

        // Channel stats scoped to: range selection > zoom window > whole log
        const cmOffset = cmLog ? offsets.get(cmLog.fileId) ?? 0 : 0;
        let statScope: [number, number] = globalRange;
        let statScopeLabel = "whole log";
        if (selection && selection[0] !== selection[1]) {
          statScope = selection;
          statScopeLabel = "selection";
        } else if (zoomRange) {
          statScope = zoomRange;
          statScopeLabel = "in view";
        }
        const cmStats =
          cmLog && !cmDef?.enumValues
            ? computeRangeStats(cmLog, contextMenu.channelName, statScope, cmOffset)
            : null;
        const cmResolved = resolvedRanges.get(contextMenu.channelName);
        const cmRace = raceStartTimes[0];
        const fmtStatTime = (t: number) =>
          `${(cmRace ? t - (cmRace.time + cmRace.offset) : t).toFixed(2)}s`;
        const jumpTo = (t: number) => {
          onSelection?.(t, t);
          setContextMenu(null);
        };
        return (
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[270px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 pt-0.5 pb-1 text-[11px] text-muted-foreground truncate max-w-[250px]">
              {contextMenu.channelName}
            </div>
            {/* Channel stats — min/avg/max over selection > view > log; click min/max to jump */}
            {cmStats && (
              <div className="px-3 pb-1.5">
                <div className="flex items-center justify-between text-[9px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  <span>Stats{cmDisplayUnit ? ` (${cmDisplayUnit})` : ""}</span>
                  <span className="normal-case tracking-normal">{statScopeLabel}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-center">
                  <button
                    title="Jump cursor to min"
                    onClick={() => jumpTo(cmStats.minTime)}
                    className="rounded border border-border hover:bg-muted px-1 py-0.5 cursor-pointer"
                  >
                    <div className="text-[9px] text-muted-foreground">MIN</div>
                    <div className="font-mono text-sm font-medium">{formatValue(cmToDisplay(cmStats.min))}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">@ {fmtStatTime(cmStats.minTime)}</div>
                  </button>
                  <div className="rounded border border-transparent px-1 py-0.5">
                    <div className="text-[9px] text-amber-400">AVG</div>
                    <div className="font-mono text-sm font-medium">{formatValue(cmToDisplay(cmStats.avg))}</div>
                    <div className="text-[10px] text-transparent select-none">&nbsp;</div>
                  </div>
                  <button
                    title="Jump cursor to max"
                    onClick={() => jumpTo(cmStats.maxTime)}
                    className="rounded border border-border hover:bg-muted px-1 py-0.5 cursor-pointer"
                  >
                    <div className="text-[9px] text-muted-foreground">MAX</div>
                    <div className="font-mono text-sm font-medium">{formatValue(cmToDisplay(cmStats.max))}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">@ {fmtStatTime(cmStats.maxTime)}</div>
                  </button>
                </div>
              </div>
            )}
            <div className="border-t border-border my-1" />
            {/* Axis range — shown and edited in display units, stored raw */}
            <div className="px-3 py-1">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                <span>Axis{cmDisplayUnit ? ` (${cmDisplayUnit})` : ""}</span>
                <div className="flex items-center gap-2 normal-case tracking-normal">
                  {cmExtent && (
                    <button
                      className="text-[11px] hover:text-foreground cursor-pointer"
                      title={`Fit to data (${formatValue(cmToDisplay(cmExtent.min))} – ${formatValue(cmToDisplay(cmExtent.max))})`}
                      onClick={() => {
                        const pad = (cmExtent.max - cmExtent.min) * 0.05 || 1;
                        onSetChannelAxisRange(
                          contextMenu.logFileId,
                          contextMenu.channelName,
                          cmExtent.min - pad,
                          cmExtent.max + pad,
                        );
                      }}
                    >
                      Fit to data
                    </button>
                  )}
                  {hasManualAxis && (
                    <button
                      className="text-[11px] hover:text-foreground cursor-pointer"
                      title="Reset axis to auto"
                      onClick={() =>
                        onSetChannelAxisRange(contextMenu.logFileId, contextMenu.channelName, undefined, undefined)
                      }
                    >
                      Auto
                    </button>
                  )}
                </div>
              </div>
              <AxisInputs
                key={cmKey}
                minRaw={cmCh?.axisMin}
                maxRaw={cmCh?.axisMax}
                minPlaceholder={cmResolved ? formatValue(cmToDisplay(cmResolved[0])) : "Auto"}
                maxPlaceholder={cmResolved ? formatValue(cmToDisplay(cmResolved[1])) : "Auto"}
                toDisplay={cmToDisplay}
                fromDisplay={(v) => (cmMu ? convertFromDisplay(v, cmMu, unitSystem, unitOverrides) : v)}
                onCommit={(min, max) =>
                  onSetChannelAxisRange(contextMenu.logFileId, contextMenu.channelName, min, max)
                }
              />
            </div>
            <div className="border-t border-border my-1" />
            {/* Appearance — collapsed by default */}
            <button className={item} onClick={() => setCmAppearanceOpen((v) => !v)}>
              <span className="flex-1">Appearance</span>
              {cmAppearanceOpen ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
            </button>
            {cmAppearanceOpen && (
              <>
                {/* Quick color swatches — hover to preview live on the line, click to set.
                    Last two: pick ANY color (rainbow), and reset to default. */}
                <div className="px-3 py-1 flex flex-nowrap items-center gap-1">
                  {CHART_COLORS.map((c) => (
                    <button
                      key={c}
                      title={c}
                      onMouseEnter={() => setColorPreview({ key: cmKey, color: c })}
                      onMouseLeave={() => setColorPreview(null)}
                      onClick={() => { onSetChannelColor(contextMenu.logFileId, contextMenu.channelName, c); setColorPreview(null); }}
                      className="w-4 h-4 rounded-full border border-white/20 cursor-pointer hover:scale-110 transition-transform shrink-0"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  {/* Custom color — opens the native picker; previews live as you drag */}
                  <label
                    key={cmKey}
                    title="Custom color…"
                    className="w-4 h-4 rounded-full border border-white/40 cursor-pointer hover:scale-110 transition-transform shrink-0 relative overflow-hidden block"
                    style={{ background: "conic-gradient(from 90deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)" }}
                  >
                    <input
                      type="color"
                      defaultValue={cmCh?.color ?? "#3b82f6"}
                      onInput={(e) => setColorPreview({ key: cmKey, color: (e.target as HTMLInputElement).value })}
                      onChange={(e) => { onSetChannelColor(contextMenu.logFileId, contextMenu.channelName, (e.target as HTMLInputElement).value); setColorPreview(null); }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>
                  <button
                    title="Reset to default color"
                    onClick={() => { onSetChannelColor(contextMenu.logFileId, contextMenu.channelName, undefined); setColorPreview(null); }}
                    className="w-4 h-4 rounded-full border border-white/30 cursor-pointer text-[9px] leading-none flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
                  >
                    ↺
                  </button>
                </div>
                {/* Color by channel */}
                <div className="px-3 py-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Color by channel</div>
                  <ColorByEditor
                    key={cmKey}
                    ch={cmCh}
                    pickerLogs={cmLog ? [cmLog] : logs}
                    selfName={contextMenu.channelName}
                    onSet={(colorBy, lo, hi, lowColor, highColor) =>
                      onSetChannelColorBy(contextMenu.logFileId, contextMenu.channelName, colorBy, lo, hi, lowColor, highColor)
                    }
                  />
                </div>
                {/* Line width */}
                <div className="px-3 py-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Width</div>
                  <div className="flex gap-1">
                    {WIDTH_OPTIONS.map((w) => (
                      <button
                        key={w}
                        title={`${w}px`}
                        onClick={() => onSetChannelWidth(contextMenu.logFileId, contextMenu.channelName, w)}
                        className={`${seg} ${Math.abs(curWidth - w) < 0.01 ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                      >
                        <div className="w-5 rounded-full bg-foreground/80" style={{ height: w }} />
                      </button>
                    ))}
                  </div>
                </div>
                {/* Line style */}
                <div className="px-3 py-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Style</div>
                  <div className="flex gap-1">
                    {STYLE_OPTIONS.map((s) => {
                      const active = JSON.stringify(curDash ?? null) === JSON.stringify(s.dash ?? null);
                      return (
                        <button
                          key={s.label}
                          title={s.label}
                          onClick={() => onSetChannelDash(contextMenu.logFileId, contextMenu.channelName, s.dash)}
                          className={`${seg} ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                        >
                          <svg width="30" height="6" viewBox="0 0 30 6" className="text-foreground/80">
                            <line x1="1" y1="3" x2="29" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray={s.dash ? s.dash.join(",") : undefined} />
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Opacity */}
                <div className="px-3 py-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Opacity</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={cmCh?.opacity ?? 1}
                      onChange={(e) =>
                        onSetChannelOpacity(contextMenu.logFileId, contextMenu.channelName, parseFloat(e.target.value))
                      }
                      className="flex-1 h-1.5 accent-primary cursor-pointer"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right font-mono">
                      {Math.round((cmCh?.opacity ?? 1) * 100)}%
                    </span>
                  </div>
                </div>
              </>
            )}
            <div className="border-t border-border my-1" />
            <button
              className={`${item} text-destructive`}
              onClick={() => { onRemoveChannel(contextMenu.logFileId, contextMenu.channelName); setContextMenu(null); }}
            >
              Remove channel
            </button>
          </div>
        );
      })()}

      {/* Race-start marker line styling menu (right-click the race line) */}
      {raceMenu && (() => {
        const cur = raceLine ?? {};
        const curW = cur.width ?? 1.5;
        const curDash = cur.dash;
        const set = (u: { color?: string; width?: number; dash?: number[] }) =>
          onSetRaceLineStyle?.({ color: cur.color, width: cur.width, dash: cur.dash, ...u });
        const seg = "flex-1 h-6 rounded border flex items-center justify-center cursor-pointer";
        return (
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[270px]"
            style={{ left: raceMenu.x, top: raceMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 pt-0.5 pb-1 text-[11px] text-muted-foreground">Race line</div>
            <div className="px-3 py-1 flex flex-nowrap items-center gap-1">
              {CHART_COLORS.map((c) => (
                <button
                  key={c}
                  title={c}
                  onClick={() => set({ color: c })}
                  className="w-4 h-4 rounded-full border border-white/20 cursor-pointer hover:scale-110 transition-transform shrink-0"
                  style={{ backgroundColor: c }}
                />
              ))}
              <label
                title="Custom color…"
                className="w-4 h-4 rounded-full border border-white/40 cursor-pointer hover:scale-110 transition-transform shrink-0 relative overflow-hidden block"
                style={{ background: "conic-gradient(from 90deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)" }}
              >
                <input
                  type="color"
                  defaultValue={cur.color ?? "#ffffff"}
                  onChange={(e) => set({ color: (e.target as HTMLInputElement).value })}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
              <button
                title="Reset to default color"
                onClick={() => set({ color: undefined })}
                className="w-4 h-4 rounded-full border border-white/30 cursor-pointer text-[9px] leading-none flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
              >
                ↺
              </button>
            </div>
            <div className="px-3 py-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Width</div>
              <div className="flex gap-1">
                {WIDTH_OPTIONS.map((w) => (
                  <button
                    key={w}
                    title={`${w}px`}
                    onClick={() => set({ width: w })}
                    className={`${seg} ${Math.abs(curW - w) < 0.01 ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                  >
                    <div className="w-5 rounded-full bg-foreground/80" style={{ height: w }} />
                  </button>
                ))}
              </div>
            </div>
            <div className="px-3 py-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Style</div>
              <div className="flex gap-1">
                {RACE_STYLE_OPTIONS.map((s) => {
                  // undefined dash renders as the dashed default, so treat it as such here.
                  const effDash = curDash ?? [7, 5];
                  const active = JSON.stringify(effDash) === JSON.stringify(s.dash);
                  return (
                    <button
                      key={s.label}
                      title={s.label}
                      onClick={() => set({ dash: s.dash })}
                      className={`${seg} ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                    >
                      <svg width="30" height="6" viewBox="0 0 30 6" className="text-foreground/80">
                        <line x1="1" y1="3" x2="29" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray={s.dash.length ? s.dash.join(",") : undefined} />
                      </svg>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Highlight zones panel */}
      <TraceSettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        logs={logs}
        highlightZones={trace.highlightZones}
        onAddZone={onAddZone}
        onUpdateZone={onUpdateZone}
        onRemoveZone={onRemoveZone}
        onToggleZone={onToggleZone}
        unitSystem={unitSystem}
        unitOverrides={unitOverrides}
        evaluatedZones={evaluatedZones}
      />
    </div>
  );
}

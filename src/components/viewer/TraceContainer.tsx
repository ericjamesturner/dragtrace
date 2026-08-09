import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import type { LoadedLog, ChannelOnTrace, TraceConfig, HighlightZoneConfig } from "@/lib/viewer-types";
import { resolveChannelStyle, CHART_COLORS, MIN_TRACE_HEIGHT } from "@/lib/viewer-types";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import { TraceChart } from "./TraceChart";
import { TraceSettingsPanel, ChannelPicker } from "./TraceSettingsPanel";
import { TraceChannelsDialog } from "./TraceChannelsDialog";
import { findValueAtTime, formatValue, formatChannelValue, computeRangeStats, statusNote } from "@/lib/cursor-utils";
import { convertForDisplay, convertFromDisplay, getDisplayUnit, getDisplayPrecision, getUnitOptions, resolveUnitKey, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { useEvaluatedZones, type EvaluatedZone } from "@/hooks/useEvaluatedZones";
import { XIcon, SlidersHorizontalIcon, ChevronDownIcon, ChevronRightIcon, ChevronLeftIcon, GripVerticalIcon, TimerIcon, MoveHorizontalIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

/** Which channel's style dialog is open. Opened by clicking its row in the
 *  channels panel, or its line on the chart. */
interface ChannelStyleTarget {
  logFileId: Id<"files">;
  channelName: string;
}

/**
 * Header + borders + resize handle around a trace's chart area. Only used to
 * set the flex min-height so the *chart* can still reach MIN_TRACE_HEIGHT;
 * being a few px off just nudges where the scroll fallback kicks in.
 */
export const TRACE_CHROME_PX = 34;

/** Width of the docked channels panel once collapsed to its toggle. */
const LEGEND_COLLAPSED_W = 22;

/** Narrowest the panel can be dragged before the values stop fitting. */
const LEGEND_MIN_W = 120;

/** Wide enough for MIN/AVG/MAX/Δ columns beside the channel name. */
const LEGEND_STATS_W = 380;

/** Seconds kept either side of the run when zooming to the pass. */
const PASS_WINDOW_PAD_S = 0.5;

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
/**
 * Rows of every hue at three lightnesses, plus a hex box. This replaces
 * `<input type="color">`: the native picker opens its own OS-level window,
 * which the dialog reads as an outside interaction and closes behind it —
 * leaving the picker floating somewhere unrelated to the control.
 */
const CUSTOM_COLORS = [
  "#fca5a5", "#fdba74", "#fde047", "#86efac", "#67e8f9", "#93c5fd", "#c4b5fd", "#f9a8d4",
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  "#991b1b", "#9a3412", "#854d0e", "#166534", "#155e75", "#1e40af", "#5b21b6", "#9d174d",
  "#ffffff", "#d4d4d8", "#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#27272a", "#000000",
];

function HexInput({
  value,
  onPreview,
  onCommit,
}: {
  value: string;
  onPreview: (color: string | null) => void;
  onCommit: (color: string) => void;
}) {
  const [text, setText] = useState(value);
  const normalise = (raw: string) => {
    const hex = raw.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return `#${hex.toLowerCase().split("").map((c) => c + c).join("")}`;
    }
    return null;
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Hex</span>
      <input
        value={text}
        spellCheck={false}
        placeholder="#3b82f6"
        onChange={(e) => {
          setText(e.target.value);
          onPreview(normalise(e.target.value));
        }}
        onBlur={() => {
          const c = normalise(text);
          if (c) onCommit(c);
          else setText(value);
          onPreview(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const c = normalise(text);
          if (c) onCommit(c);
          onPreview(null);
        }}
        className="w-24 rounded border bg-background px-1.5 py-0.5 font-mono text-xs outline-none focus:border-primary"
      />
    </div>
  );
}

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
    "w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm font-mono placeholder:text-muted-foreground/60 outline-none focus:border-primary";

  // Two labelled fields rather than "box – box": empty means automatic, and
  // without a label an empty box beside a greyed number reads as broken.
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Min</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder={minPlaceholder}
          title={minRaw === undefined ? `Automatic — currently ${minPlaceholder}` : undefined}
          value={minInput}
          onChange={(e) => setMinInput(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Max</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder={maxPlaceholder}
          title={maxRaw === undefined ? `Automatic — currently ${maxPlaceholder}` : undefined}
          value={maxInput}
          onChange={(e) => setMaxInput(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className={inputCls}
        />
      </label>
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
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Color by another channel</div>
        <ChannelPicker
          logs={pickerLogs}
          selected=""
          onSelect={(name) => {
            if (name === selfName) return; // can't color by self
            onSet(name, ch?.colorByMin, ch?.colorByMax);
            setShowPicker(false);
          }}
        />
      </div>
    ) : (
      // The gradient on the button says what the feature does. A bare
      // "Color by a channel…" link says only that something will happen.
      <button
        onClick={() => setShowPicker(true)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
      >
        <span>Color by another channel</span>
        <span className="h-2.5 w-16 shrink-0 rounded-full" style={{ background: COLORBY_CSS_GRADIENT }} />
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted-foreground">Color by</span>
        <span className="truncate text-xs font-medium text-primary" title={ch.colorBy}>
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
  onReorderTrace?: (draggedTraceId: string) => void;
  onSetChannelOrder?: (channelNames: string[]) => void;
  /** Open the picker as soon as this trace appears — it was just created. */
  autoOpenChannels?: boolean;
  vehicleId: Id<"vehicles">;
  mathChannels: Doc<"mathChannels">[];
  mathVersion: number;
  onSetUnit: (quantitySlug: string, unitKey: string) => void;
  onToggleTimeslip?: () => void;
  /** Shared across every trace — the panel is one column down the page. */
  legendWidth?: number;
  legendCollapsed?: boolean;
  onSetLegendWidth?: (width: number) => void;
  onToggleLegendCollapsed?: () => void;
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
  onReorderTrace,
  onSetChannelOrder,
  autoOpenChannels,
  vehicleId,
  mathChannels,
  mathVersion,
  onSetUnit,
  onToggleTimeslip,
  legendWidth,
  legendCollapsed = false,
  onSetLegendWidth,
  onToggleLegendCollapsed,
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
  // Resolved y-range per channel, reported by the chart after auto-scaling —
  // this is what "Auto" actually is right now.
  const [resolvedRanges, setResolvedRanges] = useState<Map<string, [number, number]>>(
    () => new Map(),
  );
  const [contextMenu, setContextMenu] = useState<ChannelStyleTarget | null>(null);
  const [customColorOpen, setCustomColorOpen] = useState(false);
  const [channelsDialogOpen, setChannelsDialogOpen] = useState(false);
  /** A channel is being dragged over the Channels… button, which removes it. */
  const [dropToRemove, setDropToRemove] = useState(false);
  const channelOverrides = useQuery(api.vehicleChannelOverrides.listByVehicle, { vehicleId });
  const channelDisplayNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of channelOverrides ?? []) {
      if (o.displayName) map.set(o.channelName, o.displayName);
    }
    return map;
  }, [channelOverrides]);
  const setChannelOverride = useMutation(api.vehicleChannelOverrides.setOverride);
  const removeChannelOverride = useMutation(api.vehicleChannelOverrides.removeOverride);
  // Once per trace: reopening every time the flag happens to be true again
  // would fight anyone who closed it.
  const autoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoOpenChannels || autoOpenedRef.current === trace.id) return;
    autoOpenedRef.current = trace.id;
    setChannelsDialogOpen(true);
  }, [autoOpenChannels, trace.id]);
  // Race-start marker line right-click menu.
  const [raceMenu, setRaceMenu] = useState<{ x: number; y: number } | null>(null);
  // Live color preview while hovering a swatch in the context menu.
  const [colorPreview, setColorPreview] = useState<{ key: string; color: string } | null>(null);
  // Clear any preview whenever the menu opens, moves, or closes.
  useEffect(() => {
    setColorPreview(null);
  }, [contextMenu]);

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

  // The race-line menu is still a popover pinned to the pointer, so it closes
  // on any click or Escape. The channel style dialog is not — it dismisses
  // itself, and this listener would shut it the moment you touched a control
  // inside it.
  useEffect(() => {
    if (!raceMenu) return;
    const close = () => setRaceMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", handleKey);
    };
  }, [raceMenu]);

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
          logFileId?: Id<"files">;
          channelName?: string;
          sourceTraceId?: string;
          dragTraceId?: string;
        };
        if (parsed.dragTraceId) {
          if (parsed.dragTraceId !== trace.id) onReorderTrace?.(parsed.dragTraceId);
          return;
        }
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
    [trace.id, trace.channels, onAddChannel, onMoveChannel, onReorderTrace]
  );

  // Pointer rather than mouse events throughout: one code path covers a mouse,
  // a finger and a pencil, and capture keeps the drag alive when it wanders off
  // the handle.
  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = trace.height;
      const target = e.currentTarget;
      // Capture keeps the drag alive past the handle's own bounds.
      try { target.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

      // Fit mode: the handle is a splitter between this trace and the one
      // below, so the parent redistributes the pair's weight. Otherwise it's
      // the plain absolute-px resize.
      const handleMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const delta = ev.clientY - startY;
        if (fitTraces) onSplitterDrag?.(delta, false);
        else onResizeHeight(Math.max(MIN_TRACE_HEIGHT, startHeight + delta));
      };

      const handleUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        if (fitTraces) onSplitterDrag?.(ev.clientY - startY, true);
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        target.removeEventListener("pointercancel", handleUp);
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
      target.addEventListener("pointercancel", handleUp);
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
        // A channel with no colour of its own takes one from its position in
        // the list. Pin that colour before dropping the switched-off ones,
        // or turning one off would repaint every line under it.
        channels: (channelsByLog.get(log.fileId) ?? [])
          .map((ch, i) => (ch.color ? ch : { ...ch, color: resolveChannelStyle(ch, i, log.logIndex).color }))
          .filter((ch) => !hiddenChannels.has(`${ch.logFileId}:${ch.channelName}`)),
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

  // The panel is only as wide as it's been dragged, and the stat columns need
  // room. Below that it stays a plain value readout.
  const panelWidthSetting = legendCollapsed ? LEGEND_COLLAPSED_W : legendWidth;
  const statsFitPanel = (panelWidthSetting ?? 0) >= LEGEND_STATS_W;

  // What the stats describe: a drag-selected range if there is one, otherwise
  // whatever's on screen. Null when there's nowhere to put the numbers.
  const avgRange: [number, number] | null =
    avgOnSelection && selection && selection[0] !== selection[1]
      ? selection
      : statsFitPanel
        ? (zoomRange ?? globalRange)
        : null;
  const statsScopeLabel =
    selection && selection[0] !== selection[1] ? "selection" : zoomRange ? "in view" : "whole run";

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

        // The value under the cursor and the stats over the scope are separate
        // readings — one answers "what is it right now", the others "what did it
        // do". The panel shows both side by side when it's wide enough.
        let valueStr: string | null = null;
        let avgStr: string | null = null;
        let minStr: string | null = null;
        let maxStr: string | null = null;
        let minTime: number | null = null;
        let maxTime: number | null = null;
        let unitLabel = "";
        const def = log?.parsed.channelDefs.find((d) => d.name === ch.channelName);
        // Switching a channel off takes its line off the chart. It does not take
        // the channel off the panel — the numbers are still worth reading with
        // the line out of the way. A hidden RUN is different: everything from
        // that pass goes quiet together.
        const visible = !!log && !isLogHidden;
        if (cursorTime !== null && log && visible) {
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
        if (avgRange && log && visible && !def?.enumValues) {
          const offset = offsets.get(log.fileId) ?? 0;
          const stats = computeRangeStats(log, ch.channelName, avgRange, offset);
          if (stats !== null) {
            const mu = def?.quantitySlug ?? "";
            const conv = (v: number) =>
              mu ? convertForDisplay(v, mu, unitSystem, unitOverrides) : v;
            avgStr = formatValue(conv(stats.avg));
            minStr = formatValue(conv(stats.min));
            maxStr = formatValue(conv(stats.max));
            minTime = stats.minTime;
            maxTime = stats.maxTime;
            if (!unitLabel) unitLabel = mu ? getDisplayUnit(mu, unitSystem, unitOverrides) : "";
          }
        }

        return {
          chKey, ch, indent: multiLog, isLogHidden, isChHidden,
          logName: log ? log.fileName.replace(/\.[^.]+$/, "") : "",
          logColor: log?.logColor ?? "#3b82f6",
          logIndex: log?.logIndex ?? 0,
          color: resolved.color, opacity: resolved.opacity,
          valueStr, avgStr, minStr, maxStr, minTime, maxTime, unitLabel,
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

  // The pass itself — the launch through the finish line, taken from the
  // timeslip band, with half a second either side. The stage and the shutdown
  // are most of a log and none of the run.
  const passWindow = useMemo<[number, number] | null>(() => {
    let start = Infinity;
    let end = -Infinity;
    for (const zone of timeslipZones ?? []) {
      for (const region of zone.regions) {
        if (region.start < start) start = region.start;
        if (region.end > end) end = region.end;
      }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    // Clamped to the log: a run that ends near the end of the recording would
    // otherwise buy two seconds of blank chart.
    return [
      Math.max(globalRange[0], start - PASS_WINDOW_PAD_S),
      Math.min(globalRange[1], end + PASS_WINDOW_PAD_S),
    ];
  }, [timeslipZones, globalRange]);

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
    // Short tag for the key: racers name runs "Q1", "SEATTLE E2 7.126 176.47".
    // The first word is usually the round — but when two runs share a weekend
    // it's the same word on both, so take the first one that actually tells
    // them apart. Full name only if nothing does.
    const tokens = list.map((l) => l.name.trim().split(/\s+/).filter(Boolean));
    const depth = Math.min(4, Math.max(0, ...tokens.map((t) => t.length)));
    let tags: string[] | null = null;
    for (let i = 0; i < depth; i++) {
      const candidate = tokens.map((t) => t[i] ?? "");
      if (candidate.every(Boolean) && new Set(candidate).size === candidate.length) {
        tags = candidate;
        break;
      }
    }
    return list.map((l, i) => ({ ...l, tag: tags ? tags[i] : l.name }));
  }, [legendGroups]);

  // The channels panel is docked beside the chart rather than floating over
  // it, so the plot has to give up its width. Sized to the columns it actually
  // has to show: one value per run normally, four stats when a range is
  // selected. uPlot needs a number, so this is computed rather than measured.
  const legendPanelWidth = (() => {
    if (trace.channels.length === 0 || legendInHeader) return 0;
    if (legendCollapsed) return LEGEND_COLLAPSED_W;
    if (legendWidth !== undefined) return legendWidth;
    const columns = avgRange ? 4 : Math.max(1, traceLogs.length);
    return Math.min(440, Math.max(200, 170 + columns * 56 + 28));
  })();

  // Drag the panel's left edge. Every trace reads the same width, so the drag
  // reports live rather than on release and the whole column moves together.
  // Dragging a channel row already means "move this to another trace". Dropped
  // on a row of the same trace it means "put it here instead" — the panel's
  // order is the trace's order, so arranging it in place is the obvious move.
  const channelDragProps = (channelName: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const ch = trace.channels.find((c) => c.channelName === channelName);
      if (!ch) return;
      e.dataTransfer.setData(
        "text/plain",
        JSON.stringify({ logFileId: ch.logFileId, channelName, sourceTraceId: trace.id }),
      );
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      let parsed: { channelName?: string; sourceTraceId?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const moving = parsed.channelName;
      if (!moving || parsed.sourceTraceId !== trace.id || moving === channelName) return;
      // Handled here, so the container's drop (which adds channels) sits it out.
      e.preventDefault();
      e.stopPropagation();
      const order: string[] = [];
      for (const c of trace.channels) {
        if (!order.includes(c.channelName)) order.push(c.channelName);
      }
      const rest = order.filter((n) => n !== moving);
      const at = rest.indexOf(channelName);
      rest.splice(at < 0 ? rest.length : at, 0, moving);
      onSetChannelOrder?.(rest);
    },
  });

  const handleLegendResize = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = legendPanelWidth;
      const target = e.currentTarget;
      // Capture keeps the drag alive past the handle's own bounds.
      try { target.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        onSetLegendWidth?.(
          Math.min(600, Math.max(LEGEND_MIN_W, startW - (ev.clientX - startX))),
        );
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [legendPanelWidth, onSetLegendWidth],
  );
  const chartWidth = Math.max(100, width - 8 - legendPanelWidth);

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
        {onReorderTrace && (
          <Tip content="Drag to reorder">
            <span
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData("text/plain", JSON.stringify({ dragTraceId: trace.id }));
                e.dataTransfer.effectAllowed = "move";
              }}
              className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-foreground shrink-0"
            >
              <GripVerticalIcon className="size-4" />
            </span>
          </Tip>
        )}
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
            Empty — pick channels from the panel, or drag one in
          </span>
        ) : legendInHeader && !collapsed ? (
          // Compact legend: one scrollable line of channel chips. Same
          // interactions as the panel rows — toggle, hover-to-highlight,
          // drag to another trace.
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
                        setContextMenu({
                          logFileId: r.ch.logFileId,
                          channelName: r.ch.channelName,
                        });
                      }}
                      title={`${r.logName ? `${r.logName} · ` : ""}${name}${
                        r.isChHidden ? " (hidden)" : ""
                      } — click to ${r.isChHidden ? "show" : "hide"}, drag to move`}
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
        ) : collapsed ? (
          // Collapsed hides the channels panel, so the header has to say what
          // this trace holds. Open, the panel says it — do not say it twice.
          <span className="text-xs text-muted-foreground flex-1 truncate" title={traceTitle}>
            {traceTitle}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {/* Actions sit apart from the title and from each other — five
            small targets in a row need the room. */}
        <div className="flex shrink-0 items-center gap-3">
          {passWindow && onZoom && (
            <Tip content="Zoom to the pass — half a second either side of the run">
              <button
                onClick={(e) => { e.stopPropagation(); onZoom(passWindow[0], passWindow[1]); }}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <MoveHorizontalIcon className="size-4" />
              </button>
            </Tip>
          )}
          {onToggleTimeslip && (timeslipZones?.length ?? 0) > 0 && (
            <Tip content={trace.showTimeslip ? "Hide the timeslip band" : "Show the timeslip band"}>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleTimeslip(); }}
                className={`cursor-pointer ${trace.showTimeslip ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <TimerIcon className="size-4" />
              </button>
            </Tip>
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
          {/* Removing a trace removes it from every page, so a pinned one takes
              itself off the page that owns it as well — unpin first. */}
          <Tip content={pinned ? "Pinned to every page — unpin it to remove" : "Remove trace"}>
            <button
              onClick={onRemoveTrace}
              disabled={pinned}
              className="text-muted-foreground enabled:cursor-pointer enabled:hover:text-destructive disabled:opacity-30"
            >
              <XIcon className="size-4" />
            </button>
          </Tip>
        </div>
      </div>

      {/* Chart area, with the channels panel docked to its right */}
      {!collapsed && (
      <div
        ref={chartAreaRef}
        className={`relative flex ${fitTraces ? "flex-1 min-h-0" : ""}`}
        style={fitTraces ? undefined : { height: trace.height }}
      >
        <div className="relative min-w-0 flex-1">
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
            showTimeslipBand={trace.showTimeslip ?? false}
            expandedZoneIds={mergedExpanded}
            onToggleZoneExpand={handleToggleZoneExpand}
            onMoveZoneLabel={(zoneId, frac) => onUpdateZone?.(zoneId, { labelYFraction: frac })}
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
            Nothing plotted yet
          </div>
        )}
        </div>

        {/* Channels panel — docked to the right of the plot so it never covers
            a trace. Suppressed while the legend lives in the header. */}
        {!legendInHeader && (
          <div
            className="relative flex shrink-0 flex-col select-none overflow-hidden border-l border-border bg-black/25"
            style={{ width: legendPanelWidth }}
            onClick={(e) => e.stopPropagation()}
          >
            {!legendCollapsed && onSetLegendWidth && (
              <div
                className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                onPointerDown={handleLegendResize}
                style={{ touchAction: "none" }}
                title="Drag to resize every channels panel"
              />
            )}
            <div className="flex shrink-0 items-center gap-1 px-1.5 py-0.5 border-b border-white/10">
              {!legendCollapsed && (
                <span className="flex-1 truncate pl-1 text-[10px] text-white/40">
                  Channels{avgRange ? ` · ${statsScopeLabel}` : ""}
                </span>
              )}
              <Tip content={legendCollapsed ? "Show channels on every trace" : "Hide channels on every trace"}>
                <button
                  className="text-white/40 hover:text-white/70 cursor-pointer"
                  onClick={() => onToggleLegendCollapsed?.()}
                >
                  {legendCollapsed
                    ? <ChevronLeftIcon className="size-3" />
                    : <ChevronRightIcon className="size-3" />}
                </button>
              </Tip>
            </div>

            {/* Channel rows */}
            {!legendCollapsed && (
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1">
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
                      <span className="w-14 text-right text-white">NOW</span>
                      <span className="w-14 text-right text-white/40">MIN</span>
                      <span className="w-14 text-right text-white/40">MAX</span>
                      <span className="w-14 text-right text-amber-400">AVG</span>
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
                              className="font-bold uppercase tracking-wider text-[10px] truncate max-w-[84px] pl-6 flex-1"
                              style={{ color: r.logColor }}
                            >
                              {traceLogs.find((l) => l.id === (r.ch.logFileId as string))?.tag ?? r.logName}
                            </span>
                          )}
                          <span className="font-mono font-medium text-white w-14 text-right tabular-nums">{r.valueStr ?? "---"}</span>
                          <button
                            title={r.minTime !== null ? "Put the cursor where this run hit its minimum" : undefined}
                            disabled={r.minTime === null}
                            onClick={(e) => { e.stopPropagation(); if (r.minTime !== null) onSelection?.(r.minTime, r.minTime); }}
                            className="w-14 rounded-sm text-right font-mono font-medium tabular-nums text-white/70 enabled:cursor-pointer enabled:hover:bg-white/15"
                          >
                            {r.minStr ?? "---"}
                          </button>
                          <button
                            title={r.maxTime !== null ? "Put the cursor where this run hit its maximum" : undefined}
                            disabled={r.maxTime === null}
                            onClick={(e) => { e.stopPropagation(); if (r.maxTime !== null) onSelection?.(r.maxTime, r.maxTime); }}
                            className="w-14 rounded-sm text-right font-mono font-medium tabular-nums text-white/70 enabled:cursor-pointer enabled:hover:bg-white/15"
                          >
                            {r.maxStr ?? "---"}
                          </button>
                          <span className="font-mono font-medium text-amber-200/90 w-14 text-right tabular-nums">{r.avgStr ?? "---"}</span>
                          <span className="text-[9px] text-white/40 min-w-8 whitespace-nowrap shrink-0">{unitLabel}</span>
                        </>
                      );
                      return (
                        <div key={name} {...channelDragProps(name)}>
                          <div className="flex cursor-grab items-center gap-1.5 text-xs leading-tight active:cursor-grabbing">
                            <Switch
                              checked={!allHidden}
                              mixed={someHidden && !allHidden}
                              onChange={() => onSetChannelsHidden?.(keys, !allHidden)}
                              title={allHidden ? `Show ${name}` : `Hide ${name}`}
                              color={rows[0]?.color}
                              opacity={rows[0]?.opacity ?? 1}
                            />
                            <span className="min-w-0 flex-1 truncate text-white/70">{name}</span>
                            {/* One run: its numbers sit on the name row. */}
                            {!multiLogTrace && rows[0] && stats(rows[0], false)}
                          </div>
                          {multiLogTrace &&
                            rows.map((r) => (
                              <div
                                key={r.chKey}
                                className={`flex items-center gap-1.5 text-xs leading-tight ${
                                  r.isLogHidden ? "opacity-40" : ""
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
                    {/* Comparing runs: the channel is named once and each run
                        gets its own line under it. Side by side the values had
                        to live in narrow columns under a run tag, which read as
                        a table of tags rather than "RPM, this run vs that one". */}
                    {compactChannels.map(({ name, rows, unitLabel }) => {
                      const keys = rows.map((r) => r.chKey);
                      const allHidden = rows.every((r) => r.isChHidden);
                      const someHidden = rows.some((r) => r.isChHidden);
                      return (
                        <div key={name} className="mt-1 first:mt-0" {...channelDragProps(name)}>
                          <div className="flex cursor-grab items-center gap-1.5 text-xs leading-tight active:cursor-grabbing">
                            <Switch
                              checked={!allHidden}
                              mixed={someHidden && !allHidden}
                              onChange={() => onSetChannelsHidden?.(keys, !allHidden)}
                              title={allHidden ? `Show ${name}` : `Hide ${name}`}
                            />
                            <span className="min-w-0 flex-1 truncate text-white/70">
                              {name}
                            </span>
                            <span className="text-[9px] text-white/40 whitespace-nowrap shrink-0">{unitLabel}</span>
                          </div>
                          {traceLogs.map((l) => {
                            const r = rows.find((x) => (x.ch.logFileId as string) === l.id);
                            if (!r) {
                              return (
                                <div key={l.id} className="flex items-center gap-1.5 pl-[30px] text-xs leading-tight">
                                  <span className="w-2 shrink-0" />
                                  <span className="min-w-0 flex-1 truncate text-white/25">{l.tag}</span>
                                  <span className="font-mono text-white/20 tabular-nums">—</span>
                                </div>
                              );
                            }
                            const isHovered = hoveredChannel === r.chKey;
                            const isDimmed = hoveredChannel !== null && !isHovered;
                            const muted = r.isLogHidden;
                            return (
                              <div
                                key={l.id}
                                draggable
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setContextMenu({ logFileId: r.ch.logFileId, channelName: r.ch.channelName });
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
                                  setContextMenu({
                                    logFileId: r.ch.logFileId,
                                    channelName: r.ch.channelName,
                                  });
                                }}
                                title={`${l.name} · ${name}${r.isChHidden ? " (hidden)" : ""} — click to style, drag to move`}
                                className={`flex items-center gap-1.5 pl-[30px] text-xs leading-tight cursor-pointer rounded-sm transition-all ${
                                  isDimmed ? "opacity-40" : ""
                                } ${isHovered ? "bg-white/10" : ""}`}
                              >
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: r.color, opacity: muted ? 0.35 : r.opacity }}
                                />
                                <span
                                  className={`min-w-0 flex-1 truncate font-semibold uppercase tracking-wider text-[10px] text-white/60 ${
                                    muted ? "opacity-40" : ""
                                  }`}
                                >
                                  {l.tag}
                                </span>
                                <span
                                  className={`font-mono font-medium tabular-nums ${
                                    muted ? "line-through decoration-1 opacity-40" : ""
                                  }`}
                                  style={{ color: r.color, opacity: muted ? 0.4 : r.opacity }}
                                >
                                  {r.valueStr ?? "---"}
                                </span>
                              </div>
                            );
                          })}
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
                            <Switch
                              checked={!allLogHidden}
                              mixed={someLogHidden && !allLogHidden}
                              onChange={() => onSetChannelsHidden?.(allLogChKeys, !allLogHidden)}
                              title={allLogHidden ? "Show this run's channels" : "Hide this run's channels"}
                            />
                            {log.fileName.replace(/\.[^.]+$/, "")}
                          </div>
                        )}
                        {rows.map(({ chKey, ch, indent, isChHidden, color, opacity, valueStr, unitLabel }) => {
                          const isHovered = hoveredChannel === chKey;
                          const isDimmed = hoveredChannel !== null && !isHovered;
                          return (
                            <div
                              key={chKey}
                              className={`flex cursor-pointer items-center gap-1.5 text-xs leading-tight transition-opacity ${
                                isDimmed ? "opacity-40" : ""
                              } ${isHovered ? "bg-white/10 -mx-1 px-1 rounded" : ""} ${indent ? "ml-3" : ""}`}
                              onDragOver={channelDragProps(ch.channelName).onDragOver}
                              onDrop={channelDragProps(ch.channelName).onDrop}
                              draggable
                              title={`${ch.channelName} — click to style, drag to reorder or to another trace`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setContextMenu({ logFileId: ch.logFileId, channelName: ch.channelName });
                              }}
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
                                setContextMenu({
                                  logFileId: ch.logFileId,
                                  channelName: ch.channelName,
                                });
                              }}
                            >
                              <Switch
                                checked={!isChHidden}
                                onChange={() => onSetChannelsHidden?.([chKey], !isChHidden)}
                                title={isChHidden ? `Show ${ch.channelName}` : `Hide ${ch.channelName}`}
                                color={color}
                                opacity={opacity}
                              />
                              <span className="min-w-0 flex-1 truncate text-white/70">
                                {ch.channelName}
                              </span>
                              <span className="font-mono font-medium text-white ml-auto pl-2 w-16 text-right tabular-nums">
                                {valueStr ?? "---"}
                              </span>
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

            {/* Building a trace is a different job from reading one, so it gets
                a door of its own rather than one-channel-at-a-time from the
                sidebar. */}
            {!legendCollapsed && (
              <button
                onClick={() => setChannelsDialogOpen(true)}
                // Same button, the other direction: it is the door channels come
                // in through, so it is also the door they go out through. Drop a
                // channel on it and it leaves the trace.
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  setDropToRemove(true);
                }}
                onDragLeave={() => setDropToRemove(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  // Without this the trace's own drop handler runs next and puts
                  // the channel straight back.
                  e.stopPropagation();
                  setDropToRemove(false);
                  let parsed: { logFileId?: Id<"files">; channelName?: string; sourceTraceId?: string };
                  try {
                    parsed = JSON.parse(e.dataTransfer.getData("text/plain"));
                  } catch {
                    return; // not a channel — a trace being reordered, say
                  }
                  if (!parsed.logFileId || !parsed.channelName) return;
                  if (parsed.sourceTraceId && parsed.sourceTraceId !== trace.id) {
                    onMoveChannel(parsed.sourceTraceId, parsed.logFileId, parsed.channelName);
                  } else {
                    onRemoveChannel(parsed.logFileId, parsed.channelName);
                  }
                }}
                className={`shrink-0 cursor-pointer border-t px-2 py-1 text-xs transition-colors ${
                  dropToRemove
                    ? "border-destructive bg-destructive/30 text-white"
                    : "border-white/10 bg-black/30 text-white/50 hover:bg-white/10 hover:text-white/80"
                }`}
              >
                {dropToRemove ? "Drop to remove" : "Channels…"}
              </button>
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
          onPointerDown={handleResizePointerDown}
          style={{ touchAction: "none" }}
        />
      )}

      {/* Channel style dialog, opened from a row in the panel. */}
      {contextMenu && (() => {
        const cmKey = `${contextMenu.logFileId}:${contextMenu.channelName}`;
        const cmCh = trace.channels.find(
          (c) => (c.logFileId as string) === (contextMenu.logFileId as string) && c.channelName === contextMenu.channelName
        );
        const curWidth = cmCh?.width ?? 1.5;
        const curDash = cmCh?.dash;
        // Data extent of the channel, for quick axis actions
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

        const cmResolved = resolvedRanges.get(contextMenu.channelName);
        // What the line actually looks like right now, for the preview swatch.
        const cmRow = legendGroups.flatMap((g) => g.rows).find((r) => r.chKey === cmKey);
        const cmColor = cmRow?.color ?? cmCh?.color ?? "#3b82f6";
        const cmOpacity = cmCh?.opacity ?? 1;
        const cmHidden = hiddenChannels.has(cmKey);
        const cmRunTag = multiLogTrace
          ? traceLogs.find((l) => l.id === (contextMenu.logFileId as string))
          : null;
        // Three levels, so the eye can tell them apart: a boxed card, an
        // uppercase card title, and a plain-case field label inside it. The old
        // layout gave every one of these the same 10px uppercase grey, so
        // nothing looked more important than anything else.
        const cardCls = "rounded-lg border border-border/60 bg-muted/20 p-4";
        const cardTitle = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
        const fieldLabel = "text-xs text-muted-foreground";
        const segBtn = "flex h-8 cursor-pointer items-center justify-center rounded-md border transition-colors";
        const styleName =
          STYLE_OPTIONS.find((s) => JSON.stringify(s.dash ?? null) === JSON.stringify(curDash ?? null))?.label ??
          "Solid";
        const cmDisplayName = channelDisplayNames.get(contextMenu.channelName) ?? "";
        const cmUnitOptions = getUnitOptions(cmMu);
        const cmUnitKey = cmMu ? resolveUnitKey(cmMu, unitSystem ?? "imperial", unitOverrides) : "";
        // A channel that spent the run reporting a fault is a dead sensor, and
        // that explains a flat line better than any amount of restyling.
        const cmStatus = cmLog?.parsed.sessions[cmLog.activeSessionIndex]?.channelStatus.get(
          contextMenu.channelName,
        );
        return (
          <Dialog open onOpenChange={(o) => { if (!o) { setContextMenu(null); setCustomColorOpen(false); } }}>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-8">
                  <span className="truncate">{cmDisplayName || contextMenu.channelName}</span>
                  {cmDisplayUnit && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                      {cmDisplayUnit}
                    </span>
                  )}
                  {/* Two runs on one trace means two lines with this name — say
                      which one is being styled. */}
                  {cmRunTag && (
                    <span
                      title={cmRunTag.name}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{ backgroundColor: cmColor + "26", color: cmColor }}
                    >
                      {cmRunTag.tag}
                    </span>
                  )}
                </DialogTitle>
                {(cmDef?.description || cmDisplayName) && (
                  <p className="text-xs leading-snug text-muted-foreground">
                    {cmDisplayName && cmDisplayName !== contextMenu.channelName
                      ? `Logged as ${contextMenu.channelName}`
                      : ""}
                    {cmDisplayName && cmDisplayName !== contextMenu.channelName && cmDef?.description ? " · " : ""}
                    {cmDef?.description}
                  </p>
                )}
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* ── Line: everything about how it is drawn ──────────────── */}
                <div className={`${cardCls} space-y-4`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={cardTitle}>Line</span>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={!cmHidden}
                        color={cmColor}
                        opacity={cmOpacity}
                        onChange={() => onSetChannelsHidden?.([cmKey], !cmHidden)}
                        title={cmHidden ? "Draw this line" : "Stop drawing this line"}
                      />
                      <span className="text-xs text-muted-foreground">
                        {cmHidden ? "Hidden" : "Visible"}
                      </span>
                    </div>
                  </div>

                  {/* The line itself, drawn at the real width, dash and opacity.
                      Every control below changes this, so it goes first. */}
                  <div className="rounded-md border border-border/60 bg-background/60 px-2 py-2.5">
                    <svg className="block h-4 w-full">
                      {cmCh?.colorBy && (
                        <defs>
                          <linearGradient id="cmPreviewGrad" x1="0" y1="0" x2="1" y2="0">
                            {(cmCh.colorByLowColor && cmCh.colorByHighColor
                              ? [cmCh.colorByLowColor, cmCh.colorByHighColor]
                              : COLORBY_STOPS
                            ).map((c, i, a) => (
                              <stop key={`${c}-${i}`} offset={`${(i / (a.length - 1)) * 100}%`} stopColor={c} />
                            ))}
                          </linearGradient>
                        </defs>
                      )}
                      <line
                        x1="0"
                        y1="8"
                        x2="100%"
                        y2="8"
                        stroke={cmCh?.colorBy ? "url(#cmPreviewGrad)" : cmColor}
                        strokeOpacity={cmHidden ? 0.15 : cmOpacity}
                        strokeWidth={curWidth}
                        strokeDasharray={curDash ? curDash.join(",") : undefined}
                      />
                    </svg>
                  </div>

                  <div>
                    <div className={`${fieldLabel} mb-1.5`}>Color</div>
                    {/* Hover a swatch to see it on the chart before committing. */}
                    <div className="grid grid-cols-12 gap-1.5">
                      {CHART_COLORS.map((c) => (
                        <button
                          key={c}
                          title={c}
                          onMouseEnter={() => setColorPreview({ key: cmKey, color: c })}
                          onMouseLeave={() => setColorPreview(null)}
                          onClick={() => { onSetChannelColor(contextMenu.logFileId, contextMenu.channelName, c); setColorPreview(null); }}
                          className={`aspect-square w-full cursor-pointer rounded-full border transition-transform hover:scale-110 ${
                            cmCh?.color === c ? "border-foreground" : "border-white/20"
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <button
                        title="More colors"
                        onClick={() => setCustomColorOpen((v) => !v)}
                        className={`aspect-square w-full cursor-pointer rounded-full border transition-transform hover:scale-110 ${
                          customColorOpen ? "border-foreground" : "border-white/40"
                        }`}
                        style={{ background: "conic-gradient(from 90deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)" }}
                      />
                      <button
                        title="Back to the automatic color"
                        onClick={() => { onSetChannelColor(contextMenu.logFileId, contextMenu.channelName, undefined); setColorPreview(null); }}
                        className="flex aspect-square w-full cursor-pointer items-center justify-center rounded-full border border-white/30 text-[11px] leading-none text-muted-foreground hover:text-foreground"
                      >
                        ↺
                      </button>
                    </div>

                    {customColorOpen && (
                      <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-background/60 p-2">
                        <div className="grid grid-cols-8 gap-1.5">
                          {CUSTOM_COLORS.map((c) => (
                            <button
                              key={c}
                              title={c}
                              onMouseEnter={() => setColorPreview({ key: cmKey, color: c })}
                              onMouseLeave={() => setColorPreview(null)}
                              onClick={() => { onSetChannelColor(contextMenu.logFileId, contextMenu.channelName, c); setColorPreview(null); }}
                              className={`aspect-square w-full cursor-pointer rounded border transition-transform hover:scale-110 ${
                                cmCh?.color === c ? "border-foreground" : "border-white/10"
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <HexInput
                          key={cmKey}
                          value={cmCh?.color ?? cmColor}
                          onPreview={(c) => setColorPreview(c ? { key: cmKey, color: c } : null)}
                          onCommit={(c) => onSetChannelColor(contextMenu.logFileId, contextMenu.channelName, c)}
                        />
                      </div>
                    )}

                    {/* The other way to pick a colour, so it belongs with the
                        swatches — one flat colour, or a gradient driven by a
                        second channel. */}
                    <div className="mt-2">
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
                  </div>

                  <div>
                    <div className={`${fieldLabel} mb-1.5 flex items-baseline justify-between`}>
                      <span>Width</span>
                      <span className="font-mono text-[11px] text-muted-foreground/70">{curWidth} px</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {WIDTH_OPTIONS.map((w) => (
                        <button
                          key={w}
                          title={`${w}px`}
                          onClick={() => onSetChannelWidth(contextMenu.logFileId, contextMenu.channelName, w)}
                          className={`${segBtn} ${Math.abs(curWidth - w) < 0.01 ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                        >
                          <div className="w-7 rounded-full bg-foreground/80" style={{ height: w }} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className={`${fieldLabel} mb-1.5 flex items-baseline justify-between`}>
                      <span>Style</span>
                      <span className="text-[11px] text-muted-foreground/70">{styleName}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {STYLE_OPTIONS.map((s) => {
                        const active = JSON.stringify(curDash ?? null) === JSON.stringify(s.dash ?? null);
                        return (
                          <button
                            key={s.label}
                            title={s.label}
                            onClick={() => onSetChannelDash(contextMenu.logFileId, contextMenu.channelName, s.dash)}
                            className={`${segBtn} ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                          >
                            <svg width="44" height="6" viewBox="0 0 44 6" className="text-foreground/80">
                              <line x1="1" y1="3" x2="43" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray={s.dash ? s.dash.join(",") : undefined} />
                            </svg>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className={`${fieldLabel} mb-1.5 flex items-baseline justify-between`}>
                      <span>Opacity</span>
                      <span className="font-mono text-[11px] text-muted-foreground/70">
                        {Math.round(cmOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={cmOpacity}
                      onChange={(e) =>
                        onSetChannelOpacity(contextMenu.logFileId, contextMenu.channelName, parseFloat(e.target.value))
                      }
                      className="h-1.5 w-full cursor-pointer accent-primary"
                    />
                  </div>

                </div>

                {/* ── Scale, then identity ────────────────────────────────── */}
                <div className="space-y-4">
                  <div className={cardCls}>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <span className={cardTitle}>Axis{cmDisplayUnit ? ` (${cmDisplayUnit})` : ""}</span>
                      <span className="text-[11px] text-muted-foreground/70">
                        {hasManualAxis ? "Set by hand" : "Automatic"}
                      </span>
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
                    <div className="mt-2 flex items-center gap-2">
                      {cmExtent && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            // Same rule the automatic range uses: pad for
                            // legibility, but not past what the channel reads.
                            const pad = (cmExtent.max - cmExtent.min) * 0.05 || 1;
                            const lo = cmDef && Number.isFinite(cmDef.displayMin) && cmExtent.min >= cmDef.displayMin
                              ? Math.max(cmExtent.min - pad, cmDef.displayMin)
                              : cmExtent.min - pad;
                            const hi = cmDef && Number.isFinite(cmDef.displayMax) && cmExtent.max <= cmDef.displayMax
                              ? Math.min(cmExtent.max + pad, cmDef.displayMax)
                              : cmExtent.max + pad;
                            onSetChannelAxisRange(
                              contextMenu.logFileId,
                              contextMenu.channelName,
                              lo,
                              hi,
                            );
                          }}
                        >
                          Fit to data
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!hasManualAxis}
                        onClick={() =>
                          onSetChannelAxisRange(contextMenu.logFileId, contextMenu.channelName, undefined, undefined)
                        }
                      >
                        Back to automatic
                      </Button>
                    </div>
                    {cmExtent && (
                      <p className="mt-2 text-[11px] text-muted-foreground/80">
                        This run reads{" "}
                        <span className="font-mono text-muted-foreground">
                          {formatValue(cmToDisplay(cmExtent.min))} – {formatValue(cmToDisplay(cmExtent.max))}
                        </span>
                        . Leave a box empty to let the axis follow the data.
                      </p>
                    )}
                  </div>

                  {/* Naming and units belong to the channel, not to this trace,
                      so they change it everywhere. Say so. */}
                  <div className={cardCls}>
                    <div className={`${cardTitle} mb-2`}>Channel</div>
                    <div className="space-y-2">
                      <label className="block">
                        <span className={`${fieldLabel} mb-1 block`}>Name</span>
                        <input
                          key={cmKey}
                          defaultValue={cmDisplayName}
                          placeholder={contextMenu.channelName}
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next === cmDisplayName) return;
                            if (next && next !== contextMenu.channelName) {
                              void setChannelOverride({ vehicleId, channelName: contextMenu.channelName, displayName: next });
                            } else {
                              void removeChannelOverride({ vehicleId, channelName: contextMenu.channelName });
                            }
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      </label>
                      {cmUnitOptions.length > 1 && (
                        <label className="block">
                          <span className={`${fieldLabel} mb-1 block`}>Units</span>
                          <select
                            value={cmUnitKey}
                            onChange={(e) => onSetUnit(cmMu, e.target.value)}
                            className="h-9 w-full cursor-pointer rounded-md border bg-background px-2 text-sm"
                          >
                            {cmUnitOptions.map((a) => (
                              <option key={a.key} value={a.key}>{a.label}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <p className="text-[11px] leading-snug text-muted-foreground/80">
                        The name and the units apply to this channel on every log for this vehicle.
                      </p>
                    </div>
                    {cmStatus && (
                      <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs leading-snug text-amber-200">
                        {statusNote(cmStatus)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="-mx-4 -mb-4 flex items-center gap-2 rounded-b-xl border-t bg-muted/40 px-4 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => { onRemoveChannel(contextMenu.logFileId, contextMenu.channelName); setContextMenu(null); }}
                >
                  Remove from trace
                </Button>
                <Button size="sm" className="ml-auto" onClick={() => { setContextMenu(null); setCustomColorOpen(false); }}>
                  Done
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      <TraceChannelsDialog
        open={channelsDialogOpen}
        onOpenChange={setChannelsDialogOpen}
        logs={logs}
        traceChannels={trace.channels}
        onAdd={(names) => {
          // Added against the first log; the others mirror it.
          const source = logs[0];
          if (!source) return;
          for (const channelName of names) {
            onAddChannel({ logFileId: source.fileId, channelName });
          }
        }}
        onRemove={(names) => {
          const gone = new Set(names);
          for (const ch of trace.channels) {
            if (gone.has(ch.channelName)) onRemoveChannel(ch.logFileId, ch.channelName);
          }
        }}
        onReorder={(channelNames) => onSetChannelOrder?.(channelNames)}
        vehicleId={vehicleId}
        mathChannels={mathChannels}
        mathVersion={mathVersion}
        unitSystem={unitSystem}
        unitOverrides={unitOverrides}
      />

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

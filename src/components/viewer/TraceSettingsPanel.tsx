import { useState, useMemo, useEffect, useId } from "react";
import type { TraceConfig, LoadedLog, ChannelOnTrace, HighlightZoneConfig } from "@/lib/viewer-types";
import { resolveChannelStyle } from "@/lib/viewer-types";
import type { EvaluatedZone } from "@/hooks/useEvaluatedZones";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getDisplayUnit, convertForDisplay, convertFromDisplay, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { validateZoneExpression } from "@/lib/zone-evaluator";
import { buildHighlightZoneInput, ZONE_COLORS, type ChannelSample } from "@/lib/ai-highlight-zone";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PlusIcon, XIcon, ChevronDownIcon, ChevronRightIcon, PencilIcon, SparklesIcon, RotateCcwIcon } from "lucide-react";
import { GROUP_COLORS, type GroupNode } from "@/lib/channel-groups";
import { useChannelGroups } from "@/hooks/useChannelGroups";

const COLOR_PRESETS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#ffffff",
];

const WIDTH_OPTIONS = [1, 1.5, 2, 3];

const DASH_PATTERNS: { label: string; value: number[] | undefined }[] = [
  { label: "Solid", value: undefined },
  { label: "Dashed", value: [8, 4] },
  { label: "Dotted", value: [2, 3] },
  { label: "Dash-Dot", value: [8, 4, 2, 4] },
];

const COLORBY_STOPS = ["#0000b4", "#0064ff", "#00c8c8", "#00c850", "#b4dc00", "#ffc800", "#ff7800", "#ff0000"];
const COLORBY_CSS_GRADIENT = `linear-gradient(to right, ${COLORBY_STOPS.join(",")})`;

/** Live sample of how the channel's line currently looks. */
function LineSample({
  color,
  width,
  dash,
  opacity,
  gradient,
}: {
  color: string;
  width: number;
  dash?: number[];
  opacity: number;
  gradient?: boolean;
}) {
  const id = useId();
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" className="shrink-0">
      {gradient && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            {COLORBY_STOPS.map((c, i) => (
              <stop key={c} offset={`${(i / (COLORBY_STOPS.length - 1)) * 100}%`} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
      )}
      <line
        x1="2"
        y1="5"
        x2="26"
        y2="5"
        stroke={gradient ? `url(#${id})` : color}
        strokeWidth={Math.max(1.5, width)}
        strokeDasharray={dash?.join(",")}
        strokeLinecap="round"
        opacity={opacity}
      />
    </svg>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Channel to auto-expand when the panel opens (from a line right-click). */
  focusChannel?: { logFileId: Id<"files">; channelName: string } | null;
  trace: TraceConfig;
  logs: LoadedLog[];
  onSetChannelColor: (logFileId: Id<"files">, channelName: string, color: string | undefined) => void;
  onSetChannelOpacity: (logFileId: Id<"files">, channelName: string, opacity: number) => void;
  onSetChannelWidth: (logFileId: Id<"files">, channelName: string, width: number) => void;
  onSetChannelDash: (logFileId: Id<"files">, channelName: string, dash: number[] | undefined) => void;
  onSetChannelAxisRange: (logFileId: Id<"files">, channelName: string, axisMin?: number, axisMax?: number) => void;
  onSetChannelColorBy: (logFileId: Id<"files">, channelName: string, colorBy?: string, colorByMin?: number, colorByMax?: number) => void;
  onRemoveChannel: (logFileId: Id<"files">, channelName: string) => void;
  onAddChannel: (channel: ChannelOnTrace) => void;
  highlightZones?: HighlightZoneConfig[];
  onAddZone?: (zone: HighlightZoneConfig) => void;
  onUpdateZone?: (zoneId: string, updates: Partial<Omit<HighlightZoneConfig, "id">>) => void;
  onRemoveZone?: (zoneId: string) => void;
  onToggleZone?: (zoneId: string) => void;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  evaluatedZones?: EvaluatedZone[];
}

function dashArrayEqual(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function DashPreview({ dash, active }: { dash: number[] | undefined; active: boolean }) {
  const strokeDasharray = dash ? dash.join(" ") : undefined;
  return (
    <svg width="32" height="12" viewBox="0 0 32 12">
      <line
        x1="2" y1="6" x2="30" y2="6"
        stroke={active ? "currentColor" : "#888"}
        strokeWidth={2}
        strokeDasharray={strokeDasharray}
      />
    </svg>
  );
}

function ChannelSettings({
  ch,
  log,
  logs,
  expanded,
  onToggleExpand,
  onSetColor,
  onSetOpacity,
  onSetWidth,
  onSetDash,
  onSetAxisRange,
  onSetColorBy,
  onRemove,
  channelIndex,
  unitSystem,
  unitOverrides,
}: {
  ch: ChannelOnTrace;
  log: LoadedLog | undefined;
  logs: LoadedLog[];
  expanded: boolean;
  onToggleExpand: () => void;
  onSetColor: (color: string | undefined) => void;
  onSetOpacity: (opacity: number) => void;
  onSetWidth: (width: number) => void;
  onSetDash: (dash: number[] | undefined) => void;
  onSetAxisRange: (axisMin?: number, axisMax?: number) => void;
  onSetColorBy: (colorBy?: string, colorByMin?: number, colorByMax?: number) => void;
  onRemove: () => void;
  channelIndex: number;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
}) {
  const resolved = resolveChannelStyle(ch, channelIndex, log?.logIndex ?? 0);
  const color = resolved.color;
  const logLabel = logs.length > 1 && log ? log.fileName.replace(/\.[^.]+$/, "") : null;

  // Axis min/max are stored in raw metric units but shown and typed in the
  // user's current display units (PSI vs kPa, AFR vs lambda, …).
  const metricUnit =
    log?.parsed.channelDefs.find((d) => d.name === ch.channelName)?.metricUnit ?? "";
  const toDisplay = (v: number) =>
    metricUnit ? convertForDisplay(v, metricUnit, unitSystem, unitOverrides) : v;
  const fromDisplay = (v: number) =>
    metricUnit ? convertFromDisplay(v, metricUnit, unitSystem, unitOverrides) : v;
  const axisUnit = metricUnit ? getDisplayUnit(metricUnit, unitSystem, unitOverrides) : "";

  const fmtExtent = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 10) return v.toFixed(1);
    return v.toFixed(2);
  };

  const displayAxis = (v: number | undefined) => (v === undefined ? "" : fmtExtent(toDisplay(v)));

  const [minInput, setMinInput] = useState(() => displayAxis(ch.axisMin));
  const [maxInput, setMaxInput] = useState(() => displayAxis(ch.axisMax));

  // Re-sync the inputs when the stored range or the display units change
  useEffect(() => {
    setMinInput(displayAxis(ch.axisMin));
    setMaxInput(displayAxis(ch.axisMax));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.axisMin, ch.axisMax, metricUnit, unitSystem, unitOverrides]);

  const parseInputRaw = (input: string): number | undefined => {
    if (input.trim() === "") return undefined;
    const v = parseFloat(input);
    return isNaN(v) ? undefined : fromDisplay(v);
  };

  const commitRange = () => {
    onSetAxisRange(parseInputRaw(minInput), parseInputRaw(maxInput));
  };

  // The channel's actual data extent (raw units; converted for display) —
  // a reference for choosing the axis range.
  const dataExtent = useMemo(() => {
    const session = log?.parsed.sessions[log.activeSessionIndex];
    const data = session?.channels.get(ch.channelName);
    if (!data) return null;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v !== v) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return min <= max ? { min, max } : null;
  }, [log, ch.channelName]);

  const fitToData = () => {
    if (!dataExtent) return;
    const pad = (dataExtent.max - dataExtent.min) * 0.05 || 1;
    onSetAxisRange(dataExtent.min - pad, dataExtent.max + pad);
  };

  const resetRange = () => {
    onSetAxisRange(undefined, undefined);
  };

  // ── Color mode: solid color, or painted by another channel's value ──
  const [colorMode, setColorMode] = useState<"solid" | "by">(ch.colorBy ? "by" : "solid");
  const [showByPicker, setShowByPicker] = useState(false);
  const [cbLowInput, setCbLowInput] = useState(ch.colorByMin?.toString() ?? "");
  const [cbHighInput, setCbHighInput] = useState(ch.colorByMax?.toString() ?? "");

  useEffect(() => {
    if (ch.colorBy) setColorMode("by");
  }, [ch.colorBy]);

  const commitColorByRange = () => {
    const low = cbLowInput.trim() === "" ? undefined : parseFloat(cbLowInput);
    const high = cbHighInput.trim() === "" ? undefined : parseFloat(cbHighInput);
    onSetColorBy(
      ch.colorBy,
      low !== undefined && !isNaN(low) ? low : undefined,
      high !== undefined && !isNaN(high) ? high : undefined,
    );
  };

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={onToggleExpand}
        title={ch.channelName}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer"
      >
        {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        <LineSample
          color={color}
          width={ch.width ?? 1.5}
          dash={ch.dash}
          opacity={ch.opacity ?? 1}
          gradient={!!ch.colorBy}
        />
        <span className="flex-1 text-left truncate font-medium">
          {ch.channelName}
          {logLabel && <span className="text-muted-foreground font-normal ml-1">({logLabel})</span>}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-4 border-t border-border pt-3">
          {/* Color — solid, or painted by another channel's value */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Color</div>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  onClick={() => {
                    setColorMode("solid");
                    setShowByPicker(false);
                    if (ch.colorBy) {
                      onSetColorBy(undefined, undefined, undefined);
                      setCbLowInput("");
                      setCbHighInput("");
                    }
                  }}
                  className={`px-2 py-0.5 text-[11px] cursor-pointer ${
                    colorMode === "solid"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Solid
                </button>
                <button
                  onClick={() => setColorMode("by")}
                  className={`px-2 py-0.5 text-[11px] cursor-pointer border-l border-border ${
                    colorMode === "by"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  By channel
                </button>
              </div>
            </div>
            {colorMode === "solid" ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    // Reset to auto (channel-based color)
                    onSetColor(undefined);
                  }}
                  className={`px-2 py-0.5 text-xs rounded border cursor-pointer shrink-0 ${
                    !ch.color
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Auto
                </button>
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => onSetColor(c)}
                    className={`w-[18px] h-[18px] rounded-full border-2 cursor-pointer shrink-0 ${
                      ch.color === c ? "border-primary" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
                <label className="relative cursor-pointer">
                  <div className="w-[18px] h-[18px] rounded-full border-2 border-border bg-gradient-to-br from-red-500 via-green-500 to-blue-500 shrink-0" title="Custom color" />
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => onSetColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-[18px] h-[18px]"
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-2">
                {ch.colorBy ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-primary font-medium truncate" title={ch.colorBy}>
                        {ch.colorBy}
                      </span>
                      <button
                        onClick={() => setShowByPicker((v) => !v)}
                        className="ml-auto text-[11px] text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                      >
                        {showByPicker ? "Hide picker" : "Change…"}
                      </button>
                    </div>
                    {showByPicker && (
                      <ChannelPicker
                        logs={log ? [log] : logs}
                        selected={ch.colorBy}
                        onSelect={(name) => {
                          if (name === ch.channelName) return; // can't color by self
                          onSetColorBy(name, ch.colorByMin, ch.colorByMax);
                          setShowByPicker(false);
                        }}
                      />
                    )}
                    <div className="h-3 rounded" style={{ background: COLORBY_CSS_GRADIENT }} />
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground">Low (blue)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="auto"
                          value={cbLowInput}
                          onChange={(e) => setCbLowInput(e.target.value)}
                          onBlur={commitColorByRange}
                          onKeyDown={(e) => { if (e.key === "Enter") commitColorByRange(); }}
                          className="w-full px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground">High (red)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="auto"
                          value={cbHighInput}
                          onChange={(e) => setCbHighInput(e.target.value)}
                          onBlur={commitColorByRange}
                          onKeyDown={(e) => { if (e.key === "Enter") commitColorByRange(); }}
                          className="w-full px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <ChannelPicker
                    logs={log ? [log] : logs}
                    selected=""
                    onSelect={(name) => {
                      if (name === ch.channelName) return; // can't color by self
                      onSetColorBy(name, ch.colorByMin, ch.colorByMax);
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Line — width, style, opacity */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Line</div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground w-12">Width</span>
                {WIDTH_OPTIONS.map((w) => (
                  <button
                    key={w}
                    onClick={() => onSetWidth(w)}
                    className={`flex items-center justify-center w-8 h-6 rounded border cursor-pointer ${
                      (ch.width ?? 1.5) === w
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted"
                    }`}
                    title={`${w}px`}
                  >
                    <svg width="20" height="6" viewBox="0 0 20 6">
                      <line x1="2" y1="3" x2="18" y2="3" stroke="currentColor" strokeWidth={w} />
                    </svg>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground w-12">Style</span>
                {DASH_PATTERNS.map((dp) => (
                  <button
                    key={dp.label}
                    onClick={() => onSetDash(dp.value)}
                    className={`flex items-center justify-center h-6 px-1 rounded border cursor-pointer ${
                      dashArrayEqual(ch.dash, dp.value)
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted"
                    }`}
                    title={dp.label}
                  >
                    <DashPreview dash={dp.value} active={dashArrayEqual(ch.dash, dp.value)} />
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12">Opacity</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={ch.opacity ?? 1}
                  onChange={(e) => onSetOpacity(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 accent-primary cursor-pointer"
                />
                <span className="text-xs text-muted-foreground w-8 text-right font-mono">
                  {Math.round((ch.opacity ?? 1) * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* Y Axis */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Y Axis
                {axisUnit && (
                  <span className="normal-case tracking-normal font-normal"> ({axisUnit})</span>
                )}
              </div>
              {(ch.axisMin !== undefined || ch.axisMax !== undefined) && (
                <button
                  onClick={resetRange}
                  className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Reset to auto
                </button>
              )}
            </div>
            {dataExtent && (
              <div className="flex items-center gap-2 mb-1.5 text-[11px] text-muted-foreground">
                <span>
                  data{" "}
                  <button
                    className="font-mono text-foreground/70 hover:text-foreground underline decoration-dotted cursor-pointer"
                    title="Use as Min"
                    onClick={() => onSetAxisRange(dataExtent.min, parseInputRaw(maxInput))}
                  >
                    {fmtExtent(toDisplay(dataExtent.min))}
                  </button>
                  {" – "}
                  <button
                    className="font-mono text-foreground/70 hover:text-foreground underline decoration-dotted cursor-pointer"
                    title="Use as Max"
                    onClick={() => onSetAxisRange(parseInputRaw(minInput), dataExtent.max)}
                  >
                    {fmtExtent(toDisplay(dataExtent.max))}
                  </button>
                </span>
                <button
                  onClick={fitToData}
                  className="ml-auto px-1.5 py-0.5 rounded border border-border hover:bg-muted cursor-pointer"
                  title="Set Min/Max to the data extent with 5% padding"
                >
                  Fit to data
                </button>
              </div>
            )}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Min</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Auto"
                    value={minInput}
                    onChange={(e) => setMinInput(e.target.value)}
                    onBlur={commitRange}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRange(); }}
                    className="w-full px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Max</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Auto"
                    value={maxInput}
                    onChange={(e) => setMaxInput(e.target.value)}
                    onBlur={commitRange}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRange(); }}
                    className="w-full px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                  />
                </div>
              </div>
          </div>

          {/* Remove */}
          <div className="pt-2 border-t border-border">
            <button
              onClick={onRemove}
              className="flex items-center gap-1.5 text-sm text-destructive hover:text-destructive/80 cursor-pointer"
            >
              <XIcon className="size-3.5" />
              Remove channel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const OPERATORS = [">", "<", ">=", "<=", "==", "!="] as const;

/** Count channels in a group node including subgroups. */
function countGroupChannels(node: GroupNode): number {
  return node.channels.length + node.children.reduce((sum, c) => sum + c.channels.length, 0);
}

/** Searchable, grouped channel picker — matches sidebar UX. */
function ChannelPicker({
  logs,
  selected,
  onSelect,
}: {
  logs: LoadedLog[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isSearching = search.length > 0;
  const lower = search.toLowerCase();

  // Deduplicate channel defs across logs
  const allDefs = useMemo(() => {
    const seen = new Set<string>();
    const defs: import("@/lib/log-types").ChannelDef[] = [];
    for (const log of logs) {
      for (const def of log.parsed.channelDefs) {
        if (!seen.has(def.name)) {
          seen.add(def.name);
          defs.push(def);
        }
      }
    }
    return defs;
  }, [logs]);

  const { tree } = useChannelGroups(allDefs, "haltech");

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderChannelList = (channels: import("@/lib/channel-groups").GroupChannel[]) => {
    const filtered = isSearching
      ? channels.filter((ch) =>
          ch.def.name.toLowerCase().includes(lower) ||
          ch.displayName.toLowerCase().includes(lower) ||
          ch.aliases?.some((a) => a.toLowerCase().includes(lower))
        )
      : channels;
    if (filtered.length === 0) return null;
    return filtered.map((ch) => (
      <button
        key={ch.def.name}
        onClick={() => onSelect(ch.def.name)}
        title={ch.def.name}
        className={`w-full text-left px-2 py-1 text-sm rounded cursor-pointer truncate ${
          selected === ch.def.name
            ? "bg-primary/10 text-primary"
            : "hover:bg-muted"
        }`}
      >
        {ch.def.name}
      </button>
    ));
  };

  const matchesCh = (ch: import("@/lib/channel-groups").GroupChannel) =>
    ch.def.name.toLowerCase().includes(lower) ||
    ch.displayName.toLowerCase().includes(lower) ||
    ch.aliases?.some((a) => a.toLowerCase().includes(lower));

  const hasMatchInGroup = (node: GroupNode): boolean => {
    if (!isSearching) return true;
    if (node.channels.some(matchesCh)) return true;
    return node.children.some((c) => c.channels.some(matchesCh));
  };

  return (
    <div className="space-y-1">
      <input
        type="text"
        placeholder="Search channels..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
      />
      {selected && (
        <div className="text-xs text-primary font-medium px-1">
          Selected: {selected}
        </div>
      )}
      <div className="max-h-[250px] overflow-y-auto space-y-0.5">
        {tree.map((group) => {
          if (!hasMatchInGroup(group)) return null;
          const groupKey = group.tag;
          const isOpen = isSearching || expanded.has(groupKey);
          const count = countGroupChannels(group);
          const groupColor = GROUP_COLORS[group.tag] ?? "#6b7280";

          return (
            <div key={groupKey}>
              <button
                onClick={() => toggleGroup(groupKey)}
                className="flex items-center gap-1.5 w-full px-1 py-1 text-xs font-semibold hover:bg-muted/50 rounded cursor-pointer"
              >
                {isOpen
                  ? <ChevronDownIcon className="size-3" />
                  : <ChevronRightIcon className="size-3" />}
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: groupColor }} />
                <span className="flex-1 text-left">{group.tag}</span>
                <span className="text-muted-foreground font-normal">{count}</span>
              </button>
              {isOpen && (
                <div className="ml-4">
                  {renderChannelList(group.channels)}
                  {group.children.map((child) => {
                    const childChannels = isSearching
                      ? child.channels.filter((ch) => ch.def.name.toLowerCase().includes(lower))
                      : child.channels;
                    if (childChannels.length === 0) return null;
                    return (
                      <div key={child.tag} className="mt-0.5">
                        <div className="text-xs text-muted-foreground font-medium px-2 py-0.5">{child.tag}</div>
                        {renderChannelList(child.channels)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ZoneBuilder({
  onSubmit,
  editingZone,
  onCancelEdit,
  logs,
  unitSystem,
  unitOverrides,
}: {
  onSubmit: (expression: string, label: string, color: string) => void;
  editingZone?: HighlightZoneConfig | null;
  onCancelEdit?: () => void;
  logs: LoadedLog[];
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
}) {
  const channelNames = useMemo(() => {
    const names = logs.flatMap((l) => l.parsed.channelDefs.map((d) => d.name));
    return [...new Set(names)];
  }, [logs]);

  const [mode, setMode] = useState<"builder" | "raw">("builder");
  const [channel, setChannel] = useState(editingZone ? "" : "");
  const [operator, setOperator] = useState<string>(">");
  const [value, setValue] = useState("");
  const [useDerivative, setUseDerivative] = useState(false);
  const [rawExpression, setRawExpression] = useState(editingZone?.expression ?? "");
  const [label, setLabel] = useState(editingZone?.label ?? "");
  const [color, setColor] = useState(editingZone?.color ?? ZONE_COLORS[0]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // AI generation (Anthropic call runs server-side in the highlightZones action)
  const generateZone = useAction(api.highlightZones.generate);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const expressionFromBuilder = (): string => {
    if (!channel || !value.trim()) return "";
    const ref = useDerivative ? `derivative({${channel}})` : `{${channel}}`;
    return `${ref} ${operator} ${value.trim()}`;
  };

  const currentExpression = mode === "raw" ? rawExpression : expressionFromBuilder();

  const handleValidate = (expr: string) => {
    if (!expr.trim()) {
      setValidationError(null);
      return;
    }
    const err = validateZoneExpression(expr, channelNames);
    setValidationError(err);
  };

  const handleSubmit = () => {
    const expr = currentExpression;
    if (!expr.trim() || !label.trim()) return;
    const err = validateZoneExpression(expr, channelNames);
    if (err) {
      setValidationError(err);
      return;
    }
    onSubmit(expr, label.trim(), color);
    // Reset form
    setChannel("");
    setOperator(">");
    setValue("");
    setUseDerivative(false);
    setRawExpression("");
    setLabel("");
    setColor(ZONE_COLORS[0]);
    setValidationError(null);
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const samples: ChannelSample[] = [];
      if (logs.length > 0) {
        const log = logs[0];
        const session = log.parsed.sessions[log.activeSessionIndex];
        if (session) {
          for (const def of log.parsed.channelDefs) {
            const data = session.channels.get(def.name);
            if (data) {
              samples.push({
                name: def.name,
                data,
                timestamps: session.timestamps,
                metricUnit: def.metricUnit ?? "",
              });
            }
          }
        }
      }
      const result = await generateZone(
        buildHighlightZoneInput(
          aiPrompt,
          channelNames,
          unitSystem,
          unitOverrides,
          samples,
        ),
      );
      setRawExpression(result.expression);
      setLabel(result.label);
      setColor(result.color);
      setMode("raw");
      handleValidate(result.expression);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMode("builder")}
          className={`px-2 py-0.5 text-xs rounded cursor-pointer ${mode === "builder" ? "bg-primary/10 text-primary border border-primary" : "border border-border text-muted-foreground hover:bg-muted"}`}
        >
          Builder
        </button>
        <button
          onClick={() => {
            if (mode === "builder" && currentExpression) {
              setRawExpression(currentExpression);
            }
            setMode("raw");
          }}
          className={`px-2 py-0.5 text-xs rounded cursor-pointer ${mode === "raw" ? "bg-primary/10 text-primary border border-primary" : "border border-border text-muted-foreground hover:bg-muted"}`}
        >
          Raw Expression
        </button>
      </div>

      {mode === "builder" ? (
        <div className="space-y-2">
          {/* Rate of change toggle */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={useDerivative}
              onChange={(e) => setUseDerivative(e.target.checked)}
              className="accent-primary"
            />
            Rate of change
          </label>

          {/* Grouped channel picker */}
          <ChannelPicker
            logs={logs}
            selected={channel}
            onSelect={setChannel}
          />

          {/* Operator + value */}
          <div className="flex items-center gap-2">
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              className="px-2 py-1 rounded bg-muted border border-border text-sm outline-none focus:border-primary w-16"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
            />
          </div>

          {currentExpression && (
            <div className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded">
              {currentExpression}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={rawExpression}
            onChange={(e) => {
              setRawExpression(e.target.value);
              handleValidate(e.target.value);
            }}
            placeholder='{TPS} > 50 && {RPM} > 3000'
            rows={2}
            className="w-full px-2 py-1 rounded bg-muted border border-border text-sm font-mono placeholder:text-muted-foreground outline-none focus:border-primary resize-none"
          />
          {validationError && (
            <div className="text-xs text-destructive">{validationError}</div>
          )}
        </div>
      )}

      {/* Label + color */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="flex-1 px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
        />
      </div>
      <div className="flex items-center gap-1">
        {ZONE_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-[18px] h-[18px] rounded-full border-2 cursor-pointer shrink-0 ${color === c ? "border-primary" : "border-transparent"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {/* Submit */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!currentExpression.trim() || !label.trim() || !!validationError}
          className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {editingZone ? "Update Zone" : "Add Zone"}
        </button>
        {editingZone && onCancelEdit && (
          <button
            onClick={onCancelEdit}
            className="px-3 py-1 text-sm border border-border rounded hover:bg-muted cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>

      {/* AI generation */}
      <div className="border-t border-border pt-3 mt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            AI Zone Generator
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Describe what to highlight..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !aiLoading) handleAiGenerate(); }}
              className="flex-1 px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
            />
            <button
              onClick={handleAiGenerate}
              disabled={aiLoading || !aiPrompt.trim()}
              className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
            >
              {aiLoading ? "..." : "Generate"}
            </button>
          </div>
          {aiError && <div className="text-xs text-destructive">{aiError}</div>}
        </div>
    </div>
  );
}

export function TraceSettingsPanel({
  open,
  onOpenChange,
  focusChannel,
  trace,
  logs,
  onSetChannelColor,
  onSetChannelOpacity,
  onSetChannelWidth,
  onSetChannelDash,
  onSetChannelAxisRange,
  onSetChannelColorBy,
  onRemoveChannel,
  onAddChannel,
  highlightZones,
  onAddZone,
  onUpdateZone,
  onRemoveZone,
  onToggleZone,
  unitSystem,
  unitOverrides,
  evaluatedZones,
}: Props) {
  const [tab, setTab] = useState<"channels" | "zones">("channels");
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(() => {
    const first = trace.channels[0];
    return first ? new Set([`${first.logFileId}:${first.channelName}`]) : new Set();
  });
  const [addChannelSearch, setAddChannelSearch] = useState("");
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showZoneBuilder, setShowZoneBuilder] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);

  // Accordion: only one channel editor open at a time
  const toggleExpand = (key: string) => {
    setExpandedChannels((prev) => (prev.has(key) ? new Set() : new Set([key])));
  };

  // Opened via a line right-click: show only the clicked channel expanded
  useEffect(() => {
    if (open && focusChannel) {
      setTab("channels");
      setExpandedChannels(new Set([`${focusChannel.logFileId}:${focusChannel.channelName}`]));
    }
  }, [open, focusChannel]);

  const addableChannels = useMemo(() => {
    const existingSet = new Set(
      trace.channels.map((c) => `${c.logFileId}:${c.channelName}`)
    );
    const lower = addChannelSearch.toLowerCase();

    return logs.map((log) => {
      const session = log.parsed.sessions[log.activeSessionIndex];
      if (!session) return { log, channels: [] };
      const channels = log.parsed.channelDefs
        .filter((d) => {
          if (existingSet.has(`${log.fileId}:${d.name}`)) return false;
          if (lower && !d.name.toLowerCase().includes(lower)) return false;
          return true;
        })
        .map((d) => d.name);
      return { log, channels };
    }).filter((g) => g.channels.length > 0);
  }, [logs, trace.channels, addChannelSearch]);

  const zoneCount = (highlightZones ?? []).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle>Trace Settings</SheetTitle>
          <SheetDescription>Configure channels and highlight zones</SheetDescription>
        </SheetHeader>

        {/* Tab bar */}
        <div className="flex items-center border-b border-border mx-4 mb-3">
          <button
            onClick={() => setTab("channels")}
            className={`px-3 py-2 text-sm border-b-2 cursor-pointer transition-colors ${
              tab === "channels"
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Channels
          </button>
          {onAddZone && (
            <button
              onClick={() => setTab("zones")}
              className={`px-3 py-2 text-sm border-b-2 cursor-pointer transition-colors flex items-center gap-1.5 ${
                tab === "zones"
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Highlight Zones
              {zoneCount > 0 && (
                <span className="text-xs opacity-60">({zoneCount})</span>
              )}
            </button>
          )}
        </div>

        <div className="px-4 pb-4">
          {/* ===== Channels tab ===== */}
          {tab === "channels" && (
            <div className="space-y-2">
              {(() => {
                // Compute per-log channel index for each channel
                const perLogIdx = new Map<string, number>();
                const logCounters = new Map<string, number>();
                for (const c of trace.channels) {
                  const lid = c.logFileId as string;
                  const idx = logCounters.get(lid) ?? 0;
                  perLogIdx.set(`${lid}:${c.channelName}`, idx);
                  logCounters.set(lid, idx + 1);
                }
                return trace.channels.map((ch) => {
                const key = `${ch.logFileId}:${ch.channelName}`;
                const log = logs.find((l) => l.fileId === ch.logFileId);
                return (
                  <ChannelSettings
                    key={key}
                    ch={ch}
                    log={log}
                    logs={logs}
                    expanded={expandedChannels.has(key)}
                    onToggleExpand={() => toggleExpand(key)}
                    onSetColor={(color) => onSetChannelColor(ch.logFileId, ch.channelName, color)}
                    onSetOpacity={(opacity) => onSetChannelOpacity(ch.logFileId, ch.channelName, opacity)}
                    onSetWidth={(width) => onSetChannelWidth(ch.logFileId, ch.channelName, width)}
                    onSetDash={(dash) => onSetChannelDash(ch.logFileId, ch.channelName, dash)}
                    onSetAxisRange={(axisMin, axisMax) => onSetChannelAxisRange(ch.logFileId, ch.channelName, axisMin, axisMax)}
                    onSetColorBy={(colorBy, colorByMin, colorByMax) => onSetChannelColorBy(ch.logFileId, ch.channelName, colorBy, colorByMin, colorByMax)}
                    onRemove={() => onRemoveChannel(ch.logFileId, ch.channelName)}
                    channelIndex={perLogIdx.get(key)!}
                    unitSystem={unitSystem}
                    unitOverrides={unitOverrides}
                  />
                );
              });
              })()}

              {trace.channels.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No channels on this trace</p>
              )}

              {/* Add Channel */}
              <div className="border-t border-border pt-3 mt-3">
                <button
                  onClick={() => setShowAddChannel(!showAddChannel)}
                  className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 cursor-pointer"
                >
                  <PlusIcon className="size-3.5" />
                  Add Channel
                </button>

                {showAddChannel && (
                  <div className="mt-2 space-y-2">
                    <input
                      type="text"
                      placeholder="Search channels..."
                      value={addChannelSearch}
                      onChange={(e) => setAddChannelSearch(e.target.value)}
                      className="w-full px-3 py-1.5 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
                    />
                    <div className="max-h-[300px] overflow-y-auto space-y-2">
                      {addableChannels.map(({ log, channels }) => (
                        <div key={log.fileId}>
                          {logs.length > 1 && (
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground px-1 py-1">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: log.logColor }} />
                              {log.fileName.replace(/\.[^.]+$/, "")}
                            </div>
                          )}
                          {channels.map((name) => (
                            <button
                              key={`${log.fileId}:${name}`}
                              onClick={() => {
                                onAddChannel({ logFileId: log.fileId, channelName: name });
                              }}
                              className="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted cursor-pointer truncate"
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      ))}
                      {addableChannels.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          {addChannelSearch ? "No matching channels" : "All channels already added"}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== Highlight Zones tab ===== */}
          {tab === "zones" && onAddZone && (
            <div className="space-y-2">
              {/* Zone list */}
              {(highlightZones ?? []).map((zone) => {
                const evaluated = evaluatedZones?.find((ez) => ez.config.id === zone.id);
                const isEditing = editingZoneId === zone.id;

                if (isEditing) {
                  return (
                    <div key={zone.id} className="border border-border rounded-md p-2 mb-2">
                      <ZoneBuilder
                        editingZone={zone}
                        onSubmit={(expression, label, color) => {
                          onUpdateZone?.(zone.id, { expression, label, color });
                          setEditingZoneId(null);
                        }}
                        onCancelEdit={() => setEditingZoneId(null)}
                        logs={logs}
                        unitSystem={unitSystem}
                        unitOverrides={unitOverrides}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={zone.id}
                    className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted/50 group"
                  >
                    <button
                      onClick={() => onToggleZone?.(zone.id)}
                      className="cursor-pointer"
                    >
                      <span
                        className={`w-3 h-3 rounded-sm block border ${zone.enabled ? "" : "opacity-30"}`}
                        style={{
                          backgroundColor: zone.enabled ? zone.color : "transparent",
                          borderColor: zone.color,
                        }}
                      />
                    </button>
                    <span className={`flex-1 text-sm truncate ${zone.enabled ? "" : "opacity-50"}`}>
                      {zone.label}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]" title={zone.expression}>
                      {zone.expression}
                    </span>
                    {evaluated?.error && (
                      <span className="text-xs text-destructive" title={evaluated.error}>err</span>
                    )}
                    {zone.labelYFraction != null && (
                      <button
                        onClick={() => onUpdateZone?.(zone.id, { labelYFraction: undefined })}
                        title="Reset dragged label position"
                        className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 cursor-pointer"
                      >
                        <RotateCcwIcon className="size-3" />
                      </button>
                    )}
                    <button
                      onClick={() => setEditingZoneId(zone.id)}
                      className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 cursor-pointer"
                    >
                      <PencilIcon className="size-3" />
                    </button>
                    <button
                      onClick={() => onRemoveZone?.(zone.id)}
                      className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 cursor-pointer"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                );
              })}

              {(highlightZones ?? []).length === 0 && !showZoneBuilder && (
                <p className="text-sm text-muted-foreground py-4 text-center">No highlight zones yet</p>
              )}

              {/* Add zone builder */}
              {showZoneBuilder ? (
                <div className="border border-border rounded-md p-2 mt-2">
                  <ZoneBuilder
                    onSubmit={(expression, label, color) => {
                      onAddZone?.({
                        id: crypto.randomUUID(),
                        expression,
                        label,
                        color,
                        enabled: true,
                      });
                      setShowZoneBuilder(false);
                    }}
                    logs={logs}
                    unitSystem={unitSystem}
                    unitOverrides={unitOverrides}
                  />
                  <button
                    onClick={() => setShowZoneBuilder(false)}
                    className="mt-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowZoneBuilder(true)}
                  className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 cursor-pointer mt-1"
                >
                  <PlusIcon className="size-3.5" />
                  Add Zone
                </button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

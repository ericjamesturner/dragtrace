import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import type { LoadedLog, ChannelOnTrace, TraceConfig, HighlightZoneConfig } from "@/lib/viewer-types";
import { resolveChannelStyle, CHART_COLORS } from "@/lib/viewer-types";
import type { Id } from "../../../convex/_generated/dataModel";
import { TraceChart } from "./TraceChart";
import { TraceSettingsPanel } from "./TraceSettingsPanel";
import { findValueAtTime, formatValue, computeRangeStats } from "@/lib/cursor-utils";
import { convertForDisplay, getDisplayUnit, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { useEvaluatedZones, type EvaluatedZone } from "@/hooks/useEvaluatedZones";
import { XIcon, SlidersHorizontalIcon, ChevronDownIcon, ChevronRightIcon, GripHorizontalIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

interface ContextMenuState {
  x: number;
  y: number;
  logFileId: Id<"files">;
  channelName: string;
}

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
  avgOnSelection?: boolean;
  onRemoveTrace: () => void;
  onRemoveChannel: (logFileId: Id<"files">, channelName: string) => void;
  onAddChannel: (channel: ChannelOnTrace) => void;
  onMoveChannel: (sourceTraceId: string, logFileId: Id<"files">, channelName: string) => void;
  onResizeHeight: (height: number) => void;
  showAxes: boolean;
  showAxisLabels: boolean;
  onSetChannelColor: (logFileId: Id<"files">, channelName: string, color: string | undefined) => void;
  onSetChannelOpacity: (logFileId: Id<"files">, channelName: string, opacity: number) => void;
  onSetChannelWidth: (logFileId: Id<"files">, channelName: string, width: number) => void;
  onSetChannelDash: (logFileId: Id<"files">, channelName: string, dash: number[] | undefined) => void;
  onSetChannelAxisRange: (logFileId: Id<"files">, channelName: string, axisMin?: number, axisMax?: number) => void;
  onSetChannelColorBy: (logFileId: Id<"files">, channelName: string, colorBy?: string, colorByMin?: number, colorByMax?: number) => void;
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
  avgOnSelection = true,
  onRemoveTrace,
  onRemoveChannel,
  onAddChannel,
  onMoveChannel,
  onResizeHeight,
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
  expandedTimeslipIds,
  onToggleTimeslipExpand,
  raceLine,
  onSetRaceLineStyle,
  isTopTrace,
  maxYAxes,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Channel to auto-expand when the settings panel opens via right-click
  const [settingsFocus, setSettingsFocus] = useState<{
    logFileId: Id<"files">;
    channelName: string;
  } | null>(null);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Race-start marker line right-click menu.
  const [raceMenu, setRaceMenu] = useState<{ x: number; y: number } | null>(null);
  // Live color preview while hovering a swatch in the context menu.
  const [colorPreview, setColorPreview] = useState<{ key: string; color: string } | null>(null);
  // Clear any preview whenever the menu opens, moves, or closes.
  useEffect(() => {
    setColorPreview(null);
  }, [contextMenu]);
  const [expandedZoneIds, setExpandedZoneIds] = useState<Set<string>>(new Set());
  const [legendPos, setLegendPos] = useState<{ x: number; y: number }>({ x: 8, y: 8 });
  const [legendMinimized, setLegendMinimized] = useState(false);
  const legendDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set());

  // Evaluate highlight zones
  const evaluatedZones = useEvaluatedZones(
    trace.highlightZones,
    logs,
    offsets,
    unitSystem,
    unitOverrides,
  );

  // Timeslip strips render through the same plugin as expression zones; prepend
  // them so they sit at the top of the stack on every trace.
  const allZones = useMemo(
    () => [...(timeslipZones ?? []), ...evaluatedZones],
    [timeslipZones, evaluatedZones],
  );
  const mergedExpanded = useMemo(
    () => new Set<string>([...expandedZoneIds, ...(expandedTimeslipIds ?? [])]),
    [expandedZoneIds, expandedTimeslipIds],
  );

  const handleToggleZoneExpand = useCallback((zoneId: string) => {
    // Timeslip expand persists via config; expression zones use local state.
    if (zoneId.startsWith("timeslip:")) {
      onToggleTimeslipExpand?.(zoneId);
      return;
    }
    setExpandedZoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  }, [onToggleTimeslipExpand]);

  const handleLegendMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    legendDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: legendPos.x,
      originY: legendPos.y,
    };

    const handleMove = (ev: MouseEvent) => {
      if (!legendDragRef.current || !chartAreaRef.current) return;
      const bounds = chartAreaRef.current.getBoundingClientRect();
      const dx = ev.clientX - legendDragRef.current.startX;
      const dy = ev.clientY - legendDragRef.current.startY;
      const newX = Math.max(0, Math.min(bounds.width - 40, legendDragRef.current.originX + dx));
      const newY = Math.max(0, Math.min(bounds.height - 20, legendDragRef.current.originY + dy));
      setLegendPos({ x: newX, y: newY });
    };

    const handleUp = () => {
      legendDragRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [legendPos]);

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
      resizeRef.current = { startY: e.clientY, startHeight: trace.height };

      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = ev.clientY - resizeRef.current.startY;
        const newHeight = Math.max(80, resizeRef.current.startHeight + delta);
        onResizeHeight(newHeight);
      };

      const handleUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [trace.height, onResizeHeight]
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

  return (
    <div
      className={`border rounded-lg mb-2 ${dragOver ? "border-primary bg-primary/5" : isPinnedFromOther ? "border-primary/30 border-dashed" : isActive ? "border-primary/50" : "border-border"}`}
      onClick={onSetActive}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header — action buttons only */}
      <div className="flex items-center justify-end gap-1.5 px-2 py-1 border-b bg-muted/30">
        {trace.channels.length === 0 && (
          <span className="text-xs text-muted-foreground flex-1">
            Drop channels here or click a channel in the sidebar
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
        <Tip content="Trace settings">
          <button
            onClick={() => {
              setSettingsFocus(null);
              setSettingsOpen(true);
            }}
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
      <div ref={chartAreaRef} className="relative" style={{ height: trace.height }}>
        {logGroups.length > 0 ? (
          <TraceChart
            logGroups={logGroups}
            width={chartWidth}
            height={trace.height}
            syncKey={syncKey}
            zoomRange={zoomRange}
            globalRange={globalRange}
            sharedYRanges={sharedYRanges}
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
            evaluatedZones={allZones}
            expandedZoneIds={mergedExpanded}
            onToggleZoneExpand={handleToggleZoneExpand}
            onMoveZoneLabel={(zoneId, frac) => onUpdateZone?.(zoneId, { labelYFraction: frac })}
            onChannelContextMenu={(logFileId, channelName, x, y) =>
              setContextMenu({ x, y, logFileId: logFileId as Id<"files">, channelName })
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

        {/* Floating channel legend */}
        {trace.channels.length > 0 && (
          <div
            className="absolute z-10 rounded bg-black/60 backdrop-blur-sm select-none overflow-hidden"
            style={{ left: legendPos.x, top: legendPos.y }}
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
                {(() => {
                  // Group channels by log file, preserving order
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
                    const isHidden = hiddenSet.has(logId as Id<"files">);
                    const allLogChKeys = logChannels.map((c) => `${c.logFileId}:${c.channelName}`);
                    const allLogHidden = allLogChKeys.every((k) => hiddenChannels.has(k));
                    const someLogHidden = allLogChKeys.some((k) => hiddenChannels.has(k));

                    return (
                      <div key={logId} className={isHidden ? "opacity-30" : ""}>
                        {multiLog && log && (
                          <div className="flex items-center gap-1 text-[10px] text-white/40 truncate mt-1 first:mt-0 mb-0.5">
                            <input
                              type="checkbox"
                              checked={!allLogHidden}
                              ref={(el) => { if (el) el.indeterminate = someLogHidden && !allLogHidden; }}
                              onChange={() => {
                                setHiddenChannels((prev) => {
                                  const next = new Set(prev);
                                  if (allLogHidden) {
                                    allLogChKeys.forEach((k) => next.delete(k));
                                  } else {
                                    allLogChKeys.forEach((k) => next.add(k));
                                  }
                                  return next;
                                });
                              }}
                              className="accent-white/60 cursor-pointer"
                            />
                            {log.fileName.replace(/\.[^.]+$/, "")}
                          </div>
                        )}
                        {logChannels.map((ch, chIdx) => {
                          const chKey = `${ch.logFileId}:${ch.channelName}`;
                          const indent = multiLog;
                          const isChHidden = hiddenChannels.has(chKey);
                          const resolved = resolveChannelStyle(
                            ch,
                            chIdx,
                            log?.logIndex ?? 0,
                          );
                          let valueStr: string | null = null;
                          let minStr: string | null = null;
                          let maxStr: string | null = null;
                          let deltaStr: string | null = null;
                          let unitLabel = "";
                          let isAvg = false;
                          const def = log?.parsed.channelDefs.find(d => d.name === ch.channelName);
                          if (avgRange && log && !isHidden && !isChHidden && !def?.enumValues) {
                            const offset = offsets.get(log.fileId) ?? 0;
                            const stats = computeRangeStats(log, ch.channelName, avgRange, offset);
                            if (stats !== null) {
                              const mu = def?.metricUnit ?? "";
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
                          } else if (cursorTime !== null && log && !isHidden && !isChHidden) {
                            const offset = offsets.get(log.fileId) ?? 0;
                            const val = findValueAtTime(log, ch.channelName, cursorTime, offset);
                            if (val !== null) {
                              const mu = def?.metricUnit ?? "";
                              const converted = mu ? convertForDisplay(val, mu, unitSystem, unitOverrides) : val;
                              valueStr = formatValue(converted);
                              unitLabel = mu ? getDisplayUnit(mu, unitSystem, unitOverrides) : "";
                            }
                          }
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
                                  setHiddenChannels((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(chKey)) next.delete(chKey);
                                    else next.add(chKey);
                                    return next;
                                  });
                                }}
                                className="accent-white/60 cursor-pointer shrink-0"
                                style={{ width: 10, height: 10 }}
                              />
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: resolved.color, opacity: resolved.opacity }} />
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
                              <span className="text-white/50 text-[10px] w-8">
                                {unitLabel || ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="h-1.5 cursor-ns-resize hover:bg-primary/20 transition-colors"
        onMouseDown={handleResizeMouseDown}
      />

      {/* Context menu (channel row right-click OR chart line right-click) */}
      {contextMenu && (() => {
        const cmKey = `${contextMenu.logFileId}:${contextMenu.channelName}`;
        const cmHidden = hiddenChannels.has(cmKey);
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
        const cmMu = cmLog?.parsed.channelDefs.find((d) => d.name === contextMenu.channelName)?.metricUnit ?? "";
        const cmToDisplay = (v: number) =>
          cmMu ? convertForDisplay(v, cmMu, unitSystem, unitOverrides) : v;
        return (
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[270px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 pt-0.5 pb-1 text-[11px] text-muted-foreground truncate max-w-[250px]">
              {contextMenu.channelName}
            </div>
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
            <div className="border-t border-border my-1" />
            {cmExtent && (
              <button
                className={item}
                onClick={() => {
                  const pad = (cmExtent.max - cmExtent.min) * 0.05 || 1;
                  onSetChannelAxisRange(
                    contextMenu.logFileId,
                    contextMenu.channelName,
                    cmExtent.min - pad,
                    cmExtent.max + pad,
                  );
                  setContextMenu(null);
                }}
              >
                Fit axis to data
                <span className="ml-auto text-[11px] text-muted-foreground font-mono">
                  {formatValue(cmToDisplay(cmExtent.min))} – {formatValue(cmToDisplay(cmExtent.max))}
                </span>
              </button>
            )}
            {hasManualAxis && (
              <button
                className={item}
                onClick={() => {
                  onSetChannelAxisRange(contextMenu.logFileId, contextMenu.channelName, undefined, undefined);
                  setContextMenu(null);
                }}
              >
                Reset axis to auto
              </button>
            )}
            <div className="border-t border-border my-1" />
            <button
              className={item}
              onClick={() => {
                setSettingsFocus({ logFileId: contextMenu.logFileId, channelName: contextMenu.channelName });
                setSettingsOpen(true);
                setContextMenu(null);
              }}
            >
              Edit channel…
            </button>
            <button
              className={item}
              onClick={() => {
                setHiddenChannels((prev) => {
                  const next = new Set(prev);
                  if (next.has(cmKey)) next.delete(cmKey); else next.add(cmKey);
                  return next;
                });
                setContextMenu(null);
              }}
            >
              {cmHidden ? "Show on chart" : "Hide on chart"}
            </button>
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

      {/* Settings panel */}
      <TraceSettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        focusChannel={settingsFocus}
        trace={trace}
        logs={logs}
        onSetChannelColor={onSetChannelColor}
        onSetChannelOpacity={onSetChannelOpacity}
        onSetChannelWidth={onSetChannelWidth}
        onSetChannelDash={onSetChannelDash}
        onSetChannelAxisRange={onSetChannelAxisRange}
        onSetChannelColorBy={onSetChannelColorBy}
        onRemoveChannel={onRemoveChannel}
        onAddChannel={onAddChannel}
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

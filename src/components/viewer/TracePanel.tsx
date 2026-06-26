import { useState, useCallback, useRef, useEffect } from "react";
import type { LoadedLog, TraceConfig, ChannelOnTrace, PageConfig, HighlightZoneConfig } from "@/lib/viewer-types";
import type { UnitSystem, UnitOverrides } from "@/lib/units";
import type { Id } from "../../../convex/_generated/dataModel";
import { TraceContainer } from "./TraceContainer";
import { OverviewBar } from "./OverviewBar";
import { PlusIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

interface Props {
  traces: TraceConfig[];
  pinnedFromOtherIds: Set<string>;
  pages: PageConfig[];
  activePageId: string;
  onAddPage: () => void;
  onRemovePage: (pageId: string) => void;
  onRenamePage: (pageId: string, label: string) => void;
  onSwitchPage: (pageId: string) => void;
  onToggleTracePin: (traceId: string) => void;
  logs: LoadedLog[];
  syncKey: string;
  offsets: Map<Id<"files">, number>;
  globalRange: [number, number];
  activeTraceId: string | null;
  hiddenLogIds: string[];
  mirroredLogIds: string[];
  showAxes: boolean;
  showAxisLabels: boolean;
  onSetActiveTrace: (traceId: string) => void;
  onRemoveTrace: (traceId: string) => void;
  onRemoveChannel: (traceId: string, logFileId: Id<"files">, channelName: string) => void;
  onAddChannel: (traceId: string, channel: ChannelOnTrace) => void;
  onResizeTrace: (traceId: string, height: number) => void;
  onAddTraceWithChannel: (channel: ChannelOnTrace) => void;
  onSetChannelColor: (traceId: string, logFileId: Id<"files">, channelName: string, color: string | undefined) => void;
  onSetChannelOpacity: (traceId: string, logFileId: Id<"files">, channelName: string, opacity: number) => void;
  onSetChannelWidth: (traceId: string, logFileId: Id<"files">, channelName: string, width: number) => void;
  onSetChannelDash: (traceId: string, logFileId: Id<"files">, channelName: string, dash: number[] | undefined) => void;
  onSetChannelAxisRange: (traceId: string, logFileId: Id<"files">, channelName: string, axisMin?: number, axisMax?: number) => void;
  onAddZone: (traceId: string, zone: HighlightZoneConfig) => void;
  onUpdateZone: (traceId: string, zoneId: string, updates: Partial<Omit<HighlightZoneConfig, "id">>) => void;
  onRemoveZone: (traceId: string, zoneId: string) => void;
  onToggleZone: (traceId: string, zoneId: string) => void;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  wheelZoomEnabled?: boolean;
  wheelZoomFactor?: number;
  avgOnSelection: boolean;
  persistedSelection?: [number, number] | null;
  onPersistSelection?: (sel: [number, number] | null) => void;
}

export function TracePanel({
  traces,
  pinnedFromOtherIds,
  pages,
  activePageId,
  onAddPage,
  onRemovePage,
  onRenamePage,
  onSwitchPage,
  onToggleTracePin,
  logs,
  syncKey,
  offsets,
  globalRange,
  activeTraceId,
  hiddenLogIds,
  mirroredLogIds,
  showAxes,
  showAxisLabels,
  onSetActiveTrace,
  onRemoveTrace,
  onRemoveChannel,
  onAddChannel,
  onResizeTrace,
  onAddTraceWithChannel,
  onSetChannelColor,
  onSetChannelOpacity,
  onSetChannelWidth,
  onSetChannelDash,
  onSetChannelAxisRange,
  onAddZone,
  onUpdateZone,
  onRemoveZone,
  onToggleZone,
  unitSystem,
  unitOverrides,
  wheelZoomEnabled,
  wheelZoomFactor,
  avgOnSelection,
  persistedSelection,
  onPersistSelection,
}: Props) {
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [selection, setSelection] = useState<[number, number] | null>(persistedSelection ?? null);
  const [dragPreview, setDragPreview] = useState<[number, number] | null>(null);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [dragOverBlank, setDragOverBlank] = useState(false);
  const dragCounterRef = useRef(0);

  // Tab rename state
  const [tabRename, setTabRename] = useState<{ id: string; value: string } | null>(null);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 800;
      setContainerWidth(Math.floor(width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleZoom = useCallback((min: number, max: number) => {
    setZoomRange([min, max]);
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoomRange(null);
  }, []);

  const handleCursorTime = useCallback((time: number | null) => {
    setCursorTime(time);
  }, []);

  const handleSelection = useCallback((min: number, max: number) => {
    setSelection([min, max]);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const handleDragPreview = useCallback((sel: [number, number] | null) => {
    setDragPreview(sel);
  }, []);

  // Display the live drag preview or committed selection (whichever is active)
  const displaySelection = dragPreview ?? selection;

  // --- Persist the settled drag-selection per page (Convex-backed) ---
  const onPersistSelectionRef = useRef(onPersistSelection);
  onPersistSelectionRef.current = onPersistSelection;
  const lastSentRef = useRef<[number, number] | null>(persistedSelection ?? null);

  // Restore this page's selection when the active page changes.
  useEffect(() => {
    setSelection(persistedSelection ?? null);
    lastSentRef.current = persistedSelection ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageId]);

  // Debounce-persist the settled selection (covers edge-drag, native drag,
  // click). Live edge-drag moves only persist their settled value, not every
  // mousemove, so we don't thrash the reducer config / Convex save.
  useEffect(() => {
    const id = setTimeout(() => {
      const cur = selection;
      const last = lastSentRef.current;
      const same =
        (cur === null && last === null) ||
        (cur !== null && last !== null && cur[0] === last[0] && cur[1] === last[1]);
      if (same) return;
      lastSentRef.current = cur;
      onPersistSelectionRef.current?.(cur);
    }, 400);
    return () => clearTimeout(id);
  }, [selection]);

  // Keyboard: Escape clears selection then zoom, Up zooms in / to selection, Down zooms out
  const zoomRangeRef = useRef(zoomRange);
  zoomRangeRef.current = zoomRange;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Escape") {
        if (selectionRef.current) {
          setSelection(null);
        } else {
          setZoomRange(null);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (selectionRef.current) {
          setZoomRange(selectionRef.current);
          setSelection(null);
        } else {
          const range = zoomRangeRef.current ?? globalRange;
          const center = (range[0] + range[1]) / 2;
          const quarterSpan = (range[1] - range[0]) / 4;
          setZoomRange([
            Math.max(globalRange[0], center - quarterSpan),
            Math.min(globalRange[1], center + quarterSpan),
          ]);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!zoomRangeRef.current) return;
        const center = (zoomRangeRef.current[0] + zoomRangeRef.current[1]) / 2;
        const halfSpan = zoomRangeRef.current[1] - zoomRangeRef.current[0];
        const newMin = center - halfSpan;
        const newMax = center + halfSpan;
        if (newMin <= globalRange[0] && newMax >= globalRange[1]) {
          setZoomRange(null);
        } else {
          setZoomRange([
            Math.max(globalRange[0], newMin),
            Math.min(globalRange[1], newMax),
          ]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [globalRange]);

  const handleBlankDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setDragOverBlank(true);
  }, []);

  const handleBlankDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
  }, []);

  const handleBlankDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOverBlank(false);
    }
  }, []);

  const handleBlankDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragOverBlank(false);
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          logFileId: Id<"files">;
          channelName: string;
          sourceTraceId?: string;
        };
        if (parsed.logFileId && parsed.channelName) {
          if (parsed.sourceTraceId) {
            onRemoveChannel(parsed.sourceTraceId, parsed.logFileId, parsed.channelName);
          }
          onAddTraceWithChannel({ logFileId: parsed.logFileId, channelName: parsed.channelName });
        }
      } catch {
        // ignore
      }
    },
    [onRemoveChannel, onAddTraceWithChannel]
  );

  const handleTabContextMenu = useCallback((e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const page = pages.find((p) => p.id === pageId);
    if (page) setTabRename({ id: pageId, value: page.label });
  }, [pages]);

  const handleTabRenameSubmit = useCallback(() => {
    if (tabRename && tabRename.value.trim()) {
      onRenamePage(tabRename.id, tabRename.value.trim());
    }
    setTabRename(null);
  }, [tabRename, onRenamePage]);

  // Max y-axis count across all traces — used to pad narrower charts so plot areas align
  const maxYAxes = showAxes
    ? Math.max(1, ...traces.map(t => new Set(t.channels.map(c => c.channelName)).size))
    : undefined;

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* Tab bar */}
      <div className="flex items-center border-b bg-muted/30 px-2 shrink-0">
        {pages.map((page) => {
          const isActive = page.id === activePageId;
          const isRenaming = tabRename?.id === page.id;
          const traceCount = page.traces.length;
          return (
            <div
              key={page.id}
              onClick={() => onSwitchPage(page.id)}
              onContextMenu={(e) => handleTabContextMenu(e, page.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border-b-2 cursor-pointer transition-colors select-none ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  value={tabRename.value}
                  onChange={(e) => setTabRename({ ...tabRename, value: e.target.value })}
                  onBlur={handleTabRenameSubmit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTabRenameSubmit();
                    if (e.key === "Escape") setTabRename(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-24 px-1 py-0 text-sm bg-background border border-primary rounded outline-none"
                />
              ) : (
                <span>{page.label}</span>
              )}
              {traceCount > 0 && !isRenaming && (
                <span className="text-xs opacity-60">({traceCount})</span>
              )}
              {pages.length > 1 && !isRenaming && (
                <Tip content="Close page">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemovePage(page.id);
                    }}
                    className="ml-0.5 text-xs opacity-40 hover:opacity-100 hover:text-destructive cursor-pointer"
                  >
                    x
                  </span>
                </Tip>
              )}
            </div>
          );
        })}
        <Tip content="Add page">
          <button
            onClick={onAddPage}
            className="p-1 ml-1 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </Tip>
      </div>

      {/* Scrollable trace area */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden p-3 flex flex-col"
        onMouseLeave={() => setCursorTime(null)}
      >
        {traces.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-sm text-muted-foreground"
            onDragEnter={handleBlankDragEnter}
            onDragOver={handleBlankDragOver}
            onDragLeave={handleBlankDragLeave}
            onDrop={handleBlankDrop}
          >
            {dragOverBlank ? (
              <div className="border-2 border-dashed border-primary/30 rounded-lg bg-primary/5 w-full" style={{ height: 200 }}>
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Drop to create new trace
                </div>
              </div>
            ) : (
              "Click \u201C+ Trace\u201D to add a trace, then drag channels from the sidebar"
            )}
          </div>
        ) : (
          <>
            {traces.map((trace) => (
              <TraceContainer
                key={trace.id}
                trace={trace}
                logs={logs}
                width={containerWidth - 24}
                syncKey={syncKey}
                zoomRange={zoomRange}
                globalRange={globalRange}
                offsets={offsets}
                hiddenLogIds={hiddenLogIds}
                mirroredLogIds={mirroredLogIds}
                selection={selection}
                onSelection={handleSelection}
                onClearSelection={handleClearSelection}
                onDragPreview={handleDragPreview}
                onCursorTime={handleCursorTime}
                onZoom={handleZoom}
                onResetZoom={handleResetZoom}
                wheelZoomEnabled={wheelZoomEnabled}
                wheelZoomFactor={wheelZoomFactor}
                avgOnSelection={avgOnSelection}
                onRemoveTrace={() => onRemoveTrace(trace.id)}
                onRemoveChannel={(logFileId, channelName) =>
                  onRemoveChannel(trace.id, logFileId, channelName)
                }
                onAddChannel={(channel) => onAddChannel(trace.id, channel)}
                onMoveChannel={(sourceTraceId, logFileId, channelName) =>
                  onRemoveChannel(sourceTraceId, logFileId, channelName)
                }
                onResizeHeight={(h) => onResizeTrace(trace.id, h)}
                showAxes={showAxes}
                showAxisLabels={showAxisLabels}
                onSetChannelColor={(logFileId, channelName, color) =>
                  onSetChannelColor(trace.id, logFileId, channelName, color)
                }
                onSetChannelOpacity={(logFileId, channelName, opacity) =>
                  onSetChannelOpacity(trace.id, logFileId, channelName, opacity)
                }
                onSetChannelWidth={(logFileId, channelName, w) =>
                  onSetChannelWidth(trace.id, logFileId, channelName, w)
                }
                onSetChannelDash={(logFileId, channelName, dash) =>
                  onSetChannelDash(trace.id, logFileId, channelName, dash)
                }
                onSetChannelAxisRange={(logFileId, channelName, axisMin, axisMax) =>
                  onSetChannelAxisRange(trace.id, logFileId, channelName, axisMin, axisMax)
                }
                isActive={activeTraceId === trace.id}
                onSetActive={() => onSetActiveTrace(trace.id)}
                pinned={!!trace.pinned}
                isPinnedFromOther={pinnedFromOtherIds.has(trace.id)}
                onTogglePin={() => onToggleTracePin(trace.id)}
                cursorTime={cursorTime}
                unitSystem={unitSystem}
                unitOverrides={unitOverrides}
                onAddZone={(zone) => onAddZone(trace.id, zone)}
                onUpdateZone={(zoneId, updates) => onUpdateZone(trace.id, zoneId, updates)}
                onRemoveZone={(zoneId) => onRemoveZone(trace.id, zoneId)}
                onToggleZone={(zoneId) => onToggleZone(trace.id, zoneId)}
                maxYAxes={maxYAxes}
              />
            ))}
            {/* Blank space drop zone */}
            <div
              className="flex-1 min-h-[100px]"
              onDragEnter={handleBlankDragEnter}
              onDragOver={handleBlankDragOver}
              onDragLeave={handleBlankDragLeave}
              onDrop={handleBlankDrop}
            >
              {dragOverBlank && (
                <div className="border-2 border-dashed border-primary/30 rounded-lg bg-primary/5" style={{ height: 200 }}>
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Drop to create new trace
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Overview minimap */}
      <OverviewBar
        logs={logs}
        offsets={offsets}
        globalRange={globalRange}
        width={containerWidth}
        zoomRange={zoomRange}
        selection={displaySelection}
        cursorTime={cursorTime}
        onZoom={handleZoom}
        onResetZoom={handleResetZoom}
      />
    </div>
  );
}

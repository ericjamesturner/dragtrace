import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoadedLog, HeatmapConfig } from "@/lib/viewer-types";
import type { Id } from "../../../convex/_generated/dataModel";
import { convertForDisplay, getDisplayUnit, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { findIndexAtTime } from "@/lib/cursor-utils";
import { autoRange, computeHeatmap } from "@/lib/heatmap";
import { PencilIcon, XIcon } from "lucide-react";
import { Heatmap } from "./Heatmap";

interface Props {
  heatmap: HeatmapConfig;
  logs: LoadedLog[];
  width: number;
  offsets: Map<Id<"files">, number>;
  zoomRange: [number, number] | null;
  selection: [number, number] | null;
  cursorTime: number | null;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  onUpdate: (updates: Partial<HeatmapConfig>) => void;
  onRemove: () => void;
  onConfigure: () => void;
}

export function HeatmapContainer({
  heatmap,
  logs,
  width,
  offsets,
  zoomRange,
  selection,
  cursorTime,
  unitSystem,
  unitOverrides,
  onUpdate,
  onRemove,
  onConfigure,
}: Props) {
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const log = logs.find((l) => l.fileId === heatmap.logFileId) ?? logs[0];
  const session = log?.parsed.sessions[log.activeSessionIndex];
  const offset = log ? offsets.get(log.fileId) ?? 0 : 0;
  const ts = session?.timestamps;

  const xData = session?.channels.get(heatmap.xChannel);
  const yData = session?.channels.get(heatmap.yChannel);
  const valueData = session?.channels.get(heatmap.valueChannel);

  const defOf = (n: string) => log?.parsed.channelDefs.find((d) => d.name === n);
  const xMetric = defOf(heatmap.xChannel)?.metricUnit ?? "";
  const yMetric = defOf(heatmap.yChannel)?.metricUnit ?? "";
  const vMetric = defOf(heatmap.valueChannel)?.metricUnit ?? "";

  const xConvert = useCallback(
    (v: number) => (xMetric ? convertForDisplay(v, xMetric, unitSystem, unitOverrides) : v),
    [xMetric, unitSystem, unitOverrides],
  );
  const yConvert = useCallback(
    (v: number) => (yMetric ? convertForDisplay(v, yMetric, unitSystem, unitOverrides) : v),
    [yMetric, unitSystem, unitOverrides],
  );
  const valueConvert = useCallback(
    (v: number) => (vMetric ? convertForDisplay(v, vMetric, unitSystem, unitOverrides) : v),
    [vMetric, unitSystem, unitOverrides],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { startY: e.clientY, startH: heatmap.height };
      setResizing(true);
      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        onUpdate({ height: Math.max(150, resizeRef.current.startH + ev.clientY - resizeRef.current.startY) });
      };
      const handleUp = () => {
        resizeRef.current = null;
        setResizing(false);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [heatmap.height, onUpdate],
  );

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [ctxMenu]);

  // Aligned zoomRange -> this log's local time window (timestamps are local).
  const localTimeRange: [number, number] | null = zoomRange
    ? [zoomRange[0] - offset, zoomRange[1] - offset]
    : null;

  const result = useMemo(() => {
    if (!xData || !yData || !valueData || !ts) return null;
    const xRange = autoRange(xData, xConvert, localTimeRange, ts);
    const yRange = autoRange(yData, yConvert, localTimeRange, ts);
    return computeHeatmap(xData, yData, valueData, ts, {
      xBins: heatmap.xBins,
      yBins: heatmap.yBins,
      xRange,
      yRange,
      timeRange: localTimeRange,
      aggregation: heatmap.aggregation,
      xConvert,
      yConvert,
      valueConvert,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xData, yData, valueData, ts, heatmap.xBins, heatmap.yBins, heatmap.aggregation, zoomRange, offset, xConvert, yConvert, valueConvert]);

  // Highlight the cell(s) the synced cursor / selection currently maps to.
  const highlightCells = useMemo(() => {
    if (!result || !xData || !yData || !ts) return null;
    const xMin = result.xEdges[0];
    const xMax = result.xEdges[result.xEdges.length - 1];
    const yMin = result.yEdges[0];
    const yMax = result.yEdges[result.yEdges.length - 1];
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const { xBins, yBins } = heatmap;

    const binKey = (i: number): string | null => {
      const rx = xData[i], ry = yData[i];
      if (rx !== rx || ry !== ry) return null;
      const x = xConvert(rx);
      const y = yConvert(ry);
      const xi = Math.min(xBins - 1, Math.max(0, Math.floor(((x - xMin) / xSpan) * xBins)));
      const yi = Math.min(yBins - 1, Math.max(0, Math.floor(((y - yMin) / ySpan) * yBins)));
      return `${xi},${yi}`;
    };

    const set = new Set<string>();
    const isPoint = selection && selection[0] === selection[1];

    if (selection && !isPoint) {
      // Range selection: bin every (subsampled) point inside the window.
      const tMin = selection[0] - offset;
      const tMax = selection[1] - offset;
      let iStart = 0, iEnd = ts.length;
      for (let i = 0; i < ts.length; i++) { if (ts[i] >= tMin) { iStart = i; break; } }
      for (let i = ts.length - 1; i >= 0; i--) { if (ts[i] <= tMax) { iEnd = i + 1; break; } }
      const step = Math.max(1, Math.floor((iEnd - iStart) / 200));
      for (let i = iStart; i < iEnd; i += step) {
        const k = binKey(i);
        if (k) set.add(k);
      }
    } else {
      const aligned = isPoint ? selection![0] : cursorTime;
      if (aligned == null) return null;
      const k = binKey(findIndexAtTime(ts, aligned - offset));
      if (k) set.add(k);
    }

    return set.size > 0 ? set : null;
  }, [result, xData, yData, ts, selection, cursorTime, offset, xConvert, yConvert, heatmap]);

  const xUnit = getDisplayUnit(xMetric, unitSystem, unitOverrides);
  const yUnit = getDisplayUnit(yMetric, unitSystem, unitOverrides);
  const vUnit = getDisplayUnit(vMetric, unitSystem, unitOverrides);
  const xLabel = heatmap.xChannel + (xUnit ? ` (${xUnit})` : "");
  const yLabel = heatmap.yChannel + (yUnit ? ` (${yUnit})` : "");
  const valueLabel = heatmap.valueChannel + (vUnit ? ` (${vUnit})` : "");

  if (!result) {
    return (
      <div className="mb-2 rounded bg-muted/30 p-4 text-sm text-destructive">
        Missing channel data for heatmap ({heatmap.xChannel} × {heatmap.yChannel} → {heatmap.valueChannel})
      </div>
    );
  }

  return (
    <div
      className="mb-2 rounded relative"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 rounded-t text-xs text-muted-foreground">
        <span>
          <span className="text-foreground">{heatmap.xChannel}</span>
          {" × "}
          <span className="text-foreground">{heatmap.yChannel}</span>
          {" → "}
          <span className="text-foreground">{heatmap.valueChannel}</span>
          {" "}
          <span className="text-muted-foreground">({heatmap.aggregation})</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button onClick={onConfigure} className="hover:text-foreground cursor-pointer px-1" title="Edit heatmap">
            <PencilIcon className="size-3" />
          </button>
          <button onClick={onRemove} className="hover:text-destructive cursor-pointer px-1" title="Remove heatmap">
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <Heatmap
        result={result}
        width={width - 16}
        height={heatmap.height}
        xLabel={xLabel}
        yLabel={yLabel}
        valueLabel={valueLabel}
        highlightCells={highlightCells}
      />
      <div
        onMouseDown={handleResizeStart}
        className="h-1.5 cursor-ns-resize group flex items-center justify-center relative"
      >
        <div className="w-12 h-0.5 rounded-full bg-border group-hover:bg-primary transition-colors" />
        {resizing && (
          <div className="absolute right-2 -top-5 bg-popover text-muted-foreground text-[10px] px-1.5 py-0.5 rounded pointer-events-none font-mono border border-border">
            {heatmap.height}px
          </div>
        )}
      </div>
      {ctxMenu && (
        <div
          ref={ctxRef}
          style={{
            position: "fixed",
            left: Math.min(ctxMenu.x, window.innerWidth - 200),
            top: Math.min(ctxMenu.y, window.innerHeight - 100),
            zIndex: 1000,
          }}
          className="bg-popover border border-border rounded-md shadow-lg overflow-hidden min-w-[160px]"
        >
          <button
            onClick={() => { onConfigure(); setCtxMenu(null); }}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted cursor-pointer text-foreground"
          >
            Edit Heatmap
          </button>
          <button
            onClick={() => { onRemove(); setCtxMenu(null); }}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted cursor-pointer text-destructive border-t border-border"
          >
            Remove Heatmap
          </button>
        </div>
      )}
    </div>
  );
}

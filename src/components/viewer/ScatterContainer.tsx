import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoadedLog, ScatterConfig } from "@/lib/viewer-types";
import type { Id } from "../../../convex/_generated/dataModel";
import { convertForDisplay, getDisplayUnit, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { findIndexAtTime } from "@/lib/cursor-utils";
import { PencilIcon, XIcon } from "lucide-react";
import { ScatterChart } from "./ScatterChart";

interface Props {
  scatter: ScatterConfig;
  logs: LoadedLog[];
  width: number;
  offsets: Map<Id<"files">, number>;
  zoomRange: [number, number] | null;
  selection: [number, number] | null;
  cursorTime: number | null;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  onUpdate: (updates: Partial<ScatterConfig>) => void;
  onRemove: () => void;
  onConfigure: () => void;
}

export function ScatterContainer({
  scatter,
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

  const log = logs.find((l) => l.fileId === scatter.logFileId) ?? logs[0];
  const session = log?.parsed.sessions[log.activeSessionIndex];
  const offset = log ? offsets.get(log.fileId) ?? 0 : 0;
  const ts = session?.timestamps;

  const xData = session?.channels.get(scatter.xChannel);
  const yData = session?.channels.get(scatter.yChannel);
  const colorData = scatter.colorChannel ? session?.channels.get(scatter.colorChannel) : undefined;

  const defOf = (n: string) => log?.parsed.channelDefs.find((d) => d.name === n);
  const xMetric = defOf(scatter.xChannel)?.metricUnit ?? "";
  const yMetric = defOf(scatter.yChannel)?.metricUnit ?? "";
  const cMetric = scatter.colorChannel ? defOf(scatter.colorChannel)?.metricUnit ?? "" : "";

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { startY: e.clientY, startH: scatter.height };
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
    [scatter.height, onUpdate]
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

  const scatterData = useMemo(() => {
    if (!xData || !yData || !ts) return null;

    const convX = (v: number) => (xMetric ? convertForDisplay(v, xMetric, unitSystem, unitOverrides) : v);
    const convY = (v: number) => (yMetric ? convertForDisplay(v, yMetric, unitSystem, unitOverrides) : v);
    const convC = (v: number) => (cMetric ? convertForDisplay(v, cMetric, unitSystem, unitOverrides) : v);

    // Aligned time = ts[i] + offset; filter to the current zoom window.
    let iStart = 0;
    let iEnd = ts.length;
    if (zoomRange) {
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] + offset >= zoomRange[0]) { iStart = i; break; }
      }
      for (let i = ts.length - 1; i >= 0; i--) {
        if (ts[i] + offset <= zoomRange[1]) { iEnd = i + 1; break; }
      }
    }

    const xArr: number[] = [];
    const yArr: number[] = [];
    const cArr: number[] | undefined = colorData ? [] : undefined;
    const idxMap: number[] = [];
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, cmin = Infinity, cmax = -Infinity;

    for (let i = iStart; i < iEnd; i++) {
      const rx = xData[i], ry = yData[i];
      if (rx !== rx || ry !== ry) continue;
      if (colorData) {
        const rc = colorData[i];
        if (rc !== rc) continue;
        const cv = convC(rc);
        cArr!.push(cv);
        if (cv < cmin) cmin = cv;
        if (cv > cmax) cmax = cv;
      }
      const xv = convX(rx), yv = convY(ry);
      xArr.push(xv);
      yArr.push(yv);
      idxMap.push(i);
      if (xv < xmin) xmin = xv;
      if (xv > xmax) xmax = xv;
      if (yv < ymin) ymin = yv;
      if (yv > ymax) ymax = yv;
    }

    const pad = (lo: number, hi: number): [number, number] => {
      const p = (hi - lo) * 0.02 || 0.5;
      return [lo - p, hi + p];
    };

    return {
      xArr,
      yArr,
      cArr,
      idxMap,
      xRange: (isFinite(xmin) ? pad(xmin, xmax) : [0, 1]) as [number, number],
      yRange: (isFinite(ymin) ? pad(ymin, ymax) : [0, 1]) as [number, number],
      colorRange: colorData && isFinite(cmin) ? (pad(cmin, cmax) as [number, number]) : undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xData, yData, colorData, ts, offset, zoomRange, xMetric, yMetric, cMetric, unitSystem, unitOverrides]);

  // Highlight: nearest scatter point to the synced cursor / point-selection time.
  const highlightIdx = useMemo(() => {
    if (!scatterData || !ts) return null;
    const isPoint = selection && selection[0] === selection[1];
    const aligned = isPoint ? selection![0] : cursorTime;
    if (aligned == null) return null;
    const dataIdx = findIndexAtTime(ts, aligned - offset);
    const sIdx = scatterData.idxMap.indexOf(dataIdx);
    return sIdx >= 0 ? sIdx : null;
  }, [scatterData, ts, selection, cursorTime, offset]);

  const xUnit = getDisplayUnit(xMetric, unitSystem, unitOverrides);
  const yUnit = getDisplayUnit(yMetric, unitSystem, unitOverrides);
  const cUnit = scatter.colorChannel ? getDisplayUnit(cMetric, unitSystem, unitOverrides) : "";
  const xLabel = scatter.xChannel + (xUnit ? ` (${xUnit})` : "");
  const yLabel = scatter.yChannel + (yUnit ? ` (${yUnit})` : "");
  const colorLabel = scatter.colorChannel ? scatter.colorChannel + (cUnit ? ` (${cUnit})` : "") : undefined;

  if (!scatterData) {
    return (
      <div className="mb-2 rounded bg-muted/30 p-4 text-sm text-destructive">
        Missing channel data for scatter plot ({scatter.xChannel} vs {scatter.yChannel})
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
          {scatter.xChannel} vs {scatter.yChannel}
          {scatter.colorChannel && (
            <>
              {" "}
              <span className="text-muted-foreground">colored by</span>{" "}
              <span className="text-foreground">{scatter.colorChannel}</span>
            </>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <button onClick={onConfigure} className="hover:text-foreground cursor-pointer px-1" title="Edit scatter">
            <PencilIcon className="size-3" />
          </button>
          <button onClick={onRemove} className="hover:text-destructive cursor-pointer px-1" title="Remove scatter">
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <ScatterChart
        xData={scatterData.xArr}
        yData={scatterData.yArr}
        colorData={scatterData.cArr}
        xRange={scatterData.xRange}
        yRange={scatterData.yRange}
        colorRange={scatterData.colorRange}
        width={width - 16}
        height={scatter.height}
        xLabel={xLabel}
        yLabel={yLabel}
        colorLabel={colorLabel}
        pointSize={scatter.pointSize}
        opacity={scatter.opacity}
        highlightIdx={highlightIdx}
      />
      <div
        onMouseDown={handleResizeStart}
        className="h-1.5 cursor-ns-resize group flex items-center justify-center relative"
      >
        <div className="w-12 h-0.5 rounded-full bg-border group-hover:bg-primary transition-colors" />
        {resizing && (
          <div className="absolute right-2 -top-5 bg-popover text-muted-foreground text-[10px] px-1.5 py-0.5 rounded pointer-events-none font-mono border border-border">
            {scatter.height}px
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
            Edit Scatter
          </button>
          <button
            onClick={() => { onRemove(); setCtxMenu(null); }}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted cursor-pointer text-destructive border-t border-border"
          >
            Remove Scatter
          </button>
        </div>
      )}
    </div>
  );
}

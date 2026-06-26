import { useEffect, useRef, useCallback, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { lttbDownsample } from "@/lib/downsample";
import { formatDuration } from "@/lib/cursor-utils";
import type { LoadedLog } from "@/lib/viewer-types";
import type { EvaluatedZone } from "@/hooks/useEvaluatedZones";
import type { Id } from "../../../convex/_generated/dataModel";

const OVERVIEW_HEIGHT = 48;
const DOWNSAMPLE = 1000;
const HANDLE_HIT = 8;

/** Pick black or white text for legibility on a given hex background (YIQ). */
function readableTextColor(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? "#000" : "#fff";
}

interface Props {
  logs: LoadedLog[];
  offsets: Map<Id<"files">, number>;
  globalRange: [number, number];
  width: number;
  zoomRange: [number, number] | null;
  selection: [number, number] | null;
  cursorTime: number | null;
  timeslipZones?: EvaluatedZone[];
  onZoom: (min: number, max: number) => void;
  onResetZoom: () => void;
}

type DragMode = "pan" | "resize-left" | "resize-right" | "select";

export function OverviewBar({
  logs,
  offsets,
  globalRange,
  width,
  zoomRange,
  selection,
  cursorTime,
  timeslipZones,
  onZoom,
  onResetZoom,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const [selectPreview, setSelectPreview] = useState<[number, number] | null>(null);

  const [fullMin, fullMax] = globalRange;
  const fullSpan = fullMax - fullMin;

  // Find first log with RPM data to display in minimap
  const primaryLog = logs[0];
  const primarySession = primaryLog?.parsed.sessions[primaryLog.activeSessionIndex];
  const rpmData = primarySession?.channels.get("RPM");
  const primaryOffset = primaryLog ? (offsets.get(primaryLog.fileId) ?? 0) : 0;

  useEffect(() => {
    if (!containerRef.current || !rpmData || !primarySession || width < 50) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const ts = primarySession.timestamps;
    const dsTs = lttbDownsample(ts, ts, DOWNSAMPLE).timestamps;
    const tsArr = Array.from(dsTs).map((t) => t + primaryOffset);

    const ds = lttbDownsample(ts, rpmData, DOWNSAMPLE);
    const out = new Array(ds.values.length);
    for (let j = 0; j < ds.values.length; j++) {
      const v = ds.values[j];
      out[j] = v !== v ? null : v;
    }

    const data = [tsArr, out] as uPlot.AlignedData;

    const opts: uPlot.Options = {
      width,
      height: OVERVIEW_HEIGHT,
      legend: { show: false },
      cursor: { show: false },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      scales: {
        x: { time: false, range: () => globalRange },
        y: {},
      },
      axes: [{ show: false }, { show: false }],
      series: [
        {},
        {
          stroke: primaryLog?.logColor ?? "#3b82f6",
          fill: (primaryLog?.logColor ?? "#3b82f6") + "18",
          width: 1,
          scale: "y",
          spanGaps: true,
        },
      ],
    };

    chartRef.current = new uPlot(opts, data, containerRef.current);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpmData, width, primaryOffset, globalRange[0], globalRange[1]]);

  const zoomRef = useRef(zoomRange);
  zoomRef.current = zoomRange;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  const clientXToTime = useCallback(
    (clientX: number, rect: DOMRect) => {
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return fullMin + fraction * fullSpan;
    },
    [fullMin, fullSpan]
  );

  const startDrag = useCallback(
    (clientX: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const w = rect.width;
      const time = clientXToTime(clientX, rect);

      let mode: DragMode;
      let startRange = zoomRef.current;

      if (startRange) {
        const leftPx = ((startRange[0] - fullMin) / fullSpan) * w;
        const rightPx = ((startRange[1] - fullMin) / fullSpan) * w;

        if (Math.abs(x - leftPx) <= HANDLE_HIT) {
          mode = "resize-left";
        } else if (Math.abs(x - rightPx) <= HANDLE_HIT) {
          mode = "resize-right";
        } else if (x > leftPx + HANDLE_HIT && x < rightPx - HANDLE_HIT) {
          mode = "pan";
        } else {
          const half = (startRange[1] - startRange[0]) / 2;
          let min = time - half,
            max = time + half;
          if (min < fullMin) { min = fullMin; max = fullMin + half * 2; }
          if (max > fullMax) { max = fullMax; min = fullMax - half * 2; }
          startRange = [Math.max(fullMin, min), Math.min(fullMax, max)];
          onZoomRef.current(startRange[0], startRange[1]);
          mode = "pan";
        }
      } else {
        mode = "select";
      }

      const startTime = time;
      const fixedEdge =
        mode === "resize-left"
          ? startRange![1]
          : mode === "resize-right"
            ? startRange![0]
            : 0;

      const onMove = (cx: number) => {
        const t = clientXToTime(cx, rect);
        switch (mode) {
          case "pan": {
            if (!startRange) return;
            const delta = t - startTime;
            const span = startRange[1] - startRange[0];
            let min = startRange[0] + delta;
            let max = startRange[1] + delta;
            if (min < fullMin) { min = fullMin; max = fullMin + span; }
            if (max > fullMax) { max = fullMax; min = fullMax - span; }
            onZoomRef.current(Math.max(fullMin, min), Math.min(fullMax, max));
            break;
          }
          case "resize-left": {
            const newMin = Math.max(fullMin, Math.min(t, fixedEdge - 0.01));
            onZoomRef.current(newMin, fixedEdge);
            break;
          }
          case "resize-right": {
            const newMax = Math.min(fullMax, Math.max(t, fixedEdge + 0.01));
            onZoomRef.current(fixedEdge, newMax);
            break;
          }
          case "select": {
            const min = Math.max(fullMin, Math.min(startTime, t));
            const max = Math.min(fullMax, Math.max(startTime, t));
            setSelectPreview([min, max]);
            break;
          }
        }
      };

      const onEnd = (cx: number) => {
        if (mode === "select") {
          const t = clientXToTime(cx, rect);
          const min = Math.max(fullMin, Math.min(startTime, t));
          const max = Math.min(fullMax, Math.max(startTime, t));
          if (max - min > 0.01) onZoomRef.current(min, max);
          setSelectPreview(null);
        }
      };

      return { onMove, onEnd };
    },
    [fullMin, fullMax, fullSpan, clientXToTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const { onMove, onEnd } = startDrag(e.clientX, e.currentTarget as HTMLElement);
      const handleMove = (ev: MouseEvent) => onMove(ev.clientX);
      const handleUp = (ev: MouseEvent) => {
        onEnd(ev.clientX);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [startDrag]
  );

  const getCursor = useCallback(
    (e: React.MouseEvent) => {
      if (!zoomRange) return "crosshair";
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const w = rect.width;
      const leftPx = ((zoomRange[0] - fullMin) / fullSpan) * w;
      const rightPx = ((zoomRange[1] - fullMin) / fullSpan) * w;
      if (Math.abs(x - leftPx) <= HANDLE_HIT || Math.abs(x - rightPx) <= HANDLE_HIT) return "ew-resize";
      if (x > leftPx && x < rightPx) return "grab";
      return "pointer";
    },
    [zoomRange, fullMin, fullSpan]
  );

  const [cursor, setCursor] = useState("default");

  if (!rpmData) return null;

  const viewLeft = zoomRange ? ((zoomRange[0] - fullMin) / fullSpan) * 100 : 0;
  const viewWidth = zoomRange ? ((zoomRange[1] - zoomRange[0]) / fullSpan) * 100 : 100;
  const previewLeft = selectPreview ? ((selectPreview[0] - fullMin) / fullSpan) * 100 : 0;
  const previewWidth = selectPreview ? ((selectPreview[1] - selectPreview[0]) / fullSpan) * 100 : 0;

  return (
    <div className="border-t shrink-0 bg-background">
      <div className="flex items-center px-3 py-0.5 text-xs text-muted-foreground gap-3">
        {cursorTime !== null && (
          <span className="font-mono">{cursorTime.toFixed(2)}s</span>
        )}
        {selection && (
          <span className="font-mono text-blue-400">
            Sel: {formatDuration(selection[1] - selection[0])}
            <span className="ml-1 opacity-60">
              ({selection[0].toFixed(2)}s – {selection[1].toFixed(2)}s)
            </span>
          </span>
        )}
        <div className="flex-1" />
        {zoomRange && (
          <span className="flex items-center gap-1.5">
            {zoomRange[0].toFixed(2)}s - {zoomRange[1].toFixed(2)}s
            <button
              onClick={onResetZoom}
              className="px-1.5 py-0 rounded bg-muted border border-border text-muted-foreground hover:text-foreground cursor-pointer text-xs"
            >
              Show All
            </button>
          </span>
        )}
      </div>
      {/* Timeslip strip — its own band above the RPM minimap (60'/330'/660'/1320') */}
      {(timeslipZones?.length ?? 0) > 0 && (
        <div className="relative border-t border-border/40" style={{ height: 18 }}>
          {timeslipZones!.map((z) =>
            z.regions.map((r, i) => {
              const bg = r.color ?? z.config.color;
              const fg = readableTextColor(bg);
              return (
                <div
                  key={`${z.config.id}:${i}`}
                  className="absolute inset-y-0 flex items-center justify-center overflow-hidden"
                  style={{
                    left: `${((r.start - fullMin) / fullSpan) * 100}%`,
                    width: `${((r.end - r.start) / fullSpan) * 100}%`,
                    backgroundColor: bg,
                  }}
                  title={r.label ? `${r.label} — ${r.time?.toFixed(3)}s` : z.config.label}
                >
                  {r.label && (
                    <span
                      className="text-[11px] leading-none px-0.5 flex items-baseline gap-2 whitespace-nowrap"
                      style={{
                        color: fg,
                        textShadow: fg === "#000"
                          ? "0 0 1px rgba(255,255,255,0.5)"
                          : "0 0 1px rgba(0,0,0,0.6)",
                      }}
                    >
                      <span className="font-bold">{r.label}</span>
                      {r.time != null && (
                        <span className="font-medium tabular-nums opacity-90">{r.time.toFixed(2)}s</span>
                      )}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
      <div
        className="relative"
        style={{ height: OVERVIEW_HEIGHT, cursor }}
        onMouseDown={handleMouseDown}
        onMouseMove={(e) => setCursor(getCursor(e))}
      >
        <div ref={containerRef} className="pointer-events-none" />
        {zoomRange && (
          <>
            <div
              className="absolute top-0 bottom-0 bg-black/40 pointer-events-none"
              style={{ left: 0, width: `${viewLeft}%` }}
            />
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: `${viewLeft}%`, width: `${viewWidth}%` }}
            >
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500/80" />
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-500/80" />
            </div>
            <div
              className="absolute top-0 bottom-0 bg-black/40 pointer-events-none"
              style={{ left: `${viewLeft + viewWidth}%`, right: 0 }}
            />
          </>
        )}
        {selection && (
          <div
            className="absolute top-0 bottom-0 border-l border-r border-blue-400/60 bg-blue-400/10 pointer-events-none"
            style={{
              left: `${((selection[0] - fullMin) / fullSpan) * 100}%`,
              width: `${((selection[1] - selection[0]) / fullSpan) * 100}%`,
            }}
          />
        )}
        {selectPreview && previewWidth > 0.1 && (
          <>
            <div
              className="absolute top-0 bottom-0 bg-black/40 pointer-events-none"
              style={{ left: 0, width: `${previewLeft}%` }}
            />
            <div
              className="absolute top-0 bottom-0 border-l border-r border-blue-500/60 pointer-events-none"
              style={{ left: `${previewLeft}%`, width: `${previewWidth}%` }}
            />
            <div
              className="absolute top-0 bottom-0 bg-black/40 pointer-events-none"
              style={{ left: `${previewLeft + previewWidth}%`, right: 0 }}
            />
          </>
        )}
      </div>
    </div>
  );
}

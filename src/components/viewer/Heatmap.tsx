import { useRef, useEffect, useState, useCallback } from "react";
import type { HeatmapResult } from "@/lib/heatmap";

interface Props {
  result: HeatmapResult;
  width: number;
  height: number;
  xLabel: string;
  yLabel: string;
  valueLabel: string;
  highlightCells?: Set<string> | null; // set of "xi,yi" keys
}

// Blue → Cyan → Green → Yellow → Red (classic ECU tuning palette)
const COLOR_STOPS = [
  [0, 0, 180],     // deep blue
  [0, 100, 255],   // blue
  [0, 200, 200],   // cyan
  [0, 200, 80],    // green
  [180, 220, 0],   // yellow-green
  [255, 200, 0],   // yellow
  [255, 120, 0],   // orange
  [255, 0, 0],     // red
];

function valueToColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (COLOR_STOPS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, COLOR_STOPS.length - 1);
  const frac = idx - lo;
  const r = Math.round(COLOR_STOPS[lo][0] + (COLOR_STOPS[hi][0] - COLOR_STOPS[lo][0]) * frac);
  const g = Math.round(COLOR_STOPS[lo][1] + (COLOR_STOPS[hi][1] - COLOR_STOPS[lo][1]) * frac);
  const b = Math.round(COLOR_STOPS[lo][2] + (COLOR_STOPS[hi][2] - COLOR_STOPS[lo][2]) * frac);
  return `rgb(${r},${g},${b})`;
}

function fmtVal(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export function Heatmap({ result, width, height, xLabel, yLabel, valueLabel, highlightCells }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; xi: number; yi: number } | null>(null);

  const marginLeft = 65;
  const marginBottom = 40;
  const marginTop = 12;
  const marginRight = 60; // color legend
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || plotW <= 0 || plotH <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const { grid, xEdges, yEdges, globalMin, globalMax } = result;
    const yBins = grid.length;
    const xBins = grid[0]?.length ?? 0;
    if (xBins === 0 || yBins === 0) return;

    const valRange = globalMax - globalMin || 1;
    const cellW = plotW / xBins;
    const cellH = plotH / yBins;

    // Draw cells (Y inverted: low values at bottom)
    for (let yi = 0; yi < yBins; yi++) {
      for (let xi = 0; xi < xBins; xi++) {
        const val = grid[yi][xi];
        const px = marginLeft + xi * cellW;
        const py = marginTop + (yBins - 1 - yi) * cellH; // flip Y

        if (val === null) {
          ctx.fillStyle = "rgba(255,255,255,0.03)";
        } else {
          const t = (val - globalMin) / valRange;
          ctx.fillStyle = valueToColor(t);
        }
        ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5); // +0.5 to prevent gaps

        // Draw cell value text if cells are large enough
        if (val !== null && cellW > 36 && cellH > 18) {
          ctx.fillStyle = "rgba(0,0,0,0.7)";
          ctx.font = `${Math.min(11, cellH * 0.5)}px system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(fmtVal(val), px + cellW / 2, py + cellH / 2);
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 0.5;
    for (let xi = 0; xi <= xBins; xi++) {
      const px = marginLeft + xi * cellW;
      ctx.beginPath(); ctx.moveTo(px, marginTop); ctx.lineTo(px, marginTop + plotH); ctx.stroke();
    }
    for (let yi = 0; yi <= yBins; yi++) {
      const py = marginTop + yi * cellH;
      ctx.beginPath(); ctx.moveTo(marginLeft, py); ctx.lineTo(marginLeft + plotW, py); ctx.stroke();
    }

    // Highlight active cells: dim everything else, bright border on active
    if (highlightCells && highlightCells.size > 0) {
      // Dim overlay on the whole plot
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(marginLeft, marginTop, plotW, plotH);

      // Redraw highlighted cells on top so they pop
      for (const key of highlightCells) {
        const [xi, yi] = key.split(",").map(Number);
        if (xi < 0 || xi >= xBins || yi < 0 || yi >= yBins) continue;
        const val = grid[yi][xi];
        const hx = marginLeft + xi * cellW;
        const hy = marginTop + (yBins - 1 - yi) * cellH;

        if (val === null) {
          ctx.fillStyle = "rgba(255,255,255,0.06)";
        } else {
          const t = (val - globalMin) / valRange;
          ctx.fillStyle = valueToColor(t);
        }
        ctx.fillRect(hx, hy, cellW + 0.5, cellH + 0.5);

        // Value text
        if (val !== null && cellW > 36 && cellH > 18) {
          ctx.fillStyle = "rgba(0,0,0,0.7)";
          ctx.font = `${Math.min(11, cellH * 0.5)}px system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(fmtVal(val), hx + cellW / 2, hy + cellH / 2);
        }

        // Bright border
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(hx + 1, hy + 1, cellW - 2, cellH - 2);
      }
    }

    // X axis labels
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xLabelStep = Math.max(1, Math.ceil(xBins / 10));
    for (let i = 0; i <= xBins; i += xLabelStep) {
      const px = marginLeft + i * cellW;
      ctx.fillText(fmtVal(xEdges[i]), px, marginTop + plotH + 4);
    }
    // X axis title
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "11px system-ui";
    ctx.fillText(xLabel, marginLeft + plotW / 2, marginTop + plotH + 22);

    // Y axis labels
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const yLabelStep = Math.max(1, Math.ceil(yBins / 8));
    for (let i = 0; i <= yBins; i += yLabelStep) {
      const py = marginTop + (yBins - i) * cellH;
      ctx.fillText(fmtVal(yEdges[i]), marginLeft - 6, py);
    }
    // Y axis title (rotated)
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "11px system-ui";
    ctx.translate(12, marginTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // Color legend bar
    const legendX = width - marginRight + 14;
    const legendW = 14;
    const legendH = plotH;
    const legendY = marginTop;
    for (let i = 0; i < legendH; i++) {
      const t = 1 - i / legendH;
      ctx.fillStyle = valueToColor(t);
      ctx.fillRect(legendX, legendY + i, legendW, 1.5);
    }
    // Legend border
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendW, legendH);
    // Legend labels
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "9px system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(fmtVal(globalMax), legendX + legendW + 4, legendY);
    ctx.textBaseline = "bottom";
    ctx.fillText(fmtVal(globalMin), legendX + legendW + 4, legendY + legendH);
    ctx.textBaseline = "middle";
    ctx.fillText(valueLabel, legendX + legendW + 4, legendY + legendH / 2);
  }, [result, width, height, plotW, plotH, xLabel, yLabel, valueLabel, highlightCells]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const { grid } = result;
    const yBins = grid.length;
    const xBins = grid[0]?.length ?? 0;
    if (xBins === 0 || yBins === 0) return;

    const cellW = plotW / xBins;
    const cellH = plotH / yBins;
    const xi = Math.floor((mx - marginLeft) / cellW);
    const yi = yBins - 1 - Math.floor((my - marginTop) / cellH); // flip Y

    if (xi < 0 || xi >= xBins || yi < 0 || yi >= yBins) {
      setTooltip(null);
      return;
    }

    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, xi, yi });
  }, [result, plotW, plotH]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (() => {
        const { xi, yi } = tooltip;
        const stats = result.cellStats[yi][xi];
        const xLo = fmtVal(result.xEdges[xi]), xHi = fmtVal(result.xEdges[xi + 1]);
        const yLo = fmtVal(result.yEdges[yi]), yHi = fmtVal(result.yEdges[yi + 1]);
        const pct = stats ? ((stats.count / result.totalSamples) * 100) : 0;

        return (
          <div
            className="absolute z-50 pointer-events-none bg-popover border border-border rounded-lg shadow-lg text-[11px] text-foreground"
            style={{
              left: Math.min(tooltip.x + 14, width - 200),
              top: Math.max(4, tooltip.y - 90),
              minWidth: 170,
            }}
          >
            {stats ? (
              <div className="px-3 py-2 space-y-1.5">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{valueLabel}</span>
                  <span className="font-medium">{fmtVal(stats.avg)}</span>
                </div>
                <div className="flex gap-3 text-[10px] text-muted-foreground">
                  <span>min <span className="text-cyan-400">{fmtVal(stats.min)}</span></span>
                  <span>max <span className="text-red-400">{fmtVal(stats.max)}</span></span>
                  <span>range <span className="text-foreground">{fmtVal(stats.max - stats.min)}</span></span>
                </div>
                <div className="border-t border-border pt-1.5 text-[10px] space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">{xLabel}</span><span>{xLo} – {xHi}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{yLabel}</span><span>{yLo} – {yHi}</span></div>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {stats.count.toLocaleString()} samples ({pct.toFixed(1)}%)
                </div>
              </div>
            ) : (
              <div className="px-3 py-2 space-y-1">
                <div className="text-muted-foreground">No data</div>
                <div className="text-[10px] space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">{xLabel}</span><span>{xLo} – {xHi}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{yLabel}</span><span>{yLo} – {yHi}</span></div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

import { useRef, useEffect, useState, useCallback } from "react";

interface Props {
  xData: number[];
  yData: number[];
  colorData?: number[];
  xRange: [number, number];
  yRange: [number, number];
  colorRange?: [number, number];
  width: number;
  height: number;
  xLabel: string;
  yLabel: string;
  colorLabel?: string;
  pointSize?: number;
  opacity?: number;
  highlightIdx?: number | null;
}

// Blue → Cyan → Green → Yellow → Red
const COLOR_STOPS = [
  [0, 0, 180],
  [0, 100, 255],
  [0, 200, 200],
  [0, 200, 80],
  [180, 220, 0],
  [255, 200, 0],
  [255, 120, 0],
  [255, 0, 0],
];

function valueToColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (COLOR_STOPS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, COLOR_STOPS.length - 1);
  const frac = idx - lo;
  return [
    Math.round(COLOR_STOPS[lo][0] + (COLOR_STOPS[hi][0] - COLOR_STOPS[lo][0]) * frac),
    Math.round(COLOR_STOPS[lo][1] + (COLOR_STOPS[hi][1] - COLOR_STOPS[lo][1]) * frac),
    Math.round(COLOR_STOPS[lo][2] + (COLOR_STOPS[hi][2] - COLOR_STOPS[lo][2]) * frac),
  ];
}

function fmtVal(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export function ScatterChart({ xData, yData, colorData, xRange, yRange, colorRange, width, height, xLabel, yLabel, colorLabel, pointSize = 2, opacity = 0.6, highlightIdx }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; idx: number } | null>(null);

  const marginLeft = 65;
  const marginBottom = 40;
  const marginTop = 12;
  const marginRight = colorData ? 60 : 12;
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

    const [xMin, xMax] = xRange;
    const [yMin, yMax] = yRange;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const [cMin, cMax] = colorRange ?? [0, 1];
    const cSpan = cMax - cMin || 1;

    const hasColor = colorData && colorRange;
    const n = xData.length;
    const r = pointSize;

    // Draw plot background
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(marginLeft, marginTop, plotW, plotH);

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    const xTicks = 8, yTicks = 6;
    for (let i = 0; i <= xTicks; i++) {
      const px = marginLeft + (i / xTicks) * plotW;
      ctx.beginPath(); ctx.moveTo(px, marginTop); ctx.lineTo(px, marginTop + plotH); ctx.stroke();
    }
    for (let i = 0; i <= yTicks; i++) {
      const py = marginTop + (i / yTicks) * plotH;
      ctx.beginPath(); ctx.moveTo(marginLeft, py); ctx.lineTo(marginLeft + plotW, py); ctx.stroke();
    }

    // Draw points
    ctx.globalAlpha = highlightIdx != null ? opacity * 0.3 : opacity;
    if (hasColor) {
      for (let i = 0; i < n; i++) {
        const px = marginLeft + ((xData[i] - xMin) / xSpan) * plotW;
        const py = marginTop + plotH - ((yData[i] - yMin) / ySpan) * plotH;
        if (px < marginLeft || px > marginLeft + plotW || py < marginTop || py > marginTop + plotH) continue;
        const t = (colorData![i] - cMin) / cSpan;
        const [cr, cg, cb] = valueToColor(t);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      }
    } else {
      ctx.fillStyle = "#3b82f6";
      for (let i = 0; i < n; i++) {
        const px = marginLeft + ((xData[i] - xMin) / xSpan) * plotW;
        const py = marginTop + plotH - ((yData[i] - yMin) / ySpan) * plotH;
        if (px < marginLeft || px > marginLeft + plotW || py < marginTop || py > marginTop + plotH) continue;
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }

    // Highlight point (cursor/selection)
    if (highlightIdx != null && highlightIdx >= 0 && highlightIdx < n) {
      ctx.globalAlpha = 1;
      const hx = marginLeft + ((xData[highlightIdx] - xMin) / xSpan) * plotW;
      const hy = marginTop + plotH - ((yData[highlightIdx] - yMin) / ySpan) * plotH;
      const hr = Math.max(r + 2, 4);

      // Crosshair
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(hx, marginTop); ctx.lineTo(hx, marginTop + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(marginLeft, hy); ctx.lineTo(marginLeft + plotW, hy); ctx.stroke();
      ctx.setLineDash([]);

      // Point
      if (hasColor) {
        const t = (colorData![highlightIdx] - cMin) / cSpan;
        const [cr, cg, cb] = valueToColor(t);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      } else {
        ctx.fillStyle = "#60a5fa";
      }
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // X axis labels
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= xTicks; i++) {
      const v = xMin + (i / xTicks) * xSpan;
      const px = marginLeft + (i / xTicks) * plotW;
      ctx.fillText(fmtVal(v), px, marginTop + plotH + 4);
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "11px system-ui";
    ctx.fillText(xLabel, marginLeft + plotW / 2, marginTop + plotH + 22);

    // Y axis labels
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= yTicks; i++) {
      const v = yMin + (i / yTicks) * ySpan;
      const py = marginTop + plotH - (i / yTicks) * plotH;
      ctx.fillText(fmtVal(v), marginLeft - 6, py);
    }
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "11px system-ui";
    ctx.translate(12, marginTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // Color legend
    if (hasColor && colorLabel) {
      const legendX = width - marginRight + 14;
      const legendW = 14;
      const legendH = plotH;
      const legendY = marginTop;
      for (let i = 0; i < legendH; i++) {
        const t = 1 - i / legendH;
        const [cr, cg, cb] = valueToColor(t);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.fillRect(legendX, legendY + i, legendW, 1.5);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.strokeRect(legendX, legendY, legendW, legendH);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "9px system-ui";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(fmtVal(cMax), legendX + legendW + 4, legendY);
      ctx.textBaseline = "bottom";
      ctx.fillText(fmtVal(cMin), legendX + legendW + 4, legendY + legendH);
      ctx.textBaseline = "middle";
      ctx.fillText(colorLabel, legendX + legendW + 4, legendY + legendH / 2);
    }
  }, [xData, yData, colorData, xRange, yRange, colorRange, width, height, plotW, plotH, xLabel, yLabel, colorLabel, pointSize, opacity, highlightIdx]);

  // Find nearest point on hover
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (mx < marginLeft || mx > marginLeft + plotW || my < marginTop || my > marginTop + plotH) {
      setTooltip(null);
      return;
    }

    const [xMin, xMax] = xRange;
    const [yMin, yMax] = yRange;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;

    // Convert mouse to data coords
    const dataX = xMin + ((mx - marginLeft) / plotW) * xSpan;
    const dataY = yMin + ((marginTop + plotH - my) / plotH) * ySpan;

    // Find nearest point (search all, use normalized distance)
    let bestDist = Infinity;
    let bestIdx = -1;
    const n = xData.length;
    const step = n > 50000 ? Math.ceil(n / 50000) : 1;
    for (let i = 0; i < n; i += step) {
      const dx = (xData[i] - dataX) / xSpan;
      const dy = (yData[i] - dataY) / ySpan;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    // Only show if reasonably close (within ~30px)
    const pxDist = Math.sqrt(bestDist) * Math.max(plotW, plotH);
    if (bestIdx >= 0 && pxDist < 30) {
      setTooltip({ x: mx, y: my, idx: bestIdx });
    } else {
      setTooltip(null);
    }
  }, [xData, yData, xRange, yRange, plotW, plotH]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (() => {
        const { idx } = tooltip;
        return (
          <div
            className="absolute z-50 pointer-events-none bg-popover text-popover-foreground border border-border rounded-md shadow-lg text-[11px]"
            style={{
              left: Math.min(tooltip.x + 14, width - 180),
              top: Math.max(4, tooltip.y - 70),
              minWidth: 150,
            }}
          >
            <div className="px-3 py-2 space-y-1">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{xLabel}</span>
                <span className="font-medium">{fmtVal(xData[idx])}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{yLabel}</span>
                <span className="font-medium">{fmtVal(yData[idx])}</span>
              </div>
              {colorData && colorLabel && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{colorLabel}</span>
                  <span className="font-medium">{fmtVal(colorData[idx])}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

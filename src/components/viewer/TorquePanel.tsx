import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { MoveHorizontalIcon } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { LoadedLog } from "@/lib/viewer-types";
import type { EvaluatedZone } from "@/hooks/useEvaluatedZones";
import { readTorqueView, type TorqueControl, type TorqueView } from "@/lib/torque-view";
import { runLabels } from "@/lib/run-tags";
import { fitPassWindow } from "@/lib/pass-window";
import { distanceAtTime, findSlipAtLaunch } from "@/lib/timeslip-zones";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import { clampWheelRange, hexToRgba } from "./TraceChart";
import { dockedPanelWidth, HDR_PILL, HDR_PILL_OFF, HDR_PILL_ON, LegendHeading, PanelResizeHandle } from "./TraceContainer";

const C = {
  rpm: "#e5e5e5",
  target: "#a3a3a3",
  over: "#ef4444",
  under: "#3b82f6",
  cut: "#f97316",
  pull: "#3b82f6",
  pull2: "#93c5fd",
  add: "#f59e0b",
  zero: "#3a3a3a",
  mute: "#8a8a8a",
};

/** Per viewer: the lines switched off in the channels panel. */
const HIDDEN_KEY = "dragtrace.torque.hidden";
const PART_LABEL_H = 18;
const GAP = 12;
/** RPM over or under target that fills its part. */
const ERROR_SPAN = 500;
/** Timing pull that fills the timing part below its zero line, with the timed table shown. */
const PULL_SPAN_DEG = 20;
/** Adds are a fraction of a degree beside a pull of fifteen: drawn this much taller to be seen. */
const ADD_GAIN = 3;

type Lane = "rpm" | "err" | "cut" | "ign";
type LineKey = "rpm" | "target" | "over" | "under" | "cut" | "timed" | "errPull" | "errAdd";
interface Part {
  top: number;
  h: number;
}

/** Each part's place, sharing the height so the chart never flattens: RPM most, the cut least. */
function layout(h: number): Record<Lane, Part> {
  const usable = h - GAP * 3 - PART_LABEL_H * 4;
  const part = (y: number, share: number): Part => ({ top: y + PART_LABEL_H, h: usable * share });
  const rpm = part(0, 0.38);
  const err = part(rpm.top + rpm.h + GAP, 0.18);
  const cut = part(err.top + err.h + GAP, 0.16);
  const ign = part(cut.top + cut.h + GAP, 0.28);
  return { rpm, err, cut, ign };
}

function indexAt(t: Float64Array, x: number): number {
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(t[lo - 1] - x) < Math.abs(t[lo] - x) ? lo - 1 : lo;
}

const num = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? 0 : v);
const deg = (v: number) => (Math.abs(v) < 0.05 ? "0.0°" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}°`);
const when = (t: number) => `${t.toFixed(2).replace(/^(-?)0\./, "$1.")}s`;

/** Where a series goes furthest one way after the launch. */
function peak(t: Float64Array, v: Float64Array | null, sign: 1 | -1): { t: number; v: number } | null {
  if (!v) return null;
  let best = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < 0 || !Number.isFinite(v[i]) || sign * v[i] <= 0) continue;
    if (best < 0 || sign * v[i] > sign * v[best]) best = i;
  }
  return best < 0 ? null : { t: t[best], v: v[best] };
}

interface ReceiptData {
  title: string;
  at: string;
  rows: { label: string; value: string; color?: string; dim?: boolean }[];
  total?: { label: string; value: string };
  note?: string;
}

function Receipt({ r }: { r: ReceiptData }) {
  return (
    <div className="min-w-[240px] max-w-[300px]">
      <div className="mb-1.5 flex justify-between font-semibold text-white">
        {r.title}
        <span className="font-mono font-normal text-muted-foreground">{r.at}</span>
      </div>
      {r.rows.map((row) => (
        <div key={row.label} className={`flex justify-between gap-4 ${row.dim ? "text-white/35" : ""}`}>
          <span>
            {row.color && <i className="mr-1.5 inline-block size-2 rounded-[2px]" style={{ background: row.color, opacity: row.dim ? 0.4 : 1 }} />}
            {row.label}
          </span>
          <span className={`whitespace-nowrap font-mono ${row.dim ? "" : "text-white"}`}>{row.value}</span>
        </div>
      ))}
      {r.total && (
        <>
          <div className="mb-1 mt-1.5 border-t border-dashed border-white/30" />
          <div className="flex justify-between gap-4 font-bold text-white">
            <span>{r.total.label}</span>
            <span className="font-mono">{r.total.value}</span>
          </div>
        </>
      )}
      {r.note && <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{r.note}</div>}
    </div>
  );
}

/** The hover receipt for one part at one moment, `t` seconds after the launch. */
function receiptFor(lane: Lane, view: TorqueView, control: TorqueControl, t: number, showTimed: boolean): ReceiptData {
  const at = when(t);
  if (t < 0) return { title: "Before the launch", at, rows: [], note: "Torque management only works after the launch." };
  const i = indexAt(view.t, t);
  const actual = num(control.actual[i]);
  const target = num(control.target[i]);
  const e = num(control.error[i]);
  const cut = num(control.cut?.[i]);
  const timed = num(view.timed?.[i]);
  const part = num(control.timing?.[i]);
  const total = view.total ? num(view.total[i]) : timed + part;
  const short = control.kind === "engine" ? "RPM" : "Driveshaft";
  const doing = [
    cut > 0.05 ? `cutting ${cut.toFixed(1)}%` : "",
    total < -0.2 ? `pulling ${Math.abs(total).toFixed(1)}°` : total > 0.2 ? `adding ${total.toFixed(1)}°` : "",
  ].filter(Boolean);
  const gap = `${Math.abs(Math.round(e))} rpm`;

  if (lane === "rpm" || lane === "err") {
    return {
      title: lane === "rpm" ? control.label : "Over / under target",
      at,
      rows: [
        { label: "Target", value: String(Math.round(target)) },
        { label: control.label, value: String(Math.round(actual)) },
      ],
      total: { label: e > 0 ? "Over target" : "Under target", value: gap },
      note:
        e > 0
          ? `Too fast for the tune, so torque management acts${doing.length ? `: ${doing.join(", ")}` : ""}.`
          : `Slower than the tune wants, so no cut${part > 0.2 ? `; adding ${part.toFixed(1)}° back` : ""}.`,
    };
  }
  if (lane === "cut") {
    return {
      title: "Power cut",
      at,
      rows: [{ label: `${short} ${e > 0 ? "over" : "under"} target`, value: gap, color: e > 0 ? C.over : C.under, dim: e <= 0 }],
      total: { label: "Cut", value: `${cut.toFixed(1)}%` },
      note:
        cut > 0.05
          ? `About 1 in ${Math.round(100 / cut)} firing events skipped to bring it back down.`
          : e > 0
            ? "Over target, but not far enough to cut."
            : "Under target, so nothing is cut.",
    };
  }
  return {
    title: "Timing",
    at,
    rows: [
      { label: "Timed table", value: deg(timed), color: C.pull, dim: !showTimed || Math.abs(timed) < 0.05 },
      { label: `${short} ${part > 0 ? "under" : "over"} target`, value: deg(part), color: part > 0 ? C.add : C.pull2, dim: Math.abs(part) < 0.05 },
    ],
    total: { label: total < 0 ? "Total pulled" : total > 0 ? "Total added" : "Total", value: deg(total) },
    note: showTimed ? "Minus takes timing out (less power); plus puts it back." : "The timed pull is switched off on the chart; it still counts in the total.",
  };
}

const ROW_TIPS: Record<LineKey, string> = {
  rpm: "The speed torque management controls, from the log.",
  target: "The speed torque management wants at each moment after the launch, from the tune's target table at the knob setting.",
  over: "Spinning faster than the tune wants. This is what makes torque management act: it cuts power and pulls timing until it comes back down to target.",
  under: "Slower than the tune wants. Torque management stops cutting, and can add timing back to help it catch up.",
  cut: "The share of firing events the ECU skips to take power away. 3.5% is about 1 in 30. It only cuts while over target. Drawn hanging down because it takes power away.",
  timed: "Timing the timed table takes out: it pulls by time after the launch, whatever RPM is doing. The knob picks the row. Switch it off to see just the part that answers to the target, at its own scale.",
  errPull: "Extra timing taken out because it's over target. The further over, the more it pulls.",
  errAdd: "Timing put back because it's under target, to help it catch up.",
};

/**
 * The Torque Mgmt tab: what torque management did through the pass, top to
 * bottom as cause and effect — the RPM against its target, how far over or
 * under it ran, then everything that takes power away hanging down (the cut,
 * the timing pull) and anything that adds power going up.
 *
 * Built like a trace so it reads like one: the viewer's clock, zoom and
 * cursor (with the race time and distance at it), the launch and timeslip
 * lines, and the docked channels panel with a switch per line. Hovering a
 * part adds a receipt of that moment, its parts adding up to the total.
 */
export function TorquePanel({
  logs,
  width,
  offsets,
  zoomRange,
  globalRange,
  inferredPassWindow,
  syncKey,
  cursorTime,
  onCursorTime,
  onZoom,
  onResetZoom,
  timeslipZones,
  raceLine,
  wheelZoomEnabled,
  wheelZoomFactor,
  wheelMode,
  legendWidth,
  legendCollapsed,
  onSetLegendWidth,
}: {
  logs: LoadedLog[];
  width: number;
  offsets: Map<Id<"files">, number>;
  zoomRange: [number, number] | null;
  globalRange: [number, number];
  inferredPassWindow: [number, number] | null;
  syncKey: string;
  cursorTime: number | null;
  onCursorTime: (time: number | null) => void;
  onZoom: (min: number, max: number) => void;
  onResetZoom: () => void;
  timeslipZones: EvaluatedZone[];
  raceLine?: { color?: string; width?: number; dash?: number[] };
  wheelZoomEnabled?: boolean;
  wheelZoomFactor?: number;
  wheelMode?: "zoom" | "scroll";
  legendWidth?: number;
  legendCollapsed?: boolean;
  onSetLegendWidth: (width: number) => void;
}) {
  const views = useMemo(() => logs.map((l) => ({ log: l, view: readTorqueView(l) })).filter((x) => x.view), [logs]);
  const labels = useMemo(() => runLabels(views.map((v) => v.log.fileName)), [views]);
  const [runId, setRunId] = useState<string | null>(null);
  const current = views.find((v) => v.log.fileId === runId) ?? views[0];
  const view = current?.view ?? null;
  const [kind, setKind] = useState<TorqueControl["kind"] | null>(null);
  const control = view ? (view.controls.find((c) => c.kind === kind) ?? view.controls[0]) : null;

  const [hidden, setHiddenState] = useState<Set<LineKey>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as LineKey[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (keys: LineKey[], show: boolean) => {
    const next = new Set(hidden);
    for (const k of keys) {
      if (show) next.delete(k);
      else next.add(k);
    }
    setHiddenState(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      // A blocked store only means the choice isn't remembered.
    }
  };
  const on = (k: LineKey) => !hidden.has(k);
  const showTimed = on("timed") && !!view?.timed;

  // Laid out like a trace: plot on the left, channels panel docked right.
  const panelWidth = dockedPanelWidth({ legendCollapsed, legendWidth, columns: 1 });
  const chartWidth = Math.max(100, width - 8 - panelWidth);
  const areaRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(560);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(Math.max(480, Math.floor(entry.contentRect.height))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  const offset = current ? (offsets.get(current.log.fileId) ?? 0) : 0;
  const launchAt = current?.log.raceStartTime != null ? current.log.raceStartTime + offset : null;
  const xRange = zoomRange ?? globalRange;
  const passWindow = useMemo(() => fitPassWindow(timeslipZones, globalRange, inferredPassWindow), [timeslipZones, globalRange, inferredPassWindow]);

  const cb = useRef({ onCursorTime, onZoom, onResetZoom, wheelZoomEnabled, wheelZoomFactor, wheelMode, globalRange, xRange, showTimed });
  cb.current = { onCursorTime, onZoom, onResetZoom, wheelZoomEnabled, wheelZoomFactor, wheelMode, globalRange, xRange, showTimed };

  useEffect(() => {
    const el = plotRef.current;
    if (!el || !view || !control || launchAt === null) return;
    const { t } = view;
    const parts = layout(height);

    const draw = (u: uPlot) => {
      const ctx = u.ctx;
      const px = uPlot.pxRatio;
      const { left, top, width: w } = u.bbox;
      const X = (s: number) => u.valToPos(s + launchAt, "x", true);
      const Y = (y: number) => top + y * px;
      const shown = (i: number) => t[i] >= 0;
      const bar = (i: number) => [X(t[i - 1]), X(t[i]) - X(t[i - 1]) + 0.5 * px] as const;
      const label = (text: string, x: number, y: number, color: string) => {
        ctx.font = `${11 * px}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = "rgba(10,10,10,0.9)";
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
      };
      const partLabel = (p: Part, name: string, scale: string) => {
        ctx.font = `600 ${10 * px}px ui-sans-serif, system-ui`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        const y = Y(p.top - PART_LABEL_H / 2);
        ctx.fillText(name.toUpperCase(), left + 6 * px, y);
        const nameW = ctx.measureText(name.toUpperCase()).width;
        ctx.font = `${10 * px}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillStyle = C.mute;
        ctx.fillText(scale, left + 14 * px + nameW, y);
      };
      const zeroLine = (y: number) => {
        ctx.strokeStyle = C.zero;
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + w, y);
        ctx.stroke();
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, w, u.bbox.height);
      ctx.clip();

      // RPM against its target, from the launch, the gap between them filled.
      const { rpm, err, cut, ign } = parts;
      partLabel(rpm, control.label, "");
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < t.length; i++) {
        if (!shown(i)) continue;
        for (const v of [control.actual[i], control.target[i]]) {
          if (Number.isFinite(v)) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
      }
      lo -= 150;
      hi += 150;
      const yR = (v: number) => Y(rpm.top + rpm.h - ((v - lo) / (hi - lo)) * rpm.h);
      for (let i = 1; i < t.length; i++) {
        const a = control.actual[i];
        const b = control.target[i];
        if (!shown(i) || !Number.isFinite(a) || !Number.isFinite(b)) continue;
        if (a > b ? !on("over") : !on("under")) continue;
        const [bx, bw] = bar(i);
        ctx.fillStyle = a > b ? "rgba(239,68,68,0.45)" : "rgba(59,130,246,0.22)";
        ctx.fillRect(bx, Math.min(yR(a), yR(b)), bw, Math.abs(yR(a) - yR(b)));
      }
      const line = (v: Float64Array, color: string, dash: number[]) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash(dash.map((d) => d * px));
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < t.length; i++) {
          if (!shown(i) || !Number.isFinite(v[i])) {
            started = false;
            continue;
          }
          if (started) ctx.lineTo(X(t[i]), yR(v[i]));
          else ctx.moveTo(X(t[i]), yR(v[i]));
          started = true;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };
      if (on("target")) line(control.target, C.target, [5, 4]);
      if (on("rpm")) line(control.actual, C.rpm, []);

      // Over or under target, around its zero line.
      partLabel(err, "Over / under target", `±${ERROR_SPAN} rpm`);
      const errMid = Y(err.top + err.h / 2);
      const errPx = (err.h / 2 / ERROR_SPAN) * px;
      zeroLine(errMid);
      for (let i = 1; i < t.length; i++) {
        const v = control.error[i];
        if (!shown(i) || !Number.isFinite(v) || !on(v > 0 ? "over" : "under")) continue;
        const c = Math.max(-ERROR_SPAN, Math.min(ERROR_SPAN, v));
        const [bx, bw] = bar(i);
        ctx.fillStyle = v > 0 ? "rgba(239,68,68,0.8)" : "rgba(59,130,246,0.4)";
        ctx.fillRect(bx, v > 0 ? errMid - c * errPx : errMid, bw, Math.abs(c) * errPx);
      }
      const over = peak(t, control.error, 1);
      if (over && on("over")) label(`+${Math.round(over.v)}`, X(over.t) + 4 * px, errMid - Math.min(ERROR_SPAN, over.v) * errPx - 6 * px, C.over);

      // Power cut, hanging down from its zero line.
      let cutMax = 5;
      if (control.cut) for (let i = 0; i < t.length; i++) if (shown(i) && control.cut[i] > cutMax) cutMax = control.cut[i];
      partLabel(cut, "Power cut", control.cut ? `0–${cutMax.toFixed(0)}% down` : "not logged");
      zeroLine(Y(cut.top));
      if (control.cut && on("cut")) {
        ctx.fillStyle = "rgba(249,115,22,0.8)";
        for (let i = 1; i < t.length; i++) {
          const v = control.cut[i];
          if (!shown(i) || !(v > 0)) continue;
          const [bx, bw] = bar(i);
          ctx.fillRect(bx, Y(cut.top), bw, (v / cutMax) * cut.h * px);
        }
        const pc = peak(t, control.cut, 1);
        if (pc) label(`${pc.v.toFixed(1)}%`, X(pc.t) + 4 * px, Y(cut.top + (pc.v / cutMax) * cut.h + 8), C.cut);
      }

      // Timing. With the timed pull: pulls stack down from a zero line near
      // the top, adds go up drawn taller. Without it: the target's own part
      // around a centred zero line, on a scale its size.
      const timing = control.timing;
      let partMax = 4;
      if (timing) for (let i = 0; i < t.length; i++) if (shown(i) && Math.abs(timing[i]) > partMax) partMax = Math.ceil(Math.abs(timing[i]));
      const zeroY = Y(showTimed ? ign.top + ign.h * 0.2 : ign.top + ign.h / 2);
      const downPx = (showTimed ? (ign.h * 0.8) / PULL_SPAN_DEG : ign.h / 2 / partMax) * px;
      const upPx = showTimed ? downPx * ADD_GAIN : downPx;
      const upRoom = (showTimed ? ign.h * 0.2 : ign.h / 2) * px;
      partLabel(ign, "Timing", showTimed ? `0–${PULL_SPAN_DEG}° down · adds ×${ADD_GAIN}` : `±${partMax}°`);
      zeroLine(zeroY);
      for (let i = 1; i < t.length; i++) {
        if (!shown(i)) continue;
        const [bx, bw] = bar(i);
        const timed = showTimed ? num(view.timed?.[i]) : 0;
        const p = num(timing?.[i]);
        let down = 0;
        if (timed < 0) {
          ctx.fillStyle = "rgba(59,130,246,0.85)";
          ctx.fillRect(bx, zeroY, bw, -timed * downPx);
          down = -timed * downPx;
        }
        if (p < 0 && on("errPull")) {
          ctx.fillStyle = "rgba(147,197,253,0.9)";
          ctx.fillRect(bx, zeroY + down, bw, -p * downPx);
        }
        if (p > 0 && on("errAdd")) {
          const up = Math.min(p * upPx, upRoom);
          ctx.fillStyle = "rgba(245,158,11,0.9)";
          ctx.fillRect(bx, zeroY - up, bw, up);
        }
      }
      const deepest = showTimed ? peak(t, view.total, -1) : on("errPull") ? peak(t, timing, -1) : null;
      if (deepest) label(`−${Math.abs(deepest.v).toFixed(1)}°`, X(deepest.t) + 4 * px, zeroY - deepest.v * downPx + 8 * px, showTimed ? C.pull : C.pull2);
      const pa = on("errAdd") ? peak(t, timing, 1) : null;
      if (pa) label(`+${pa.v.toFixed(1)}°`, X(pa.t) + 4 * px, zeroY - Math.min(pa.v * upPx, upRoom) - 7 * px, C.add);

      // The launch and the timeslip checkpoints, as on every trace.
      ctx.lineWidth = (raceLine?.width ?? 1.5) * px;
      ctx.strokeStyle = raceLine?.color ?? "rgba(255, 255, 255, 0.75)";
      ctx.setLineDash((raceLine?.dash ?? [7, 5]).map((d) => d * px));
      ctx.beginPath();
      ctx.moveTo(X(0), top);
      ctx.lineTo(X(0), top + u.bbox.height);
      ctx.stroke();
      ctx.lineWidth = 1.25 * px;
      ctx.setLineDash([4.5 * px, 3.5 * px]);
      for (const zone of timeslipZones) {
        for (const region of zone.regions) {
          const x = u.valToPos(region.end, "x", true);
          ctx.strokeStyle = hexToRgba(region.color ?? zone.config.color, 0.6);
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + u.bbox.height);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    // Race time and distance at the cursor, as the traces show it.
    const raceLabel = document.createElement("div");
    raceLabel.style.cssText =
      "position:absolute;bottom:8px;display:none;pointer-events:none;z-index:10;" +
      "padding:1px 6px;font-size:13px;line-height:18px;white-space:nowrap;" +
      "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;" +
      "color:#4ade80;background:#18181b;border:1px solid rgba(74,222,128,0.35);border-radius:4px;";
    const slip = findSlipAtLaunch(timeslipZones, launchAt);

    const u = new uPlot(
      {
        width: chartWidth,
        height,
        padding: [0, 0, 0, 0],
        legend: { show: false },
        cursor: { sync: { key: syncKey, scales: ["x", null] }, y: false, points: { show: false }, drag: { x: false, y: false } },
        scales: { x: { time: false, range: () => cb.current.xRange }, y: { range: () => [0, 1] } },
        axes: [
          { show: false, size: 0 },
          { show: false, scale: "y", size: 0 },
        ],
        series: [{}, { scale: "y", show: false }],
        hooks: {
          draw: [draw],
          setCursor: [
            (u) => {
              const left = u.cursor.left;
              if (left != null && left >= 0) {
                const time = u.posToVal(left, "x");
                cb.current.onCursorTime(time);
                const feet = slip ? distanceAtTime(slip, time) : null;
                raceLabel.textContent = `${(time - launchAt).toFixed(3)}s${feet != null ? `  ${Math.round(feet)} ft` : ""}`;
                const lw = raceLabel.offsetWidth;
                raceLabel.style.left = `${Math.min(Math.max(left - lw / 2, 2), u.over.clientWidth - lw - 2)}px`;
                raceLabel.style.display = "block";
              } else {
                raceLabel.style.display = "none";
              }
            },
          ],
        },
      },
      [cb.current.xRange.slice() as number[], [null, null]],
      el,
    );
    const over = u.over;
    over.appendChild(raceLabel);

    // The receipt for the part under the pointer.
    const onMove = (e: MouseEvent) => {
      const time = u.posToVal(e.offsetX, "x") - launchAt;
      const lane = (Object.keys(parts) as Lane[]).find((k) => e.offsetY >= parts[k].top - PART_LABEL_H && e.offsetY <= parts[k].top + parts[k].h);
      setTip(lane ? { x: e.clientX, y: e.clientY, content: <Receipt r={receiptFor(lane, view, control, time, cb.current.showTimed)} /> } : null);
    };
    const onLeave = () => setTip(null);

    // Cursor-centred wheel zoom on the shared clock, as on the traces.
    const onWheel = (e: WheelEvent) => {
      const c = cb.current;
      if (c.wheelZoomEnabled === false) return;
      const wantsZoom = (c.wheelMode ?? "zoom") === "zoom" ? !e.shiftKey : e.ctrlKey || e.metaKey || e.shiftKey;
      if (!wantsZoom) return;
      const factorOut = c.wheelZoomFactor ?? 1.25;
      const factor = e.deltaY > 0 ? factorOut : 1 / factorOut;
      const rect = over.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const [curMin, curMax] = c.xRange;
      const center = curMin + frac * (curMax - curMin);
      const half = ((curMax - curMin) * factor) / 2;
      const next = clampWheelRange(center - half, center + half, c.globalRange);
      if (next === null) {
        if (curMin <= c.globalRange[0] && curMax >= c.globalRange[1]) return;
        e.preventDefault();
        c.onResetZoom();
      } else {
        e.preventDefault();
        c.onZoom(next[0], next[1]);
      }
    };
    over.addEventListener("mousemove", onMove);
    over.addEventListener("mouseleave", onLeave);
    over.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      over.removeEventListener("mousemove", onMove);
      over.removeEventListener("mouseleave", onLeave);
      over.removeEventListener("wheel", onWheel);
      u.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, control, hidden, chartWidth, height, xRange[0], xRange[1], launchAt, timeslipZones, syncKey, raceLine]);

  if (!view || !control || launchAt === null) return null;

  // The channels panel's values at the shared cursor.
  const i = cursorTime !== null && cursorTime - launchAt >= 0 ? indexAt(view.t, cursorTime - launchAt) : -1;
  const valueOf = (k: LineKey): string => {
    if (i < 0) return "---";
    const e = num(control.error[i]);
    const p = num(control.timing?.[i]);
    switch (k) {
      case "rpm":
        return String(Math.round(num(control.actual[i])));
      case "target":
        return String(Math.round(num(control.target[i])));
      case "over":
        return e > 0 ? String(Math.round(e)) : "—";
      case "under":
        return e < 0 ? String(Math.round(-e)) : "—";
      case "cut":
        return control.cut ? `${num(control.cut[i]).toFixed(1)}` : "—";
      case "timed":
        return view.timed ? deg(num(view.timed[i])) : "—";
      case "errPull":
        return p < 0 ? deg(p) : "—";
      case "errAdd":
        return p > 0 ? deg(p) : "—";
    }
  };
  const unitOf: Partial<Record<LineKey, string>> = { rpm: "RPM", target: "RPM", over: "RPM", under: "RPM", cut: "%" };
  const short = control.kind === "engine" ? "RPM" : "DS";
  // Each group sits beside its part of the chart.
  const parts = layout(height);
  const groups: { lane: Lane; heading: string; rows: { key: LineKey; label: string; color: string }[] }[] = [
    {
      lane: "rpm",
      heading: control.label,
      rows: [
        { key: "rpm", label: control.label, color: C.rpm },
        { key: "target", label: "target", color: C.target },
      ],
    },
    {
      lane: "err",
      heading: "Over / under target",
      rows: [
        { key: "over", label: "over target", color: C.over },
        { key: "under", label: "under target", color: C.under },
      ],
    },
    ...(control.cut ? [{ lane: "cut" as const, heading: "Power cut", rows: [{ key: "cut" as const, label: "cut", color: C.cut }] }] : []),
    {
      lane: "ign",
      heading: "Timing",
      rows: [
        ...(view.timed ? [{ key: "timed" as const, label: "timed pull", color: C.pull }] : []),
        { key: "errPull", label: `${short} over-target pull`, color: C.pull2 },
        { key: "errAdd", label: `${short} under-target add`, color: C.add },
      ],
    },
  ];

  return (
    <div className="mb-2 flex min-h-[520px] flex-1 flex-col rounded-lg border border-border">
      <div className="flex shrink-0 items-center gap-1.5 rounded-t-lg border-b bg-muted px-2 py-1">
        <span className="text-xs font-medium">Torque management</span>
        {views.length > 1 &&
          views.map((v, k) => (
            <button
              key={v.log.fileId}
              type="button"
              onClick={() => setRunId(v.log.fileId)}
              className={`${HDR_PILL} ${v === current ? HDR_PILL_ON : HDR_PILL_OFF}`}
            >
              <i className="inline-block size-2 rounded-full" style={{ background: v.log.logColor }} />
              {labels[k]}
            </button>
          ))}
        {view.controls.length > 1 &&
          view.controls.map((c) => (
            <button key={c.kind} type="button" onClick={() => setKind(c.kind)} className={`${HDR_PILL} ${c === control ? HDR_PILL_ON : HDR_PILL_OFF}`}>
              {c.label}
            </button>
          ))}
        {view.knob !== null && <span className="text-[11px] text-muted-foreground">Knob {view.knob}</span>}
        <div className="flex-1" />
        {passWindow && (
          <Tip content="Zoom to the pass — half a second either side of the run">
            <button onClick={() => onZoom(passWindow[0], passWindow[1])} className={`${HDR_PILL} ${HDR_PILL_OFF}`}>
              <MoveHorizontalIcon className="size-3.5 shrink-0" />
              Fit to pass
            </button>
          </Tip>
        )}
      </div>
      <div ref={areaRef} className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div ref={plotRef} />
        </div>
        <div className="relative shrink-0 select-none overflow-hidden border-l border-border bg-black/25" style={{ width: panelWidth }}>
          {!legendCollapsed && <PanelResizeHandle width={panelWidth} onSetWidth={onSetLegendWidth} />}
          {!legendCollapsed &&
            groups.map((g) => {
              const keys = g.rows.map((r) => r.key);
              const shownCount = keys.filter(on).length;
              return (
                <div key={g.heading} className="absolute inset-x-1" style={{ top: parts[g.lane].top - PART_LABEL_H + 2 }}>
                  <LegendHeading
                    text={g.heading}
                    toggle={
                      keys.length > 1
                        ? { checked: shownCount > 0, mixed: shownCount > 0 && shownCount < keys.length, onChange: () => toggle(keys, shownCount === 0) }
                        : undefined
                    }
                  />
                  {g.rows.map((r) => (
                    <div key={r.key} className="flex items-center gap-1.5 pl-2 text-xs leading-tight">
                      <Switch checked={on(r.key)} color={r.color} onChange={(show) => toggle([r.key], show)} title={on(r.key) ? `Hide ${r.label}` : `Show ${r.label}`} />
                      <Tip content={ROW_TIPS[r.key]} side="left">
                        <span className="min-w-0 flex-1 truncate text-white/70">{r.label}</span>
                      </Tip>
                      <span className="shrink-0 font-mono tabular-nums text-white">{valueOf(r.key)}</span>
                      <span className="w-7 shrink-0 text-[10px] text-muted-foreground">{unitOf[r.key] ?? ""}</span>
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      </div>
      {tip && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-white/15 bg-[#1a1a1a] px-3 py-2 text-xs leading-relaxed text-white/85 shadow-xl"
          style={{ left: Math.min(tip.x + 16, window.innerWidth - 320), top: Math.min(tip.y + 16, window.innerHeight - 200) }}
        >
          {tip.content}
        </div>
      )}
    </div>
  );
}

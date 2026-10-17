import { useEffect, useMemo, useRef, useState } from "react";
import type { LoadedLog } from "@/lib/viewer-types";
import { readTorqueView, type TorqueControl, type TorqueView } from "@/lib/torque-view";
import { runLabels } from "@/lib/run-tags";

const C = {
  rpm: "#e5e5e5",
  target: "#a3a3a3",
  over: "#ef4444",
  under: "#3b82f6",
  cut: "#f97316",
  pull: "#3b82f6",
  pull2: "#93c5fd",
  add: "#f59e0b",
  grid: "#262626",
  zero: "#3a3a3a",
  mute: "#8a8a8a",
};

/** Per viewer: whether the timing part includes the timed table's pull. */
const SHOW_TIMED_KEY = "dragtrace.torque.showTimed";
const LEGEND_H = 22;
const GAP = 14;
const RULER_H = 22;
/** RPM over or under target that fills its part. */
const ERROR_SPAN = 500;
/** Timing pull that fills the timing part below its zero line, with the timed table shown. */
const PULL_SPAN_DEG = 20;
/** Adds are a fraction of a degree beside a pull of fifteen: drawn this much taller to be seen. */
const ADD_GAIN = 3;

type Lane = "rpm" | "err" | "cut" | "ign";
interface Part {
  legend: number;
  top: number;
  h: number;
}

/** Each part's place, sharing the height so the chart never flattens: RPM most, the cut least. */
function layout(h: number): Record<Lane, Part> {
  const usable = h - RULER_H - GAP * 3 - LEGEND_H * 4;
  const part = (y: number, share: number): Part => ({ legend: y, top: y + LEGEND_H, h: usable * share });
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

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign = "left") {
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(10,10,10,0.9)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

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

/** The hover receipt for one part at one moment. */
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
    note: showTimed ? "Minus takes timing out (less power); plus puts it back." : "The timed table is hidden from the chart; it still counts in the total.",
  };
}

const LEGEND_TIPS: Record<string, string> = {
  rpm: "Engine or driveshaft speed, from the log.",
  target: "The speed torque management wants at each moment after the launch, from the tune's target table at the knob setting.",
  over: "Spinning faster than the tune wants. This is what makes torque management act: it cuts power and pulls timing until it comes back down to target.",
  under: "Slower than the tune wants. Torque management stops cutting, and can add timing back to help it catch up.",
  cut: "The share of firing events the ECU skips to take power away. 3.5% is about 1 in 30. It only cuts while over target. Drawn hanging down because it takes power away.",
  timed: "Timing the timed table takes out: it pulls by time after the launch, whatever RPM is doing. The knob picks the row. Click to hide it and see just the part that answers to the target.",
  errPull: "Extra timing taken out because it's over target. The further over, the more it pulls.",
  errAdd: "Timing put back because it's under target, to help it catch up.",
};

/**
 * The Torque Mgmt tab: what torque management did through the pass, top to
 * bottom as cause and effect — the RPM against its target, how far over or
 * under it ran, then everything that takes power away hanging down (the cut,
 * the timing pull) and anything that adds power going up. Hovering any part
 * gives a receipt of that moment, its parts adding up to the total.
 */
export function TorquePanel({ logs }: { logs: LoadedLog[] }) {
  const views = useMemo(() => logs.map((l) => ({ log: l, view: readTorqueView(l) })).filter((x) => x.view), [logs]);
  const labels = useMemo(() => runLabels(views.map((v) => v.log.fileName)), [views]);
  const [runId, setRunId] = useState<string | null>(null);
  const current = views.find((v) => v.log.fileId === runId) ?? views[0];
  const view = current?.view ?? null;
  const [kind, setKind] = useState<TorqueControl["kind"] | null>(null);
  const control = view ? (view.controls.find((c) => c.kind === kind) ?? view.controls[0]) : null;
  const [showTimed, setShowTimedState] = useState(() => {
    try {
      return localStorage.getItem(SHOW_TIMED_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const setShowTimed = (v: boolean) => {
    setShowTimedState(v);
    try {
      localStorage.setItem(SHOW_TIMED_KEY, v ? "1" : "0");
    } catch {
      // A blocked store only means the choice isn't remembered.
    }
  };

  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: Math.max(480, entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [cursor, setCursor] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  const parts = useMemo(() => layout(size.h), [size.h]);
  const [t0, t1] = view?.window ?? [0, 1];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || !control || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const { t } = view;
    const { rpm, err, cut, ign } = parts;
    const x = (s: number) => ((s - t0) / (t1 - t0)) * size.w;
    const bar = (i: number) => [x(t[i - 1]), x(t[i]) - x(t[i - 1]) + 0.5] as const;
    const shown = (i: number) => t[i] >= 0 && t[i] <= t1;

    // Time ruler, every half second from the launch.
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let s = 0; s <= t1; s += 0.5) {
      ctx.beginPath();
      ctx.moveTo(x(s), rpm.top);
      ctx.lineTo(x(s), size.h - RULER_H);
      ctx.stroke();
      label(ctx, s === 0 ? "launch" : `${String(s).replace(/^0/, "")}s`, x(s) + 3, size.h - RULER_H / 2, C.mute);
    }

    // RPM against its target, from the launch, the gap between them filled.
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
    const yR = (v: number) => rpm.top + rpm.h - ((v - lo) / (hi - lo)) * rpm.h;
    for (let i = 1; i < t.length; i++) {
      const a = control.actual[i];
      const b = control.target[i];
      if (!shown(i) || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      const [bx, bw] = bar(i);
      ctx.fillStyle = a > b ? "rgba(239,68,68,0.45)" : "rgba(59,130,246,0.22)";
      ctx.fillRect(bx, Math.min(yR(a), yR(b)), bw, Math.abs(yR(a) - yR(b)));
    }
    const line = (v: Float64Array, color: string, dash: number[]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let on = false;
      for (let i = 0; i < t.length; i++) {
        if (!shown(i) || !Number.isFinite(v[i])) {
          on = false;
          continue;
        }
        if (on) ctx.lineTo(x(t[i]), yR(v[i]));
        else ctx.moveTo(x(t[i]), yR(v[i]));
        on = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(control.target, C.target, [5, 4]);
    line(control.actual, C.rpm, []);

    // Over or under target, around its zero line.
    const errMid = err.top + err.h / 2;
    const errPx = err.h / 2 / ERROR_SPAN;
    ctx.strokeStyle = C.zero;
    ctx.beginPath();
    ctx.moveTo(0, errMid);
    ctx.lineTo(size.w, errMid);
    ctx.stroke();
    for (let i = 1; i < t.length; i++) {
      const v = control.error[i];
      if (!shown(i) || !Number.isFinite(v)) continue;
      const c = Math.max(-ERROR_SPAN, Math.min(ERROR_SPAN, v));
      const [bx, bw] = bar(i);
      ctx.fillStyle = v > 0 ? "rgba(239,68,68,0.8)" : "rgba(59,130,246,0.4)";
      ctx.fillRect(bx, v > 0 ? errMid - c * errPx : errMid, bw, Math.abs(c) * errPx);
    }
    const over = peak(t, control.error, 1);
    if (over) label(ctx, `+${Math.round(over.v)}`, x(over.t) + 4, errMid - Math.min(ERROR_SPAN, over.v) * errPx - 6, C.over);

    // Power cut, hanging down from its zero line.
    ctx.strokeStyle = C.zero;
    ctx.beginPath();
    ctx.moveTo(0, cut.top);
    ctx.lineTo(size.w, cut.top);
    ctx.stroke();
    let cutMax = 5;
    if (control.cut) for (let i = 0; i < t.length; i++) if (shown(i) && control.cut[i] > cutMax) cutMax = control.cut[i];
    if (control.cut) {
      ctx.fillStyle = "rgba(249,115,22,0.8)";
      for (let i = 1; i < t.length; i++) {
        const v = control.cut[i];
        if (!shown(i) || !(v > 0)) continue;
        const [bx, bw] = bar(i);
        ctx.fillRect(bx, cut.top, bw, (v / cutMax) * cut.h);
      }
      const pc = peak(t, control.cut, 1);
      if (pc) label(ctx, `${pc.v.toFixed(1)}%`, x(pc.t) + 4, cut.top + (pc.v / cutMax) * cut.h + 8, C.cut);
    }

    // Timing. With the timed table: pulls stack down from a zero line near
    // the top, adds go up, drawn taller. Without it: the target's own part
    // around a centred zero line, on a scale its size.
    const part = control.timing;
    let partMax = 4;
    if (part) for (let i = 0; i < t.length; i++) if (shown(i) && Math.abs(part[i]) > partMax) partMax = Math.ceil(Math.abs(part[i]));
    const zeroY = showTimed ? ign.top + ign.h * 0.2 : ign.top + ign.h / 2;
    const downPx = showTimed ? (ign.h * 0.8) / PULL_SPAN_DEG : ign.h / 2 / partMax;
    const upPx = showTimed ? downPx * ADD_GAIN : downPx;
    const upRoom = showTimed ? ign.h * 0.2 : ign.h / 2;
    ctx.strokeStyle = C.zero;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(size.w, zeroY);
    ctx.stroke();
    for (let i = 1; i < t.length; i++) {
      if (!shown(i)) continue;
      const [bx, bw] = bar(i);
      const timed = showTimed ? num(view.timed?.[i]) : 0;
      const p = num(part?.[i]);
      let down = 0;
      if (timed < 0) {
        ctx.fillStyle = "rgba(59,130,246,0.85)";
        ctx.fillRect(bx, zeroY, bw, -timed * downPx);
        down = -timed * downPx;
      }
      if (p < 0) {
        ctx.fillStyle = "rgba(147,197,253,0.9)";
        ctx.fillRect(bx, zeroY + down, bw, -p * downPx);
      }
      if (p > 0) {
        const up = Math.min(p * upPx, upRoom);
        ctx.fillStyle = "rgba(245,158,11,0.9)";
        ctx.fillRect(bx, zeroY - up, bw, up);
      }
    }
    if (showTimed) {
      const pt = peak(t, view.total, -1);
      if (pt) label(ctx, `−${Math.abs(pt.v).toFixed(1)}°`, x(pt.t) + 4, zeroY - pt.v * downPx + 8, C.pull);
    } else {
      const pp = peak(t, part, -1);
      if (pp) label(ctx, `−${Math.abs(pp.v).toFixed(1)}°`, x(pp.t) + 4, zeroY - pp.v * downPx + 8, C.pull2);
    }
    const pa = peak(t, part, 1);
    if (pa) label(ctx, `+${pa.v.toFixed(1)}°`, x(pa.t) + 4, zeroY - Math.min(pa.v * upPx, upRoom) - 7, C.add);

    if (cursor !== null) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.moveTo(x(cursor), rpm.top);
      ctx.lineTo(x(cursor), size.h - RULER_H);
      ctx.stroke();
    }
  }, [view, control, size, parts, cursor, showTimed, t0, t1]);

  if (!view || !control) return null;
  const partMaxLabel = (() => {
    let m = 4;
    if (control.timing) for (let i = 0; i < view.t.length; i++) if (view.t[i] >= 0 && Math.abs(control.timing[i]) > m) m = Math.ceil(Math.abs(control.timing[i]));
    return m;
  })();
  const legendTip = (key: string) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content: <div className="max-w-[300px]">{LEGEND_TIPS[key]}</div> }),
    onMouseLeave: () => setTip(null),
  });
  const item = "pointer-events-auto inline-flex cursor-help items-center gap-1.5 rounded bg-card/85 px-1 text-xs text-white/80";
  const swatch = (color: string, opacity = 1) => <i className="inline-block size-2.5 rounded-[2px]" style={{ background: color, opacity }} />;
  const name = "text-[11px] font-semibold uppercase tracking-wide text-foreground";
  const scale = "font-mono text-[11px] text-muted-foreground";
  const legendAt = (lane: Lane) => ({ top: parts[lane].legend + 2 });
  const short = control.kind === "engine" ? "RPM" : "driveshaft";

  return (
    <div className="mb-2 flex min-h-[560px] flex-1 flex-col rounded-lg border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Torque management</span>
        {views.length > 1 &&
          views.map((v, i) => (
            <button
              key={v.log.fileId}
              type="button"
              onClick={() => setRunId(v.log.fileId)}
              className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs ${v === current ? "border-white/40 bg-white/10" : "border-border hover:bg-white/5"}`}
              style={{ borderLeftColor: v.log.logColor, borderLeftWidth: 3 }}
            >
              {labels[i]}
            </button>
          ))}
        {view.controls.length > 1 &&
          view.controls.map((c) => (
            <button
              key={c.kind}
              type="button"
              onClick={() => setKind(c.kind)}
              className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs ${c === control ? "border-white/40 bg-white/10" : "border-border hover:bg-white/5"}`}
            >
              {c.label}
            </button>
          ))}
        {view.knob !== null && <span className="text-xs text-muted-foreground">Knob {view.knob}</span>}
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ width: size.w, height: size.h }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
            const y = e.clientY - r.top;
            setCursor(t);
            const lane = (Object.keys(parts) as Lane[]).find((k) => y >= parts[k].legend && y <= parts[k].top + parts[k].h);
            setTip(lane ? { x: e.clientX, y: e.clientY, content: <Receipt r={receiptFor(lane, view, control, t, showTimed)} /> } : null);
          }}
          onMouseLeave={() => {
            setCursor(null);
            setTip(null);
          }}
        />
        <div className="pointer-events-none absolute left-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1" style={legendAt("rpm")}>
          <span className={name}>{control.label}</span>
          <span className={item} {...legendTip("rpm")}>
            <i className="inline-block w-3.5 border-t-2" style={{ borderColor: C.rpm }} />
            {control.label}
          </span>
          <span className={item} {...legendTip("target")}>
            <i className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: C.target }} />
            target
          </span>
        </div>
        <div className="pointer-events-none absolute left-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1" style={legendAt("err")}>
          <span className={name}>Over / under target</span>
          <span className={item} {...legendTip("over")}>
            {swatch(C.over)}
            over target
          </span>
          <span className={item} {...legendTip("under")}>
            {swatch(C.under, 0.6)}
            under target
          </span>
          <span className={scale}>±{ERROR_SPAN} rpm</span>
        </div>
        <div className="pointer-events-none absolute left-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1" style={legendAt("cut")}>
          <span className={name}>Power cut</span>
          <span className={item} {...legendTip("cut")}>
            {swatch(C.cut)}
            cut
          </span>
          <span className={scale}>{control.cut ? "0–5% down" : "not logged"}</span>
        </div>
        <div className="pointer-events-none absolute left-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1" style={legendAt("ign")}>
          <span className={name}>Timing</span>
          {view.timed && (
            <button type="button" className={`${item} cursor-pointer ${showTimed ? "" : "opacity-45 line-through"}`} onClick={() => setShowTimed(!showTimed)} {...legendTip("timed")}>
              {swatch(C.pull, showTimed ? 1 : 0.4)}
              timed pull
            </button>
          )}
          <span className={item} {...legendTip("errPull")}>
            {swatch(C.pull2)}
            pull for {short} over target
          </span>
          <span className={item} {...legendTip("errAdd")}>
            {swatch(C.add)}
            added for {short} under target
          </span>
          <span className={scale}>{showTimed ? `0–${PULL_SPAN_DEG}° down · adds drawn ×${ADD_GAIN}` : `±${partMaxLabel}°`}</span>
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

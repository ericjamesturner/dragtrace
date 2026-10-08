/**
 * Automatic markers on a channel's line: its value at set times after launch,
 * and the RPM it fell from and to on each shift. All times here are in the
 * log's own timeline — the same one as `LogSession.timestamps`.
 */

import type { ChannelDef } from "./log-types";

export interface ChannelMarkers {
  /** Seconds after launch to read the channel at, e.g. [0.1, 0.25, 0.5]. */
  times?: number[];
  /** Mark each upshift: the value it fell from and the low point after. */
  shifts?: boolean;
}

/** Offered when a channel's time markers are first switched on. */
export const DEFAULT_MARKER_TIMES = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2];

/** "0.1, .25 0.5" -> [0.1, 0.25, 0.5]; anything unreadable or negative is dropped. */
export function parseMarkerTimes(text: string): number[] {
  const out = text
    .split(/[\s,;]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return [...new Set(out)].sort((a, b) => a - b);
}

export function formatMarkerTimes(times: number[]): string {
  return times.join(", ");
}

/** Linear interpolation at `t`; null outside the samples or across a gap. */
export function valueAt(ts: Float64Array, vals: Float64Array, t: number): number | null {
  const n = ts.length;
  if (n === 0 || t < ts[0] || t > ts[n - 1]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const v0 = vals[lo];
  const v1 = vals[hi];
  if (v0 !== v0 && v1 !== v1) return null;
  if (v0 !== v0) return v1;
  if (v1 !== v1 || ts[hi] === ts[lo]) return v0;
  return v0 + ((t - ts[lo]) / (ts[hi] - ts[lo])) * (v1 - v0);
}

export interface TimeMarker {
  /** Seconds after launch. */
  after: number;
  t: number;
  value: number;
}

export function timeMarkers(
  ts: Float64Array,
  vals: Float64Array,
  launch: number,
  times: number[],
): TimeMarker[] {
  const out: TimeMarker[] = [];
  for (const after of times) {
    const t = launch + after;
    const value = valueAt(ts, vals, t);
    if (value !== null) out.push({ after, t, value });
  }
  return out;
}

export interface ShiftMarker {
  /** Where the value peaked going into the shift. */
  peakT: number;
  peak: number;
  /** The low point the shift pulled it down to. */
  troughT: number;
  trough: number;
  /** Gears either side, when a gear channel says so. */
  from?: number;
  to?: number;
}

/**
 * A channel that reports the engaged gear. Name-based so it holds for any ECU
 * that logs one; the parts of a transmission that merely mention gears
 * (targets, ratios, the selector) are not it.
 */
export function findGearChannel(defs: ChannelDef[]): string | undefined {
  const exact = defs.find((d) => /^gear$/i.test(d.name.trim()));
  if (exact) return exact.name;
  return defs.find(
    (d) =>
      /\bgear\b/i.test(d.name) &&
      !/target|ratio|selector|request|oil|temp|pressure|shift|detect/i.test(d.name),
  )?.name;
}

/**
 * A channel that reports throttle opening, used to tell a shift (throttle
 * held) from the driver lifting (throttle closed). Pedal position stands in
 * where there's no throttle reading.
 */
export function findThrottleChannel(defs: ChannelDef[]): string | undefined {
  return (
    defs.find((d) => /^throttle position$/i.test(d.name.trim()))?.name ??
    defs.find((d) => /\b(throttle position|tps)\b/i.test(d.name) && !/derivative|filter|target|cable/i.test(d.name))?.name ??
    defs.find((d) => /pedal position/i.test(d.name) && !/source|derivative/i.test(d.name))?.name
  );
}

/** How far either side of a gear change to look for the peak and the dip. */
const PEAK_BEFORE_S = 0.5;
const PEAK_AFTER_S = 0.1;
/** A converter-slip automatic takes most of half a second to pull down. */
const TROUGH_WINDOW_S = 0.7;
/** No car is in second gear this soon after launch. */
const EARLIEST_SHIFT_S = 0.5;
/** Throttle held above this share of its pass maximum counts as wide open. */
const WOT_FRACTION = 0.8;
/** A pass is over well before this; later "shifts" are the shutdown. */
const PASS_LENGTH_S = 15;
/**
 * Without a gear channel: the smallest fall, as a share of the pass's peak,
 * that counts. An automatic slipping its converter only drops 4–7%.
 */
const MIN_DROP_FRACTION = 0.03;
/** ...and it has to start climbing again: a tall top gear recovers slowly. */
const MIN_RECOVERY_FRACTION = 0.005;
/**
 * A shift pulls RPM down by the ratio step — even a wide 1.76 first gear
 * leaves well over half. Lifting at the stripe falls toward idle.
 */
const MIN_TROUGH_FRACTION = 0.45;
const RECOVERY_WINDOW_S = 1;
/** Shifts closer together than this are one shift. */
const MIN_SHIFT_SPACING_S = 0.5;

function extremeIn(
  ts: Float64Array,
  vals: Float64Array,
  from: number,
  to: number,
  pick: "max" | "min",
): { t: number; v: number } | null {
  let best: { t: number; v: number } | null = null;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] < from) continue;
    if (ts[i] > to) break;
    const v = vals[i];
    if (v !== v) continue;
    if (!best || (pick === "max" ? v > best.v : v < best.v)) best = { t: ts[i], v };
  }
  return best;
}

/**
 * Upshifts during the pass. With a gear channel, each step up in gear is a
 * shift and the peak and dip are read around it — the gear reading itself can
 * lag the RPM by a sample or two. Without one, a shift is a fall of at least
 * MIN_DROP_FRACTION of the pass's peak, taken with the throttle still wide
 * open, that stays above MIN_TROUGH_FRACTION of where it fell from and starts
 * climbing again within a second. A fall with the throttle closing is the
 * driver lifting, not a shift.
 */
export function shiftMarkers(
  ts: Float64Array,
  vals: Float64Array,
  launch: number,
  gear?: Float64Array,
  throttle?: Float64Array,
): ShiftMarker[] {
  const end = launch + PASS_LENGTH_S;
  const out: ShiftMarker[] = [];

  if (gear) {
    let prev = NaN;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] < launch) {
        if (gear[i] === gear[i]) prev = gear[i];
        continue;
      }
      if (ts[i] > end) break;
      const g = gear[i];
      if (g !== g) continue;
      if (prev === prev && g > prev && prev >= 1) {
        const at = ts[i];
        const peak = extremeIn(ts, vals, at - PEAK_BEFORE_S, at + PEAK_AFTER_S, "max");
        const trough = peak && extremeIn(ts, vals, peak.t, peak.t + TROUGH_WINDOW_S, "min");
        const last = out[out.length - 1];
        if (peak && trough && trough.v < peak.v && (!last || peak.t - last.peakT >= MIN_SHIFT_SPACING_S)) {
          out.push({ peakT: peak.t, peak: peak.v, troughT: trough.t, trough: trough.v, from: prev, to: g });
        }
      }
      prev = g;
    }
    return out;
  }

  const passPeak = extremeIn(ts, vals, launch, end, "max");
  if (!passPeak || passPeak.v <= 0) return out;
  const minDrop = passPeak.v * MIN_DROP_FRACTION;
  const minRecovery = passPeak.v * MIN_RECOVERY_FRACTION;
  const throttlePeak = throttle ? extremeIn(ts, throttle, launch, end, "max") : null;
  const wideOpen = (from: number, to: number) => {
    if (!throttle || !throttlePeak) return true;
    const low = extremeIn(ts, throttle, from, to, "min");
    return !low || low.v >= throttlePeak.v * WOT_FRACTION;
  };

  let i = ts.findIndex((t) => t >= launch + EARLIEST_SHIFT_S);
  if (i < 0) return out;
  while (i < ts.length && ts[i] <= end) {
    // Walk to a local peak: the next sample that the following ones fall from.
    const v = vals[i];
    if (v !== v) { i++; continue; }
    const before = extremeIn(ts, vals, ts[i], ts[i] + PEAK_AFTER_S, "max");
    const firstDip = extremeIn(ts, vals, ts[i], ts[i] + TROUGH_WINDOW_S, "min");
    // A small local peak can sit just ahead of the real one — the flare as
    // the shift begins. Measure from the highest point before the fall, and
    // to the lowest point after that.
    const top = firstDip && extremeIn(ts, vals, ts[i], firstDip.t, "max");
    const trough = top && extremeIn(ts, vals, top.t, top.t + TROUGH_WINDOW_S, "min");
    if (
      // Shifts happen near the top of the rev range, not at idle after the pass.
      v < passPeak.v / 2 ||
      !top || !trough || !before || before.t !== ts[i] ||
      top.v - trough.v < minDrop || trough.v < top.v * MIN_TROUGH_FRACTION
    ) { i++; continue; }
    const recovered = extremeIn(ts, vals, trough.t, trough.t + RECOVERY_WINDOW_S, "max");
    if (recovered && recovered.v - trough.v >= minRecovery && wideOpen(top.t, trough.t)) {
      out.push({ peakT: top.t, peak: top.v, troughT: trough.t, trough: trough.v });
      // Past this shift before looking for the next.
      const resume = trough.t + MIN_SHIFT_SPACING_S;
      while (i < ts.length && ts[i] < resume) i++;
      continue;
    }
    i++;
  }
  return out;
}

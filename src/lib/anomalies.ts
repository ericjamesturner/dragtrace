import type { LogSession, ParsedLog } from "./log-types";
import { findThrottleChannel } from "./channel-markers";

/**
 * Supply pressures and battery voltage through the pass, and the passes where
 * one fell lower than it normally does. A fixed limit can't do this: on one
 * truck the transmission line pressure falls a third at every shift and the
 * coolant pressure two thirds, both fine, while a fuel pressure that fell a
 * fifth was the real problem. So each pass is judged against the same
 * vehicle's other passes.
 */

/** One channel's level on the line and its low point during the pass. Stored with the preview. */
export interface PassLevel {
  name: string;
  quantitySlug?: string;
  /** Average over the half second before the launch. */
  base: number;
  /** Lowest point during the pass, smoothed over SMOOTH_S so one bad sample can't set it. */
  min: number;
  /** Seconds after the launch the low point came. */
  minAt: number;
}

/** Pressures that are commanded, atmospheric or follow the boost — not a supply that can fail. */
const NOT_SUPPLY = /manifold|\bmap\b|baro|atmos|exhaust|exh\b|target|expected|desired|differential|error|crank|airbox|boost|wastegate|ratio|derivative|uncal/i;
const BASE_WINDOW_S = 0.5;
const SMOOTH_S = 0.025;
/**
 * Only the wide-open part of the pass is judged: it ends the first time the
 * throttle falls under this share of its peak. A pressure low after a pedal or
 * a lift is the driver, not a failure — one pedaled pass dropped its converter
 * pressure to 33 psi, where every flat pass held 51 or more.
 */
const LIFT_FRACTION = 0.9;
/** The throttle is still opening this long after the release on some cars. */
const THROTTLE_SETTLE_S = 0.3;
const MAX_PASS_S = 8;

function isWatched(name: string, quantitySlug: string | undefined): boolean {
  if (/battery voltage/i.test(name)) return true;
  return quantitySlug === "pressure" && /pressure/i.test(name) && !NOT_SUPPLY.test(name);
}

export function readLevels(parsed: ParsedLog, session: LogSession, launchAt: number, raceEnd: number | null): PassLevel[] {
  const ts = session.timestamps;
  const throttleName = findThrottleChannel(parsed.channelDefs);
  const throttle = throttleName ? session.channels.get(throttleName) : undefined;
  let passEnd = Math.min(raceEnd ?? launchAt + MAX_PASS_S, launchAt + MAX_PASS_S);
  if (throttle) {
    let peak = 0;
    for (let i = lowerBound(ts, launchAt); i < ts.length && ts[i] <= launchAt + MAX_PASS_S; i++) {
      if (Number.isFinite(throttle[i]) && throttle[i] > peak) peak = throttle[i];
    }
    for (let i = lowerBound(ts, launchAt + THROTTLE_SETTLE_S); i < ts.length && ts[i] <= launchAt + MAX_PASS_S; i++) {
      if (Number.isFinite(throttle[i]) && throttle[i] < peak * LIFT_FRACTION) {
        passEnd = ts[i];
        break;
      }
    }
  }

  const out: PassLevel[] = [];
  for (const def of parsed.channelDefs) {
    if (!isWatched(def.name, def.quantitySlug)) continue;
    const vals = session.channels.get(def.name);
    if (!vals) continue;
    // A channel that faulted for most of the log has nothing to judge by.
    const status = session.channelStatus.get(def.name);
    if (status && status.samples > status.rowCount / 2) continue;

    let sum = 0;
    let n = 0;
    for (let i = lowerBound(ts, launchAt - BASE_WINDOW_S); i < ts.length && ts[i] < launchAt; i++) {
      if (Number.isFinite(vals[i])) {
        sum += vals[i];
        n++;
      }
    }
    if (n === 0) continue;

    let min = Infinity;
    let minAt = 0;
    const start = lowerBound(ts, launchAt + 0.05);
    for (let i = start; i < ts.length && ts[i] <= passEnd; i++) {
      // Median of the samples in the next SMOOTH_S: a dip has to last to count.
      const window: number[] = [];
      for (let j = i; j < ts.length && ts[j] <= ts[i] + SMOOTH_S; j++) {
        if (Number.isFinite(vals[j])) window.push(vals[j]);
      }
      if (window.length === 0) continue;
      window.sort((a, b) => a - b);
      const m = window[window.length >> 1];
      if (m < min) {
        min = m;
        minAt = ts[i] - launchAt;
      }
    }
    if (!Number.isFinite(min)) continue;
    out.push({ name: def.name, quantitySlug: def.quantitySlug, base: sum / n, min, minAt });
  }
  return out;
}

export interface Anomaly {
  level: PassLevel;
  /** The vehicle's usual low point for this channel, from its other passes. */
  usualMin: number;
}

/** Fewer reference passes than this and there's no "usual" to judge by. */
const MIN_REFS = 3;
/** Smallest fall below the usual low that counts, as a share of the usual line level... */
const MIN_FALL_FRACTION = 0.1;
/** ...and in canonical units: 20 kPa (3 psi) of pressure, half a volt of battery. */
const MIN_FALL_KPA = 20;
const MIN_FALL_VOLTS = 0.5;
/** A supply this low on the line is a sensor on an unused system, not a supply. */
const MIN_BASE_KPA = 70;

/**
 * Where `levels` fell clearly lower than the same channel usually does on
 * `refs`, the vehicle's other passes: more than three spreads below their
 * usual low, and at least MIN_FALL_FRACTION of their line level.
 */
export function findAnomalies(levels: PassLevel[], refs: PassLevel[][]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const level of levels) {
    const pressure = level.quantitySlug === "pressure";
    if (pressure && level.base < MIN_BASE_KPA) continue;
    const same = refs.flatMap((r) => r.filter((l) => l.name === level.name));
    if (same.length < MIN_REFS) continue;
    const usualMin = median(same.map((l) => l.min));
    const usualBase = median(same.map((l) => l.base));
    const spread = 1.4826 * median(same.map((l) => Math.abs(l.min - usualMin)));
    const floor = Math.max(Math.abs(usualBase) * MIN_FALL_FRACTION, pressure ? MIN_FALL_KPA : MIN_FALL_VOLTS);
    if (usualMin - level.min > Math.max(3 * spread, floor)) out.push({ level, usualMin });
  }
  return out;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function lowerBound(ts: Float64Array, t: number): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

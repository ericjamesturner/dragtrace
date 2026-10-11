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
  /** Highest point during the pass, smoothed the same way (preview version 13). */
  max?: number;
  maxAt?: number;
  /**
   * Where the ECU logs what this pressure should be ("Fuel Pressure Expected"):
   * the furthest it fell below that, smoothed the same way (preview version 15).
   */
  shortfall?: { expectedName: string; gap: number; at: number; actual: number; expected: number };
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

/** Engine, transmission and oil temperatures — not the air, the ECU or an EGT. */
const WATCHED_TEMP = /coolant|engine temp|transmission|trans\b|oil temp/i;
const NOT_WATCHED_TEMP = /ambient|intake|air|ecu|egt|exhaust|fuel|target|correction|limit/i;

function isWatched(name: string, quantitySlug: string | undefined): boolean {
  if (/battery voltage/i.test(name)) return true;
  if (quantitySlug === "temperature") return WATCHED_TEMP.test(name) && !NOT_WATCHED_TEMP.test(name);
  return quantitySlug === "pressure" && /pressure/i.test(name) && !NOT_SUPPLY.test(name);
}

/**
 * Whether a level is checked at all. A supply pressure near zero on the line
 * is a sensor on a system that isn't in use (nitrous on a truck without it,
 * the brakes) — except coolant pressure, which normally sits at a few psi.
 */
export function isCheckedLevel(l: { name: string; quantitySlug?: string; base: number }): boolean {
  if (l.quantitySlug !== "pressure") return true;
  return l.base >= MIN_BASE_KPA || (/coolant/i.test(l.name) && l.base >= MIN_COOLANT_BASE_KPA);
}

/** Where the wide-open part of the pass ends: the first time the throttle falls under LIFT_FRACTION of its peak. */
export function wideOpenEnd(parsed: ParsedLog, session: LogSession, launchAt: number, raceEnd: number | null): number {
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
  return passEnd;
}

export function readLevels(parsed: ParsedLog, session: LogSession, launchAt: number, passEnd: number): PassLevel[] {
  const ts = session.timestamps;
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
    let max = -Infinity;
    let maxAt = 0;
    // What the ECU says this pressure should be, when it logs that.
    const expectedDef = parsed.channelDefs.find((d) => d.name.toLowerCase() === `${def.name} expected`.toLowerCase());
    const expected = expectedDef ? session.channels.get(expectedDef.name) : undefined;
    let shortfall: PassLevel["shortfall"];
    const start = lowerBound(ts, launchAt + 0.05);
    for (let i = start; i < ts.length && ts[i] <= passEnd; i++) {
      // Median of the samples in the next SMOOTH_S: a dip has to last to count.
      const window: number[] = [];
      const expWindow: number[] = [];
      for (let j = i; j < ts.length && ts[j] <= ts[i] + SMOOTH_S; j++) {
        if (Number.isFinite(vals[j])) window.push(vals[j]);
        if (expected && Number.isFinite(expected[j])) expWindow.push(expected[j]);
      }
      if (window.length === 0) continue;
      window.sort((a, b) => a - b);
      const m = window[window.length >> 1];
      if (expWindow.length) {
        expWindow.sort((a, b) => a - b);
        const e = expWindow[expWindow.length >> 1];
        if (!shortfall || e - m > shortfall.gap) {
          shortfall = { expectedName: expectedDef!.name, gap: e - m, at: ts[i] - launchAt, actual: m, expected: e };
        }
      }
      if (m < min) {
        min = m;
        minAt = ts[i] - launchAt;
      }
      if (m > max) {
        max = m;
        maxAt = ts[i] - launchAt;
      }
    }
    if (!Number.isFinite(min)) continue;
    out.push({ name: def.name, quantitySlug: def.quantitySlug, base: sum / n, min, minAt, max, maxAt, shortfall });
  }
  return out;
}

/**
 * One set of per-cylinder (or per-bank) sensors through the pass: each one's
 * average over the steady wide-open part, and for widebands the worst lean
 * excursion against the target. Stored with the preview.
 */
export interface CylinderGroup {
  kind: "lambda" | "egt";
  /** "C5", "B1": the cylinder or bank each sensor reads, in order. */
  labels: string[];
  quantitySlug?: string;
  /** Each sensor's average from STEADY_FROM_S to the end of the wide-open part. */
  means: number[];
  /** Each sensor's highest point from LEAN_FROM_S on, smoothed over PEAK_SMOOTH_S: what a short EGT spike shows in. */
  peaks?: number[];
  /** Widebands: the target's average over the same stretch as `means` (preview version 17). */
  targetMean?: number;
  /**
   * Widebands with a target: the longest stretch any one ran lean of it by
   * LEAN_RATIO or more (zero seconds when none did). Null without a target.
   */
  lean?: { label: string; seconds: number; at: number; worst: number } | null;
}

/** Widebands and EGTs settle after the hit; the averages start here. */
const STEADY_FROM_S = 1;
/** The lean check starts here: the hit is when a fuel supply problem shows. */
const LEAN_FROM_S = 0.15;
/** Lean of target by this ratio or more counts toward a lean spike. */
export const LEAN_RATIO = 1.1;

const WIDEBAND = /wideband|lambda|\bafr\b|\bo2\b/i;
const EGT = /\begt\b|exhaust gas temp/i;
/** Parts of a fuel or EGT system that aren't a sensor reading. */
const NOT_SENSOR = /target|error|correction|trim|overall|average|control|heater|status|voltage|current|table|limit|offset|resistance|pump/i;

/** "Wideband O2 Cylinder 5" -> "C5", "EGT 3" -> "C3", "Wideband O2 2" -> "B2". */
function sensorLabel(name: string, kind: "lambda" | "egt"): string | null {
  const cyl = /(?:cylinder|cyl)\s*(\d+)/i.exec(name);
  if (cyl) return `C${cyl[1]}`;
  const bank = /bank\s*(\d+)/i.exec(name);
  if (bank) return `B${bank[1]}`;
  const tail = /(\d+)\s*$/.exec(name);
  // A bare number on a wideband is a bank (one per side); on an EGT, a cylinder.
  return tail ? `${kind === "lambda" ? "B" : "C"}${tail[1]}` : null;
}

/**
 * The log's per-cylinder (or, failing that, per-bank) widebands or EGTs, by
 * label, in order. Shared with the viewer, which finds a flagged cylinder's
 * channel from its label.
 */
export function cylinderChannels(
  defs: { name: string; quantitySlug?: string }[],
  kind: "lambda" | "egt",
): { label: string; name: string; quantitySlug?: string }[] {
  const members = defs.flatMap((d) => {
    if (!(kind === "lambda" ? WIDEBAND : EGT).test(d.name) || NOT_SENSOR.test(d.name)) return [];
    if (kind === "egt" && d.quantitySlug && d.quantitySlug !== "temperature") return [];
    const label = sensorLabel(d.name, kind);
    return label ? [{ label, name: d.name, quantitySlug: d.quantitySlug }] : [];
  });
  // One family only: per-cylinder sensors win over per-bank ones when a log has both.
  const cyls = members.filter((m) => m.label.startsWith("C"));
  return (cyls.length >= 2 ? cyls : members.filter((m) => m.label.startsWith("B"))).sort(
    (a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)),
  );
}

/** The target channel the widebands are judged against. */
export function targetChannel(defs: { name: string }[]): string | undefined {
  return defs.find((d) => /^target (lambda|afr)$/i.test(d.name.trim()))?.name;
}

export function readCylinders(parsed: ParsedLog, session: LogSession, launchAt: number, passEnd: number): CylinderGroup[] {
  const ts = session.timestamps;
  const out: CylinderGroup[] = [];
  for (const kind of ["lambda", "egt"] as const) {
    const group = cylinderChannels(parsed.channelDefs, kind).flatMap((m) => {
      const vals = session.channels.get(m.name);
      const status = session.channelStatus.get(m.name);
      if (!vals || (status && status.samples > status.rowCount / 2)) return [];
      return [{ label: m.label, vals, slug: m.quantitySlug }];
    });
    if (group.length < 2) continue;

    const means = group.map((m) => meanIn(ts, m.vals, launchAt + STEADY_FROM_S, passEnd));
    if (means.some((m) => m === null)) continue;
    const peaks = group.map((m) => peakIn(ts, m.vals, launchAt + LEAN_FROM_S, passEnd));

    let lean: CylinderGroup["lean"] = null;
    const targetName = kind === "lambda" ? targetChannel(parsed.channelDefs) : undefined;
    const target = targetName ? session.channels.get(targetName) : undefined;
    if (target) {
      lean = { label: "", seconds: 0, at: 0, worst: 1 };
      for (const m of group) {
        let start: number | null = null;
        let worst = 0;
        for (let i = lowerBound(ts, launchAt + LEAN_FROM_S); i < ts.length && ts[i] <= passEnd; i++) {
          const ratio = target[i] > 0 && Number.isFinite(m.vals[i]) ? m.vals[i] / target[i] : NaN;
          if (ratio >= LEAN_RATIO) {
            if (start === null) start = ts[i];
            worst = Math.max(worst, ratio);
            const seconds = ts[i] - start;
            if (!lean.label || seconds > lean.seconds) lean = { label: m.label, seconds, at: start - launchAt, worst };
          } else {
            start = null;
            worst = 0;
          }
        }
      }
    }
    const targetMean = target ? meanIn(ts, target, launchAt + STEADY_FROM_S, passEnd) ?? undefined : undefined;
    out.push({ kind, labels: group.map((m) => m.label), quantitySlug: group[0].slug, means: means as number[], peaks, lean, targetMean });
  }
  return out;
}

/** An EGT spike has to hold this long to count; one hot sample is noise. */
const PEAK_SMOOTH_S = 0.05;

/** The highest PEAK_SMOOTH_S-long average between `from` and `to`. */
function peakIn(ts: Float64Array, vals: Float64Array, from: number, to: number): number {
  let best = -Infinity;
  let lo = lowerBound(ts, from);
  let sum = 0;
  let n = 0;
  for (let hi = lo; hi < ts.length && ts[hi] <= to; hi++) {
    if (Number.isFinite(vals[hi])) {
      sum += vals[hi];
      n++;
    }
    while (ts[hi] - ts[lo] > PEAK_SMOOTH_S) {
      if (Number.isFinite(vals[lo])) {
        sum -= vals[lo];
        n--;
      }
      lo++;
    }
    if (n > 0 && ts[hi] - from >= PEAK_SMOOTH_S) best = Math.max(best, sum / n);
  }
  return Number.isFinite(best) ? best : NaN;
}

function meanIn(ts: Float64Array, vals: Float64Array, from: number, to: number): number | null {
  let sum = 0;
  let n = 0;
  for (let i = lowerBound(ts, from); i < ts.length && ts[i] <= to; i++) {
    if (Number.isFinite(vals[i])) {
      sum += vals[i];
      n++;
    }
  }
  return n ? sum / n : null;
}

/** Everything the Anomalies section can raise on a pass. */
export type Anomaly =
  /** A pressure or the battery fell lower than it usually does. */
  | { kind: "low"; row: string; level: PassLevel; usualMin: number }
  /** ...or rose higher than it usually does. */
  | { kind: "high"; row: string; level: PassLevel; usualMax: number }
  /** ...or ran well below what the ECU expected it to be — judged without any history. */
  | { kind: "short"; row: string; level: PassLevel }
  /** A temperature reached a limit no engine or transmission should — judged without any history. */
  | { kind: "hot"; row: string; level: PassLevel; limit: number }
  /** Peak boost well below or above where this vehicle usually peaks. */
  | { kind: "boost"; row: string; boost: BoostReading; usual: number }
  /** Boost fell well short of what the ECU commanded — judged without any history. */
  | { kind: "boost-target"; row: string; boost: BoostReading }
  /** The rev limiter or an engine cut fired during the pass. */
  | { kind: "limiter"; row: string; limiter: LimiterReading }
  /** A sensor that read fine on the line reported a fault during the pass. */
  | { kind: "fault"; row: string; fault: FaultReading }
  /** A wideband ran well lean of the target for a while. */
  | { kind: "lean"; row: string; label: string; seconds: number; at: number; worst: number }
  /** A wideband averaged lean of the target over the pass — judged without any history. */
  | { kind: "target-lean"; row: string; label: string; ratio: number }
  /** A cylinder moved away from where it usually sits against the others. */
  | { kind: "drift"; row: string; label: string; group: "lambda" | "egt"; offset: number; usual: number; quantitySlug?: string }
  /** The cylinders spread further apart than they usually do. */
  | { kind: "spread"; row: string; group: "lambda" | "egt"; spread: number; usual: number; quantitySlug?: string }
  /** An EGT far off the others with no history to judge by: a dead or a lean cylinder. */
  | { kind: "egt-odd"; row: string; label: string; offset: number; quantitySlug?: string }
  /** An EGT peaked well above where that cylinder usually peaks. */
  | { kind: "egt-spike"; row: string; label: string; peak: number; usual: number; quantitySlug?: string };

/** Fewer reference passes than this and there's no "usual" to judge by. */
const MIN_REFS = 3;
/** Smallest fall below the usual low that counts, as a share of the usual line level... */
const MIN_FALL_FRACTION = 0.1;
/** ...and in canonical units: 20 kPa (3 psi) of pressure, half a volt of battery. */
const MIN_FALL_KPA = 20;
const MIN_FALL_VOLTS = 0.5;
/**
 * Below expected by this share and at least this much (2 psi). One truck: a
 * fuel pressure dip fell 18% short of expected, its clean passes 1–3%.
 */
const SHORT_FRACTION = 0.1;
const SHORT_MIN_KPA = 14;
/**
 * Temperatures past these on a pass are trouble whatever the vehicle usually
 * does: coolant boiling under a typical cap, transmission fluid starting to
 * break down, oil past what most oils are rated for.
 */
const TEMP_LIMITS_C: { match: RegExp; limitC: number }[] = [
  { match: /coolant|engine temp/i, limitC: 110 },
  { match: /transmission|trans\b/i, limitC: 105 },
  { match: /oil/i, limitC: 135 },
];
/** A temperature this much above its usual high on a pass (8 °C, about 15 °F). */
const TEMP_RISE_C = 8;
/** Coolant pressure is checked from 1 psi on the line. */
const MIN_COOLANT_BASE_KPA = 7;
/** A supply this low on the line is a sensor on an unused system, not a supply. */
const MIN_BASE_KPA = 70;

/**
 * Where `levels` fell clearly lower than the same channel usually does on
 * `refs`, the vehicle's other passes: more than three spreads below their
 * usual low, and at least MIN_FALL_FRACTION of their line level.
 */
/** Manifold pressure through the pass, for boosted engines (preview version 16). */
export interface BoostReading {
  /** The highest boost, smoothed over BOOST_SMOOTH_S, and when. Canonical kPa. */
  peak: number;
  peakAt: number;
  /** With a boost target logged: the furthest boost fell short of it from 1 s on. */
  targetGap?: number;
  targetName?: string;
  mapName: string;
}

/** The limiter or an engine cut during the pass (preview version 16). */
export interface LimiterReading {
  name: string;
  /** How long it was cutting, from LIMITER_FROM_S until the throttle came off. */
  seconds: number;
  at: number;
  /** The most it cut, in the channel's own units (percent for a cut percentage). */
  worst: number;
}

/** A channel that read fine on the line and then faulted during the pass (preview version 16). */
export interface FaultReading {
  name: string;
  seconds: number;
  at: number;
}

export interface PassChecks {
  levels: PassLevel[];
  cylinders: CylinderGroup[];
  boost?: BoostReading | null;
  limiter?: LimiterReading | null;
  faults?: FaultReading[] | null;
}

const MAP_NAME = /^(manifold (absolute )?pressure|map)$/i;
const BOOST_TARGET = /^(boost (control )?target( pressure)?|target boost|boost target)$/i;
const BOOST_SMOOTH_S = 0.05;
/** Below this peak (3 psi) the engine isn't boosted; there's nothing to check. */
const BOOSTED_KPA = 21;

export function readBoost(parsed: ParsedLog, session: LogSession, launchAt: number, passEnd: number): BoostReading | null {
  const mapDef = parsed.channelDefs.find((d) => MAP_NAME.test(d.name.trim()));
  const map = mapDef ? session.channels.get(mapDef.name) : undefined;
  if (!mapDef || !map) return null;
  const ts = session.timestamps;
  const targetDef = parsed.channelDefs.find((d) => BOOST_TARGET.test(d.name.trim()));
  const target = targetDef ? session.channels.get(targetDef.name) : undefined;
  let peak = -Infinity;
  let peakAt = 0;
  let targetGap: number | undefined;
  for (let i = lowerBound(ts, launchAt + THROTTLE_SETTLE_S); i < ts.length && ts[i] <= passEnd; i++) {
    let sum = 0;
    let n = 0;
    let tSum = 0;
    let tn = 0;
    for (let j = i; j < ts.length && ts[j] <= ts[i] + BOOST_SMOOTH_S; j++) {
      if (Number.isFinite(map[j])) {
        sum += map[j];
        n++;
      }
      if (target && Number.isFinite(target[j])) {
        tSum += target[j];
        tn++;
      }
    }
    if (!n) continue;
    const m = sum / n;
    if (m > peak) {
      peak = m;
      peakAt = ts[i] - launchAt;
    }
    if (tn && ts[i] - launchAt >= 1) {
      const gap = tSum / tn - m;
      if (targetGap === undefined || gap > targetGap) targetGap = gap;
    }
  }
  if (!Number.isFinite(peak) || peak < BOOSTED_KPA) return null;
  return { peak, peakAt, targetGap, targetName: targetDef?.name, mapName: mapDef.name };
}

/** A cut percentage is the clearest record of a limiter; an on/off flag will do. */
const LIMITER_CUT = /limiter.*cut percentage|overall cut percentage/i;
const LIMITER_ACTIVE = /limiter active|rev limit(er)? active/i;
/** The launch limiter is still letting go just after the release. */
const LIMITER_FROM_S = 0.3;

export function readLimiter(parsed: ParsedLog, session: LogSession, launchAt: number, passEnd: number): LimiterReading | null {
  const def = parsed.channelDefs.find((d) => LIMITER_CUT.test(d.name)) ?? parsed.channelDefs.find((d) => LIMITER_ACTIVE.test(d.name));
  const vals = def ? session.channels.get(def.name) : undefined;
  if (!def || !vals) return null;
  const ts = session.timestamps;
  let seconds = 0;
  let at = -1;
  let worst = 0;
  const from = lowerBound(ts, launchAt + LIMITER_FROM_S);
  for (let i = from; i < ts.length && ts[i] <= passEnd; i++) {
    if (Number.isFinite(vals[i]) && vals[i] > 0) {
      if (at < 0) at = ts[i] - launchAt;
      worst = Math.max(worst, vals[i]);
      if (i + 1 < ts.length) seconds += ts[i + 1] - ts[i];
    }
  }
  return { name: def.name, seconds, at: Math.max(at, 0), worst };
}

/** A fault this long or longer counts; one dropped sample is noise. */
const FAULT_MIN_S = 0.02;

/**
 * Every channel that read fine for the two seconds before the launch and then
 * faulted during the pass. A sensor that was never reading — not fitted, or
 * dead all day — isn't news on any one pass.
 */
export function readFaults(session: LogSession, launchAt: number, passEnd: number): FaultReading[] {
  const ts = session.timestamps;
  const preFrom = lowerBound(ts, launchAt - 2);
  const passFrom = lowerBound(ts, launchAt);
  const out: FaultReading[] = [];
  for (const [name] of session.channelStatus) {
    const vals = session.channels.get(name);
    if (!vals) continue;
    let clean = true;
    for (let i = preFrom; i < passFrom; i++) {
      if (!Number.isFinite(vals[i])) {
        clean = false;
        break;
      }
    }
    if (!clean || passFrom === preFrom) continue;
    let seconds = 0;
    let at = -1;
    for (let i = passFrom; i < ts.length && ts[i] <= passEnd; i++) {
      if (!Number.isFinite(vals[i])) {
        if (at < 0) at = ts[i] - launchAt;
        if (i + 1 < ts.length) seconds += ts[i + 1] - ts[i];
      }
    }
    if (seconds >= FAULT_MIN_S) out.push({ name, seconds, at });
  }
  return out;
}

/**
 * Whether a pass's checks stopped short: the throttle came off well before
 * the finish (a pedal, a lift), so its lows and highs cover only part of the
 * run. `checksTo` and `passLen` are seconds after the launch; the slip's clock
 * starts about RELEASE_TO_CLOCK later than the log's launch.
 */
export function checksCut(checksTo: number | undefined, passLen: number | null): boolean {
  if (checksTo === undefined || passLen === null) return false;
  return checksTo < passLen + RELEASE_TO_CLOCK - CUT_MARGIN_S;
}
const RELEASE_TO_CLOCK = 0.18;
/** A lift this close to the finish still covers the whole run. */
const CUT_MARGIN_S = 0.3;

export function findAnomalies(pass: PassChecks, refs: PassChecks[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const level of pass.levels) {
    const pressure = level.quantitySlug === "pressure";
    const temperature = level.quantitySlug === "temperature";
    if (!isCheckedLevel(level)) continue;
    // A temperature past what an engine or transmission should see, with or without history.
    const limit = temperature ? TEMP_LIMITS_C.find((t) => t.match.test(level.name))?.limitC : undefined;
    if (limit !== undefined && level.max !== undefined && level.max >= limit) {
      out.push({ kind: "hot", row: level.name, level, limit });
    }
    // Against the ECU's own expected value: needs no other passes.
    const sf = level.shortfall;
    if (sf && sf.expected > 0 && sf.gap >= Math.max(sf.expected * SHORT_FRACTION, SHORT_MIN_KPA)) {
      out.push({ kind: "short", row: level.name, level });
    }
    const same = refs.flatMap((r) => r.levels.filter((l) => l.name === level.name));
    if (same.length < MIN_REFS) continue;
    const usualMin = median(same.map((l) => l.min));
    const usualBase = median(same.map((l) => l.base));
    const spread = 1.4826 * median(same.map((l) => Math.abs(l.min - usualMin)));
    const floor = temperature
      ? TEMP_RISE_C
      : Math.max(Math.abs(usualBase) * MIN_FALL_FRACTION, pressure ? MIN_FALL_KPA : MIN_FALL_VOLTS);
    // A cold engine or transmission isn't a fault; only a temperature that ran hot is.
    if (!temperature && usualMin - level.min > Math.max(3 * spread, floor)) out.push({ kind: "low", row: level.name, level, usualMin });

    // The same test the other way: a regulator or a pressure control stuck high.
    const maxes = same.flatMap((l) => (l.max !== undefined ? [l.max] : []));
    if (level.max !== undefined && maxes.length >= MIN_REFS) {
      const usualMax = median(maxes);
      const maxSpread = 1.4826 * median(maxes.map((m) => Math.abs(m - usualMax)));
      if (level.max - usualMax > Math.max(3 * maxSpread, floor)) out.push({ kind: "high", row: level.name, level, usualMax });
    }
  }

  for (const g of pass.cylinders) {
    const groupName = g.kind === "lambda" ? "Wideband" : "EGT";
    // Lean spikes are judged against the target, which is the same on any pass.
    if (g.lean && g.lean.seconds >= LEAN_MIN_S) out.push({ kind: "lean", row: "Lean spike", ...g.lean });
    // Off target all pass, not just in a spike: all the cylinders going lean
    // together (a fuel supply) is something drift against the others can't see.
    targetRatios(g)?.forEach((ratio, k) => {
      if (ratio >= TARGET_OFF) out.push({ kind: "target-lean", row: "Wideband vs target", label: g.labels[k], ratio });
    });
    if (g.kind === "egt" && g.peaks) {
      const peakRefs = refs.flatMap((r) =>
        r.cylinders.filter((x) => x.kind === "egt" && x.labels.join() === g.labels.join() && x.peaks).map((x) => x.peaks!),
      );
      g.labels.forEach((label, k) => {
        const peak = g.peaks![k];
        if (!Number.isFinite(peak)) return;
        if (peakRefs.length >= MIN_REFS) {
          const usual = median(peakRefs.map((p) => p[k]));
          const spread = 1.4826 * median(peakRefs.map((p) => Math.abs(p[k] - usual)));
          if (peak - usual > Math.max(3 * spread, EGT_SPIKE_C)) {
            out.push({ kind: "egt-spike", row: "EGT spike", label, peak, usual, quantitySlug: g.quantitySlug });
          }
        } else {
          // No history: a peak far above the other cylinders' peaks.
          const others = median(g.peaks!.filter((_, j) => j !== k && Number.isFinite(g.peaks![j])));
          if (peak - others > EGT_SPIKE_ODD_C) {
            out.push({ kind: "egt-spike", row: "EGT spike", label, peak, usual: others, quantitySlug: g.quantitySlug });
          }
        }
      });
    }

    const offsets = offsetsOf(g);
    const same = refs.flatMap((r) => r.cylinders.filter((x) => x.kind === g.kind && x.labels.join() === g.labels.join()));
    if (same.length >= MIN_REFS) {
      const refOffsets = same.map(offsetsOf);
      g.labels.forEach((label, k) => {
        const usual = median(refOffsets.map((o) => o[k]));
        const spread = 1.4826 * median(refOffsets.map((o) => Math.abs(o[k] - usual)));
        const moved = offsets[k] - usual;
        if (g.kind === "lambda") {
          // Only a cylinder that went leaner, and is now leaner than the rest:
          // a rich cylinder coming back toward the others is no worry.
          if (moved > Math.max(DRIFT_SPREADS * spread, LAMBDA_DRIFT) && offsets[k] > 0) {
            out.push({ kind: "drift", row: `${groupName} drift`, label, group: g.kind, offset: offsets[k], usual, quantitySlug: g.quantitySlug });
          }
        } else if (Math.abs(moved) > Math.max(DRIFT_SPREADS * spread, EGT_DRIFT_C)) {
          out.push({ kind: "drift", row: `${groupName} drift`, label, group: g.kind, offset: offsets[k], usual, quantitySlug: g.quantitySlug });
        }
      });
      const spreadNow = spreadOf(g);
      const spreads = same.map(spreadOf);
      const usualSpread = median(spreads);
      const spreadSpread = 1.4826 * median(spreads.map((v) => Math.abs(v - usualSpread)));
      const floor = g.kind === "lambda" ? LAMBDA_SPREAD_WIDER : EGT_SPREAD_WIDER_C;
      if (spreadNow - usualSpread > Math.max(3 * spreadSpread, floor)) {
        out.push({ kind: "spread", row: `${groupName} spread`, group: g.kind, spread: spreadNow, usual: usualSpread, quantitySlug: g.quantitySlug });
      }
    } else if (g.kind === "egt") {
      // No history yet: still call out a cylinder far from the others.
      g.labels.forEach((label, k) => {
        if (Math.abs(offsets[k]) > EGT_ODD_C) out.push({ kind: "egt-odd", row: "EGT odd one out", label, offset: offsets[k], quantitySlug: g.quantitySlug });
      });
    }
  }

  // Boost: the peak against this vehicle's usual peak, both ways — a leak or a
  // stuck wastegate pulls it down, a control fault overshoots.
  const b = pass.boost;
  if (b) {
    const peaks = refs.flatMap((r) => (r.boost && r.boost.mapName === b.mapName ? [r.boost.peak] : []));
    if (peaks.length >= MIN_REFS) {
      const usual = median(peaks);
      const spread = 1.4826 * median(peaks.map((p) => Math.abs(p - usual)));
      if (Math.abs(b.peak - usual) > Math.max(3 * spread, BOOST_OFF_KPA)) out.push({ kind: "boost", row: "Boost", boost: b, usual });
    }
    // Short of what the ECU commanded: a leak, a wastegate, or turbos out of
    // map. A setup that can never reach its target shows this every pass —
    // which is worth knowing too.
    if (b.targetGap !== undefined && b.targetGap >= BOOST_TARGET_SHORT_KPA) {
      out.push({ kind: "boost-target", row: "Boost vs target", boost: b });
    }
  }

  // The limiter during the pass is never part of the plan.
  if (pass.limiter && pass.limiter.seconds >= LIMITER_MIN_S) out.push({ kind: "limiter", row: "Limiter", limiter: pass.limiter });

  // A sensor dropping out mid-pass is worth a look every time.
  for (const f of pass.faults ?? []) out.push({ kind: "fault", row: "Sensor faults", fault: f });
  return out;
}

/** Peak boost this far (2 psi) from its usual, either way. */
const BOOST_OFF_KPA = 14;
/** Boost this far (3 psi) short of its target, held 50 ms, from 1 s on. */
const BOOST_TARGET_SHORT_KPA = 21;
/** Cutting this long during the pass. Nine clean passes on two vehicles: none at all after 0.3 s. */
const LIMITER_MIN_S = 0.05;

/** Lean of target by LEAN_RATIO for this long. Calibrated on one truck: a fuel pressure dip held it 0.17 s, nine clean passes 0.024 s at most. */
const LEAN_MIN_S = 0.1;
/** Widebands: each cylinder against the average of all of them, as a share of that average, so AFR and lambda read alike. */
export function offsetsOf(g: CylinderGroup): number[] {
  const avg = g.means.reduce((a, b) => a + b) / g.means.length;
  return g.kind === "lambda" ? g.means.map((m) => (m - avg) / avg) : g.means.map((m) => m - avg);
}
/** Each wideband's average against the target's: +0.05 is 5% lean, −0.05 is 5% rich. Null without a target. */
export function targetRatios(g: CylinderGroup): number[] | null {
  if (g.kind !== "lambda" || !g.targetMean) return null;
  return g.means.map((m) => m / g.targetMean! - 1);
}
/** Averaging this far (5%) lean of target is red; this far rich is shown, but isn't a fault. */
export const TARGET_OFF = 0.05;

export function spreadOf(g: CylinderGroup): number {
  const o = offsetsOf(g);
  return Math.max(...o) - Math.min(...o);
}
/** A cylinder this much leaner than where it usually sits against the rest (1.7%, about 0.015 lambda): the truck's cylinder 5 on Saturday. */
const LAMBDA_DRIFT = 0.017;
const DRIFT_SPREADS = 2;
const LAMBDA_SPREAD_WIDER = 0.025;
/** EGTs in °C: a cylinder this far from where it usually sits, a spread this much wider, or with no history this far from the rest. */
const EGT_DRIFT_C = 50;
const EGT_SPREAD_WIDER_C = 75;
const EGT_ODD_C = 150;
/** An EGT peaking this far above its usual peak (or, with no history, above the other cylinders' peaks). */
const EGT_SPIKE_C = 100;
const EGT_SPIKE_ODD_C = 200;

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

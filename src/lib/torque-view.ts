import type { LoadedLog } from "./viewer-types";
import type { PageConfig } from "./viewer-types";

/**
 * What torque management did through a pass, laid out for the Torque Mgmt
 * tab: the RPM it controls against its target, how far over or under it ran,
 * the power it cut and the timing it pulled or added.
 *
 * Haltech controls engine RPM, driveshaft RPM, or both, each with its own
 * target, error, cut and timing correction. The timed pull runs by time
 * alone and belongs to neither. Every series here is in seconds after the
 * launch, read off the log's own channels.
 */

/** The vehicle's Torque Mgmt tab, by fixed id so it can be found like Health and Timed. */
export const TORQUE_PAGE_ID = "page-torque";

interface ControlChannels {
  kind: "engine" | "driveshaft";
  label: string;
  actual: string;
  target: string;
  /** Logged as actual − target: positive means over target. */
  error: string;
  cut: string;
  timing: string;
}

const CONTROLS: ControlChannels[] = [
  {
    kind: "engine",
    label: "Engine RPM",
    actual: "RPM",
    target: "Torque Management Engine RPM Target",
    error: "Torque Management Engine RPM Target Error",
    cut: "Torque Management Engine RPM Cut Percentage",
    timing: "Torque Management Engine RPM Target Error Ignition Correction",
  },
  {
    kind: "driveshaft",
    label: "Driveshaft RPM",
    actual: "Driveshaft RPM",
    target: "Torque Management Driveshaft RPM Target",
    error: "Torque Management Driveshaft RPM Target Error",
    cut: "Torque Management Driveshaft RPM Cut Percentage",
    timing: "Torque Management Driveshaft RPM Target Error Ignition Correction",
  },
];
const TIMED = "Torque Management Timed Ignition Correction";
const COMBINED = "Torque Management Combined Ignition Correction";
const KNOB = "Torque Management Knob";

/** Read this long before the launch and after it, at most. */
const LEAD_S = 0.5;
const TAIL_S = 6;

export interface TorqueControl {
  kind: ControlChannels["kind"];
  label: string;
  actual: Float64Array;
  target: Float64Array;
  /** Actual − target: positive means over target. */
  error: Float64Array;
  cut: Float64Array | null;
  timing: Float64Array | null;
  /** Seconds it cut or moved timing in all: how much torque management worked on this one. */
  activity: number;
}

export interface TorqueView {
  /** Seconds after the launch, one per sample. */
  t: Float64Array;
  timed: Float64Array | null;
  /** The sum of every timing part, as the ECU logs it. */
  total: Float64Array | null;
  knob: number | null;
  /** Most worked first. */
  controls: TorqueControl[];
}

/** Whether the log carries what the Torque Mgmt tab needs. */
export function hasTorqueView(log: Pick<LoadedLog, "parsed">): boolean {
  const names = new Set(log.parsed.channelDefs.map((d) => d.name));
  return CONTROLS.some((c) => names.has(c.actual) && names.has(c.target));
}

export function readTorqueView(log: LoadedLog): TorqueView | null {
  const session = log.parsed.sessions[log.activeSessionIndex];
  if (!session || log.raceStartTime === null) return null;
  const launch = log.raceStartTime;
  const ts = session.timestamps;
  let lo = 0;
  while (lo < ts.length && ts[lo] < launch - LEAD_S) lo++;
  let hi = lo;
  while (hi < ts.length && ts[hi] <= launch + TAIL_S) hi++;
  if (hi - lo < 10) return null;
  const t = new Float64Array(hi - lo);
  for (let i = lo; i < hi; i++) t[i - lo] = ts[i] - launch;
  const read = (name: string) => {
    const v = session.channels.get(name);
    return v ? v.slice(lo, hi) : null;
  };

  const controls: TorqueControl[] = [];
  for (const c of CONTROLS) {
    const actual = read(c.actual);
    const target = read(c.target);
    if (!actual || !target) continue;
    const error = read(c.error) ?? actual.map((a, i) => a - target[i]);
    const cut = read(c.cut);
    const timing = read(c.timing);
    let activity = 0;
    for (let i = 1; i < t.length; i++) {
      if (t[i] < 0) continue;
      const busy = (cut && cut[i] > 0.05) || (timing && Math.abs(timing[i]) > 0.2);
      if (busy) activity += t[i] - t[i - 1];
    }
    controls.push({ kind: c.kind, label: c.label, actual, target, error, cut, timing, activity });
  }
  if (controls.length === 0) return null;
  controls.sort((a, b) => b.activity - a.activity);

  const knobs = read(KNOB);
  const atLaunch = t.findIndex((x) => x >= 0);
  return {
    t,
    timed: read(TIMED),
    total: read(COMBINED),
    knob: knobs && atLaunch >= 0 && Number.isFinite(knobs[atLaunch]) ? Math.round(knobs[atLaunch]) : null,
    controls,
  };
}

/** The tab itself: a page of its own, drawn by the Torque Mgmt panel rather than traces. */
export function buildTorquePage(logs: Pick<LoadedLog, "parsed">[]): PageConfig | null {
  return logs.some(hasTorqueView) ? { id: TORQUE_PAGE_ID, label: "Torque Mgmt", traces: [] } : null;
}

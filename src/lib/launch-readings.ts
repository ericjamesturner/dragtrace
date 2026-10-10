import type { LogSession, ParsedLog } from "./log-types";
import {
  convertForDisplay,
  getDisplayPrecision,
  getDisplayUnit,
  type UnitOverrides,
  type UnitSystem,
} from "./units";

/**
 * What the car was doing on the line, read from the log in the moment before
 * the launch: the temperatures a racer checks before staging, and what the
 * engine was making on the brake. Stored with the pass preview so the pass
 * gallery can show it without reparsing the log.
 */
export interface LaunchReading {
  key: LaunchKey;
  /** Canonical stored value (see `canonicalAlternate`). */
  value: number;
  quantitySlug?: string;
}

export type LaunchKey = "engine" | "oil" | "trans" | "intake" | "rpm" | "boost";

/** Shown in this order. Channel names are the parsers' shared names, tried in turn. */
const LAUNCH_CHANNELS: { key: LaunchKey; label: string; names: string[] }[] = [
  { key: "engine", label: "ENGINE", names: ["Coolant Temperature"] },
  { key: "oil", label: "OIL", names: ["Oil Temperature", "Engine Oil Temperature"] },
  {
    key: "trans",
    label: "TRANS",
    names: ["Transmission Oil Temperature", "Transmission Temperature", "Transmission Fluid Temperature"],
  },
  { key: "intake", label: "INTAKE", names: ["Intake Air Temperature"] },
  { key: "rpm", label: "RPM", names: ["RPM"] },
  { key: "boost", label: "BOOST", names: ["Manifold Pressure"] },
];

/** Averaged over this long before the launch, so one noisy sample can't set it. */
const WINDOW_S = 0.3;

/** A temperature outside this (°C) is an unplugged or failed sensor, not a reading. */
const PLAUSIBLE_TEMP_C: [number, number] = [-40, 200];

export function readLaunch(
  parsed: ParsedLog,
  session: LogSession,
  launchAt: number,
): LaunchReading[] {
  const { timestamps } = session;
  let lo = 0;
  while (lo < timestamps.length && timestamps[lo] < launchAt - WINDOW_S) lo++;
  let hi = lo;
  while (hi < timestamps.length && timestamps[hi] < launchAt) hi++;
  if (hi <= lo) return [];

  const out: LaunchReading[] = [];
  for (const spec of LAUNCH_CHANNELS) {
    const name = spec.names.find((n) => session.channels.has(n));
    if (!name) continue;
    // A channel that faulted for most of the run has no reading worth showing.
    const status = session.channelStatus.get(name);
    if (status && status.samples > status.rowCount / 2) continue;
    const values = session.channels.get(name)!;
    let sum = 0;
    let n = 0;
    for (let i = lo; i < hi; i++) {
      const v = values[i];
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    if (n === 0) continue;
    const value = sum / n;
    const quantitySlug = parsed.channelDefs.find((d) => d.name === name)?.quantitySlug;
    if (quantitySlug === "temperature" && (value < PLAUSIBLE_TEMP_C[0] || value > PLAUSIBLE_TEMP_C[1])) {
      continue;
    }
    out.push({ key: spec.key, value, quantitySlug });
  }
  return out;
}

export interface LaunchLine {
  label: string;
  value: string;
}

/** Readings as card lines, in the car's display units. */
export function formatLaunch(
  readings: LaunchReading[],
  system: UnitSystem,
  overrides?: UnitOverrides,
): LaunchLine[] {
  return LAUNCH_CHANNELS.flatMap((spec) => {
    const r = readings.find((x) => x.key === spec.key);
    if (!r) return [];
    if (!r.quantitySlug) return [{ label: spec.label, value: String(Math.round(r.value)) }];
    const shown = convertForDisplay(r.value, r.quantitySlug, system, overrides);
    const unit = getDisplayUnit(r.quantitySlug, system, overrides);
    // RPM reads as a whole number; everything else at its unit's usual precision.
    const dp = spec.key === "rpm" ? 0 : getDisplayPrecision(r.quantitySlug, system, overrides) ?? 0;
    const text = spec.key === "rpm" ? String(Math.round(shown)) : shown.toFixed(dp);
    return [{ label: spec.label, value: unit && spec.key !== "rpm" ? `${text} ${unit}` : text }];
  });
}

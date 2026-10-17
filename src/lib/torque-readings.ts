import type { LogSession, ParsedLog } from "./log-types";

/**
 * What torque management did on a pass, part by part (preview version 19).
 *
 * Haltech logs each of its corrections on its own channel and their sum as
 * "Combined". The sum hides what the parts did: the timed table can pull 12°
 * while the RPM-error correction adds 1°, and the combined line just pulls.
 * So every part is read on its own — how far it went each way, when, and for
 * how long — with the combined line as one more part.
 */

/** "Torque Management Timed Ignition Correction" → "Timed". */
const TIMING = /^Torque Management (.+) Ignition Correction$/i;
/** "Torque Management Engine RPM Cut Percentage" → "Engine RPM". */
const CUT = /^Torque Management (.+) Cut Percentage$/i;

/** Smaller than this counts as doing nothing, so sensor noise adds no time to either side. */
const TIMING_NOISE_DEG = 0.2;
const CUT_NOISE_PCT = 0.05;

export interface TorqueSide {
  /** Furthest it went this way: degrees for timing, percent for a cut. */
  most: number;
  /** Seconds after the launch it went furthest. */
  at: number;
  /** Seconds it spent this side of zero, in all. */
  for: number;
}

export interface TorquePart {
  channel: string;
  /** The part's own name inside the channel: "Timed", "Engine RPM Target Error", "Combined". */
  part: string;
  kind: "timing" | "cut";
  /** Timing pulled. Never set for a cut. */
  below: TorqueSide | null;
  /** Timing added, or power cut. */
  above: TorqueSide | null;
}

/**
 * Every torque management part that did something between the launch and
 * `passEnd`. Empty when the channels are logged but stayed at zero; null when
 * the log has none.
 */
export function readTorque(parsed: ParsedLog, session: LogSession, launchAt: number, passEnd: number): TorquePart[] | null {
  const ts = session.timestamps;
  let logged = false;
  const out: TorquePart[] = [];
  for (const def of parsed.channelDefs) {
    const timing = TIMING.exec(def.name);
    const cut = timing ? null : CUT.exec(def.name);
    const values = session.channels.get(def.name);
    if ((!timing && !cut) || !values) continue;
    logged = true;
    const noise = timing ? TIMING_NOISE_DEG : CUT_NOISE_PCT;
    const below: TorqueSide = { most: 0, at: 0, for: 0 };
    const above: TorqueSide = { most: 0, at: 0, for: 0 };
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] < launchAt) continue;
      if (ts[i] > passEnd) break;
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      const dt = ts[i] - ts[i - 1];
      const side = v < -noise ? below : v > noise ? above : null;
      if (!side) continue;
      side.for += dt;
      if (Math.abs(v) > Math.abs(side.most)) {
        side.most = v;
        side.at = ts[i] - launchAt;
      }
    }
    const part: TorquePart = {
      channel: def.name,
      part: (timing ?? cut)![1],
      kind: timing ? "timing" : "cut",
      below: timing && below.for > 0 ? below : null,
      above: above.for > 0 ? above : null,
    };
    if (part.below || part.above) out.push(part);
  }
  return logged ? out : null;
}

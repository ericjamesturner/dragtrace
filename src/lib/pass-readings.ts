import type { LogSession, ParsedLog } from "./log-types";
import { findGearChannel, findThrottleChannel, shiftMarkers } from "./channel-markers";

/**
 * Readings taken from the full-rate log during the pass, stored with the pass
 * preview so the run sheet can line them up without reparsing. The preview's
 * own traces are downsampled too far to read a driveshaft speed or a shift
 * from: a driveshaft sample every 25 ms jumps by hundreds of RPM.
 */

/** Seconds after the launch the run sheet shows the driveshaft at. */
export const DRIVESHAFT_TIMES = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * The preview stores the driveshaft every this many seconds out to
 * DRIVESHAFT_STORED_TO, so showing another time needs no new preview version.
 */
const DRIVESHAFT_STORED_STEP = 0.05;
const DRIVESHAFT_STORED_TO = 3;
const STORED_TIMES = Array.from(
  { length: Math.round(DRIVESHAFT_STORED_TO / DRIVESHAFT_STORED_STEP) },
  (_, k) => Math.round((k + 1) * DRIVESHAFT_STORED_STEP * 100) / 100,
);

/** Averaged over ±this many seconds, so one noisy sample can't set it. */
const DS_HALF_WINDOW_S = 0.02;

export interface DriveshaftReading {
  /** Seconds after the launch. */
  after: number;
  rpm: number;
}

export interface ShiftReading {
  /** Seconds after the launch the RPM peaked going into the shift. */
  at: number;
  /** Seconds from that peak to the low point the shift pulled it to. */
  takes: number;
  /** RPM from the peak to the low point. */
  drop: number;
}

export function readDriveshaft(session: LogSession, launchAt: number): DriveshaftReading[] | null {
  const ds = session.channels.get("Driveshaft RPM");
  if (!ds) return null;
  const ts = session.timestamps;
  const out: DriveshaftReading[] = [];
  for (const after of STORED_TIMES) {
    const from = launchAt + after - DS_HALF_WINDOW_S;
    const to = launchAt + after + DS_HALF_WINDOW_S;
    let sum = 0;
    let n = 0;
    for (let i = lowerBound(ts, from); i < ts.length && ts[i] <= to; i++) {
      if (Number.isFinite(ds[i])) {
        sum += ds[i];
        n++;
      }
    }
    if (n > 0) out.push({ after, rpm: sum / n });
  }
  return out;
}

/**
 * A converter can soak up most of a shift: one Corvette 1-2 fell only 1.7%
 * where its other passes fell 4–6%. The run sheet would rather show that shift
 * than leave a hole in its column.
 */
const SOFT_SHIFT_DROP_FRACTION = 0.015;

/** Upshifts from the launch to `passEnd`, found the same way as the chart's shift markers. */
export function readShifts(
  parsed: ParsedLog,
  session: LogSession,
  launchAt: number,
  passEnd: number | null,
): ShiftReading[] | null {
  const rpm = session.channels.get("RPM");
  if (!rpm) return null;
  const gearName = findGearChannel(parsed.channelDefs);
  const throttleName = findThrottleChannel(parsed.channelDefs);
  const shifts = shiftMarkers(
    session.timestamps,
    rpm,
    launchAt,
    gearName ? session.channels.get(gearName) : undefined,
    throttleName ? session.channels.get(throttleName) : undefined,
    SOFT_SHIFT_DROP_FRACTION,
  );
  return shifts
    .filter((s) => passEnd === null || s.peakT <= passEnd)
    .map((s) => ({ at: s.peakT - launchAt, takes: s.troughT - s.peakT, drop: s.peak - s.trough }));
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

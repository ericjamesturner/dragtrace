import type { Id } from "../../convex/_generated/dataModel";
import { detectRaceStartIndex } from "./haltech-parser";
import type { LoadedLog } from "./viewer-types";

const DEFAULT_PADDING_S = 0.5;
const MIN_PASS_S = 0.75;
const WOT_PERCENT = 95;
const MIN_WOT_PEAK_PERCENT = 85;
const MAX_SHIFT_DIP_S = 0.35;

type TimeWindow = [number, number];

function raceTimerWindow(log: LoadedLog): TimeWindow | null {
  const session = log.parsed.sessions[log.activeSessionIndex];
  if (!session) return null;
  const timer =
    session.channels.get("Race Timer") ?? session.channels.get("Race Time");
  if (!timer) return null;

  const startIndex = detectRaceStartIndex(timer);
  if (startIndex === null) return null;

  let previous = Number.NaN;
  let endIndex = startIndex;
  for (let i = startIndex; i < timer.length; i++) {
    const value = timer[i];
    if (!Number.isFinite(value)) continue;
    if (Number.isFinite(previous) && value > previous) endIndex = i;
    previous = value;
  }

  const start = session.timestamps[startIndex];
  const end = session.timestamps[endIndex];
  return Number.isFinite(start) && Number.isFinite(end) && end - start >= MIN_PASS_S
    ? [start, end]
    : null;
}

function throttleChannel(log: LoadedLog): Float64Array | null {
  const session = log.parsed.sessions[log.activeSessionIndex];
  if (!session) return null;
  const exact = session.channels.get("Throttle Position");
  if (exact) return exact;

  const fallbackName = [...session.channels.keys()].find((name) =>
    /^(?:tps(?: sensor)?|throttle position(?: sensor)?)$/i.test(name.trim()),
  );
  return fallbackName ? (session.channels.get(fallbackName) ?? null) : null;
}

/**
 * Find sustained wide-open-throttle runs without mistaking a gear-change for
 * the end of the pass. When a log also contains a burnout, the longest run
 * wins (and a later run wins a tie).
 */
function throttleWindow(log: LoadedLog): TimeWindow | null {
  const session = log.parsed.sessions[log.activeSessionIndex];
  const throttle = throttleChannel(log);
  if (!session || !throttle || throttle.length === 0) return null;

  let maxThrottle = -Infinity;
  for (let i = 0; i < throttle.length; i++) {
    if (Number.isFinite(throttle[i])) maxThrottle = Math.max(maxThrottle, throttle[i]);
  }
  if (!Number.isFinite(maxThrottle)) return null;

  // A few exporters log pedal position as 0..1 instead of 0..100.
  const scale = maxThrottle <= 1.5 ? 0.01 : 1;
  const peakPercent = maxThrottle / scale;
  if (peakPercent < MIN_WOT_PEAK_PERCENT) return null;

  // Treat the top of the observed range as WOT without requiring an exporter
  // to land on exactly 100.0. Normally this is 95%; the small relative
  // fallback accommodates channels calibrated a few percent below 100.
  const wotThreshold = Math.min(WOT_PERCENT, peakPercent * 0.98) * scale;
  const candidates: TimeWindow[] = [];
  let startIndex: number | null = null;
  let liftIndex: number | null = null;

  const finishCandidate = (endIndex: number) => {
    if (startIndex === null) return;
    const start = session.timestamps[startIndex];
    const end = session.timestamps[endIndex];
    if (Number.isFinite(start) && Number.isFinite(end) && end - start >= MIN_PASS_S) {
      candidates.push([start, end]);
    }
    startIndex = null;
    liftIndex = null;
  };

  for (let i = 0; i < throttle.length; i++) {
    const value = throttle[i];
    const time = session.timestamps[i];
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;

    if (startIndex === null) {
      if (value >= wotThreshold) startIndex = i;
      continue;
    }

    if (value >= wotThreshold) {
      liftIndex = null;
    } else {
      if (liftIndex === null) liftIndex = i;
      const liftTime = session.timestamps[liftIndex];
      if (Number.isFinite(liftTime) && time - liftTime >= MAX_SHIFT_DIP_S) {
        finishCandidate(liftIndex);
      }
    }
  }

  if (startIndex !== null) {
    finishCandidate(
      liftIndex ?? Math.min(throttle.length, session.timestamps.length) - 1,
    );
  }
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    const bestDuration = best[1] - best[0];
    const duration = candidate[1] - candidate[0];
    return duration > bestDuration ||
      (duration === bestDuration && candidate[0] > best[0])
      ? candidate
      : best;
  });
}

/**
 * Estimate the useful drag-pass window using only the log itself. An ECU race
 * wide-open throttle is preferred because it matches the useful pull more
 * closely than a timer that can keep counting through shutdown. The ECU race
 * timer remains the fallback when the log has no clear WOT run. Returns
 * aligned viewer time.
 */
export function inferPassWindow(
  logs: LoadedLog[],
  offsets: ReadonlyMap<Id<"files">, number>,
  globalRange: TimeWindow,
  paddingSeconds = DEFAULT_PADDING_S,
): TimeWindow | null {
  let start = Infinity;
  let end = -Infinity;

  for (const log of logs) {
    const local = throttleWindow(log) ?? raceTimerWindow(log);
    if (!local) continue;
    const offset = offsets.get(log.fileId) ?? 0;
    start = Math.min(start, local[0] + offset);
    end = Math.max(end, local[1] + offset);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const clamped: TimeWindow = [
    Math.max(globalRange[0], start - paddingSeconds),
    Math.min(globalRange[1], end + paddingSeconds),
  ];
  return clamped[1] - clamped[0] >= MIN_PASS_S ? clamped : null;
}

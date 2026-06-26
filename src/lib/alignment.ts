import type { Id } from "../../convex/_generated/dataModel";
import type { LoadedLog } from "./viewer-types";

export interface AlignedTimeline {
  offsets: Map<Id<"files">, number>;
  globalRange: [number, number];
}

/**
 * Compute time offsets so all logs' race starts align.
 *
 * When alignment is ON: each log's timestamps are shifted so that
 * all race start times coincide at x = maxPreRaceTime.
 *
 * When OFF: each log starts at t=0, no offset applied.
 */
export function computeAlignment(
  logs: LoadedLog[],
  align: boolean,
): AlignedTimeline {
  const offsets = new Map<Id<"files">, number>();

  if (!align) {
    let globalMax = 0;
    for (const log of logs) {
      offsets.set(log.fileId, 0);
      const session = log.parsed.sessions[log.activeSessionIndex];
      if (session) {
        const end = session.timestamps[session.timestamps.length - 1];
        if (end > globalMax) globalMax = end;
      }
    }
    return { offsets, globalRange: [0, globalMax] };
  }

  // Find the maximum pre-race time across all logs that have race starts
  const logsWithRace = logs.filter((l) => l.raceStartTime !== null);

  if (logsWithRace.length === 0) {
    // No race data — fall back to no alignment
    return computeAlignment(logs, false);
  }

  const maxPreRace = Math.max(...logsWithRace.map((l) => l.raceStartTime!));

  let globalMin = Infinity;
  let globalMax = -Infinity;

  for (const log of logs) {
    const session = log.parsed.sessions[log.activeSessionIndex];
    if (!session) {
      offsets.set(log.fileId, 0);
      continue;
    }

    const offset =
      log.raceStartTime !== null ? maxPreRace - log.raceStartTime : 0;

    offsets.set(log.fileId, offset);

    const sessionStart = session.timestamps[0] + offset;
    const sessionEnd = session.timestamps[session.timestamps.length - 1] + offset;

    if (sessionStart < globalMin) globalMin = sessionStart;
    if (sessionEnd > globalMax) globalMax = sessionEnd;
  }

  return {
    offsets,
    globalRange: [
      globalMin === Infinity ? 0 : globalMin,
      globalMax === -Infinity ? 0 : globalMax,
    ],
  };
}

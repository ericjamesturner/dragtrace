import type { Id } from "../../convex/_generated/dataModel";
import { addComputedChannels } from "./computed-channels";
import { enrichWithDefinitions } from "./ecu/enrich";
import { DEFAULT_ECU_TYPE } from "./ecu/registry";
import {
  detectHaltech,
  detectRaceStartIndex,
  parseHaltech,
} from "./haltech-parser";
import type { ParsedLog } from "./log-types";
import { CHART_COLORS, type LoadedLog } from "./viewer-types";

// Seconds of data kept before the race start when opening a log.
const CLIP_PRE_RACE_S = 2;

function detectRaceStart(
  parsed: ParsedLog,
  sessionIndex: number,
): number | null {
  const session = parsed.sessions[sessionIndex];
  if (!session) return null;
  const raceTimer =
    session.channels.get("Race Timer") ?? session.channels.get("Race Time");
  if (!raceTimer) return null;
  const idx = detectRaceStartIndex(raceTimer);
  return idx === null ? null : session.timestamps[idx];
}

/**
 * Drop everything before CLIP_PRE_RACE_S seconds ahead of the race start so
 * the viewer opens on the pull, and rebase timestamps to the clip point.
 */
function clipSessionBeforeRace(
  parsed: ParsedLog,
  sessionIndex: number,
  raceStartTime: number,
): number {
  const session = parsed.sessions[sessionIndex];
  const clipStart = raceStartTime - CLIP_PRE_RACE_S;
  if (!session || clipStart <= session.timestamps[0]) return raceStartTime;

  let lo = 0;
  while (lo < session.timestamps.length && session.timestamps[lo] < clipStart)
    lo++;
  if (lo === 0 || lo >= session.timestamps.length) return raceStartTime;

  const base = session.timestamps[lo];
  const rowCount = session.timestamps.length - lo;
  const timestamps = new Float64Array(rowCount);
  for (let i = 0; i < rowCount; i++) {
    timestamps[i] = session.timestamps[lo + i] - base;
  }
  const channels = new Map<string, Float64Array>();
  for (const [name, arr] of session.channels) {
    channels.set(name, arr.subarray(lo));
  }
  parsed.sessions[sessionIndex] = {
    ...session,
    timestamps,
    channels,
    rowCount,
  };
  return raceStartTime - base;
}

/** Parse and prepare one Haltech CSV, regardless of whether it came from
 * Convex storage or a guest's local file picker. */
export async function loadHaltechLog({
  text,
  fileId,
  fileName,
  index = 0,
}: {
  text: string;
  fileId: Id<"files">;
  fileName: string;
  index?: number;
}): Promise<LoadedLog> {
  if (!detectHaltech(text)) throw new Error("Not a Haltech datalog");

  const parsed = parseHaltech(text);
  if (parsed.sessions.length === 0) throw new Error("No log sessions found");

  const activeSessionIndex = 0;
  let raceStartTime = detectRaceStart(parsed, activeSessionIndex);
  if (raceStartTime !== null) {
    raceStartTime = clipSessionBeforeRace(
      parsed,
      activeSessionIndex,
      raceStartTime,
    );
  }
  await enrichWithDefinitions(parsed, DEFAULT_ECU_TYPE);
  addComputedChannels(parsed);

  return {
    fileId,
    fileName,
    parsed,
    activeSessionIndex,
    raceStartTime,
    logColor: CHART_COLORS[index % CHART_COLORS.length],
    logIndex: index,
  };
}

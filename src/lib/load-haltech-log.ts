import type { Id } from "../../convex/_generated/dataModel";
import { addComputedChannels } from "./computed-channels";
import { parseDatalogBytes } from "./datalog-parser";
import { enrichWithDefinitions } from "./ecu/enrich";
import { DEFAULT_ECU_TYPE } from "./ecu/registry";
import { detectRaceStartIndex } from "./haltech-parser";
import type { LogSession, ParsedLog } from "./log-types";
import { CHART_COLORS, type LoadedLog, type LogRecording } from "./viewer-types";

// Seconds of data kept before the race start when opening a log.
const CLIP_PRE_RACE_S = 2;

async function fingerprint(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes,
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

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
  session: LogSession,
  raceStartTime: number,
): { session: LogSession; raceStartTime: number; clipStartTime: number } {
  const clipStart = raceStartTime - CLIP_PRE_RACE_S;
  if (clipStart <= session.timestamps[0]) {
    return { session, raceStartTime, clipStartTime: 0 };
  }

  let lo = 0;
  while (lo < session.timestamps.length && session.timestamps[lo] < clipStart)
    lo++;
  if (lo === 0 || lo >= session.timestamps.length) {
    return { session, raceStartTime, clipStartTime: 0 };
  }

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
  return {
    session: { ...session, timestamps, channels, rowCount },
    raceStartTime: raceStartTime - base,
    clipStartTime: base,
  };
}

/**
 * The recording with the pass in it: the first with nearly as much
 * wide-open throttle as the most any recording has. The race timer can't
 * tell — it starts on burnouts too. 0 when nothing ran wide open.
 */
export function passSessionIndex(parsed: ParsedLog): number {
  const wot = parsed.sessions.map((s) => {
    const tps = s.channels.get("Throttle Position");
    if (!tps) return 0;
    let seconds = 0;
    for (let i = 1; i < s.timestamps.length; i++) {
      if (tps[i] >= 90 && tps[i - 1] >= 90) seconds += s.timestamps[i] - s.timestamps[i - 1];
    }
    return seconds;
  });
  const most = Math.max(0, ...wot);
  if (most < 1) return 0;
  return wot.findIndex((w) => w >= 0.8 * most);
}

/** Prepare each recording once, keeping the original data and maps intact. */
export function prepareLogRecordings(parsed: ParsedLog): {
  parsed: ParsedLog;
  sourceSessions: readonly LogSession[];
  recordings: LogRecording[];
} {
  const recordings: LogRecording[] = [];
  const sessions = parsed.sessions.map((source, sessionIndex) => {
    // Computed channels are added to these maps later. They must never leak
    // into the original recording's map, including recordings needing no clip.
    const view: LogSession = {
      ...source,
      channels: new Map(source.channels),
      channelStatus: new Map(source.channelStatus),
    };
    const sourceRaceStart = detectRaceStart(parsed, sessionIndex);
    const prepared = sourceRaceStart === null
      ? { session: view, raceStartTime: null, clipStartTime: 0 }
      : clipSessionBeforeRace(view, sourceRaceStart);
    const timestamps = source.timestamps;
    recordings.push({
      sessionIndex,
      label: source.label,
      startTime: source.startTime,
      sourceDuration: timestamps.length > 0
        ? Math.max(0, timestamps[timestamps.length - 1] - timestamps[0])
        : 0,
      sourceRowCount: source.rowCount,
      channelCount: source.channels.size,
      raceStartTime: prepared.raceStartTime,
      clipStartTime: prepared.clipStartTime,
    });
    return prepared.session;
  });
  return {
    parsed: { ...parsed, channelDefs: parsed.channelDefs.map((definition) => ({ ...definition })), sessions },
    sourceSessions: parsed.sessions,
    recordings,
  };
}

/** Metadata for the recording picker, including older in-memory log fixtures. */
export function getLogRecordings(log: LoadedLog): LogRecording[] {
  if (log.recordings) return log.recordings;
  return log.parsed.sessions.map((session, sessionIndex) => ({
    sessionIndex,
    label: session.label,
    startTime: session.startTime,
    sourceDuration: session.timestamps.length > 0
      ? Math.max(0, session.timestamps[session.timestamps.length - 1] - session.timestamps[0])
      : 0,
    sourceRowCount: session.rowCount,
    channelCount: session.channels.size,
    raceStartTime: sessionIndex === log.activeSessionIndex
      ? log.raceStartTime
      : detectRaceStart(log.parsed, sessionIndex),
    clipStartTime: 0,
  }));
}

/** Selecting a recording changes its view, never its original or prepared data. */
export function selectLogRecording(log: LoadedLog, sessionIndex: number): LoadedLog {
  if (
    !Number.isSafeInteger(sessionIndex) ||
    sessionIndex < 0 ||
    sessionIndex >= log.parsed.sessions.length
  ) {
    throw new RangeError("Recording index is outside this log's recordings");
  }
  if (sessionIndex === log.activeSessionIndex) return log;
  return {
    ...log,
    activeSessionIndex: sessionIndex,
    raceStartTime: getLogRecordings(log)[sessionIndex].raceStartTime,
  };
}

/** Parse and prepare one supported ECU log, regardless of whether it came
 * from Convex storage or a guest's local file picker. */
export async function loadDatalog({
  bytes,
  fileId,
  fileName,
  index = 0,
}: {
  bytes: ArrayBuffer;
  fileId: Id<"files">;
  fileName: string;
  index?: number;
}): Promise<LoadedLog> {
  // Start this before parsing so the browser can hash while the rest of the
  // log is being prepared. Only the digest leaves the browser in guest mode.
  const contentFingerprint = fingerprint(bytes);

  const source = await parseDatalogBytes(bytes, fileName);
  if (source.sessions.length === 0) throw new Error("No log sessions found");
  if (source.format === "Haltech") {
    await enrichWithDefinitions(source, DEFAULT_ECU_TYPE);
  }
  // Open on the pass, not on a burnout or warm-up recorded before it.
  const pass = passSessionIndex(source);
  const prepared = prepareLogRecordings(source);
  addComputedChannels(prepared.parsed);

  return {
    fileId,
    fileName,
    contentFingerprint: await contentFingerprint,
    ...prepared,
    activeSessionIndex: pass,
    passSessionIndex: pass,
    raceStartTime: prepared.recordings[pass].raceStartTime,
    logColor: CHART_COLORS[index % CHART_COLORS.length],
    logIndex: index,
  };
}

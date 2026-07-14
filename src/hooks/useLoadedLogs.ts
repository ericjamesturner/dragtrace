import { useState, useEffect, useRef, useMemo } from "react";
import { useQueries } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { detectHaltech, detectRaceStartIndex, parseHaltech } from "@/lib/haltech-parser";
import type { ParsedLog } from "@/lib/log-types";
import { CHART_COLORS, type LoadedLog } from "@/lib/viewer-types";

function detectRaceStart(parsed: ParsedLog, sessionIndex: number): number | null {
  const session = parsed.sessions[sessionIndex];
  if (!session) return null;
  const raceTimer =
    session.channels.get("Race Timer") ?? session.channels.get("Race Time");
  if (!raceTimer) return null;
  const idx = detectRaceStartIndex(raceTimer);
  return idx === null ? null : session.timestamps[idx];
}

// Seconds of data kept before the race start when opening a log.
const CLIP_PRE_RACE_S = 2;

/**
 * Drop everything before CLIP_PRE_RACE_S seconds ahead of the race start so
 * the viewer opens on the pull, and rebase timestamps to the clip point.
 * Returns the race start time in the new (rebased) timebase.
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
  while (lo < session.timestamps.length && session.timestamps[lo] < clipStart) lo++;
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
  parsed.sessions[sessionIndex] = { ...session, timestamps, channels, rowCount };
  return raceStartTime - base;
}

/**
 * Hook to load multiple log files for the viewer.
 * Uses Convex useQueries for batch file doc loading, then fetches & parses.
 */
export function useLoadedLogs(fileIds: Id<"files">[]) {
  const [logs, setLogs] = useState<LoadedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const cacheRef = useRef<Map<string, LoadedLog>>(new Map());

  // Build stable query objects for file docs
  const fileQueries = useMemo(() => {
    const q: Record<string, { query: typeof api.files.get; args: { id: Id<"files"> } }> = {};
    for (let i = 0; i < fileIds.length; i++) {
      q[`f${i}`] = { query: api.files.get, args: { id: fileIds[i] } };
    }
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(",")]);

  const fileResults = useQueries(fileQueries);

  // Build URL queries from loaded docs
  const urlQueries = useMemo(() => {
    const q: Record<string, { query: typeof api.files.getUrl; args: { storageId: Id<"_storage"> } }> = {};
    for (let i = 0; i < fileIds.length; i++) {
      const doc = fileResults[`f${i}`];
      if (doc && !(doc instanceof Error) && doc.storageId) {
        q[`u${i}`] = { query: api.files.getUrl, args: { storageId: doc.storageId } };
      }
    }
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(","), fileIds.map((_, i) => {
    const doc = fileResults[`f${i}`];
    return doc && !(doc instanceof Error) ? doc.storageId : "";
  }).join(",")]);

  const urlResults = useQueries(urlQueries);

  // Check if all data is ready
  const allReady = useMemo(() => {
    for (let i = 0; i < fileIds.length; i++) {
      const doc = fileResults[`f${i}`];
      if (doc === undefined) return false;
      if (doc === null || doc instanceof Error) continue;
      const url = urlResults[`u${i}`];
      if (url === undefined) return false;
    }
    return true;
  }, [fileIds, fileResults, urlResults]);

  useEffect(() => {
    if (!allReady) return;

    let cancelled = false;

    async function loadAll() {
      const cache = cacheRef.current;
      const results: LoadedLog[] = [];
      const errs: string[] = [];

      const toFetch: {
        index: number;
        fileId: Id<"files">;
        fileName: string;
        url: string;
      }[] = [];

      for (let i = 0; i < fileIds.length; i++) {
        const doc = fileResults[`f${i}`];
        if (!doc || doc instanceof Error) continue;
        const url = urlResults[`u${i}`];
        if (!url || url instanceof Error) continue;

        const fileId = fileIds[i];
        const cached = cache.get(fileId);
        if (cached) {
          results[i] = { ...cached, logColor: CHART_COLORS[i % CHART_COLORS.length], logIndex: i };
          continue;
        }

        toFetch.push({ index: i, fileId, fileName: doc.fileName, url: url as string });
      }

      await Promise.all(
        toFetch.map(async ({ index, fileId, fileName, url }) => {
          try {
            const res = await fetch(url);
            const text = await res.text();
            if (cancelled) return;

            if (!detectHaltech(text)) {
              errs.push(`${fileName}: Not a Haltech log`);
              return;
            }

            const parsed = parseHaltech(text);
            if (parsed.sessions.length === 0) {
              errs.push(`${fileName}: No sessions`);
              return;
            }

            const activeSessionIndex = 0;
            let raceStartTime = detectRaceStart(parsed, activeSessionIndex);
            if (raceStartTime !== null) {
              raceStartTime = clipSessionBeforeRace(parsed, activeSessionIndex, raceStartTime);
            }

            const log: LoadedLog = {
              fileId,
              fileName,
              parsed,
              activeSessionIndex,
              raceStartTime,
              logColor: CHART_COLORS[index % CHART_COLORS.length],
              logIndex: index,
            };

            cache.set(fileId, log);
            results[index] = log;
          } catch (err) {
            if (!cancelled) {
              errs.push(`${fileName}: ${err instanceof Error ? err.message : "Failed to load"}`);
            }
          }
        })
      );

      if (!cancelled) {
        setLogs(results.filter(Boolean));
        setErrors(errs);
        setLoading(false);
      }
    }

    void loadAll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady, fileIds.join(",")]);

  return { logs, loading, errors };
}

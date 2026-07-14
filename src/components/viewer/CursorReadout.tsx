import type { LoadedLog, TraceConfig } from "@/lib/viewer-types";
import { resolveChannelStyle } from "@/lib/viewer-types";
import type { Id } from "../../../convex/_generated/dataModel";
import { TimerIcon } from "lucide-react";

interface Props {
  cursorTime: number | null;
  traces: TraceConfig[];
  logs: LoadedLog[];
  offsets: Map<Id<"files">, number>;
}

function findValueAtTime(
  log: LoadedLog,
  channelName: string,
  time: number,
  offset: number,
): number | null {
  const session = log.parsed.sessions[log.activeSessionIndex];
  if (!session) return null;
  const data = session.channels.get(channelName);
  if (!data) return null;
  const ts = session.timestamps;
  const targetTime = time - offset;

  // Outside range
  if (targetTime < ts[0] || targetTime > ts[ts.length - 1]) return null;

  // Binary search for first index where ts[lo] >= targetTime
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < targetTime) lo = mid + 1;
    else hi = mid;
  }

  // Exact match or at start
  if (lo === 0 || ts[lo] === targetTime) {
    const v = data[lo];
    return v !== v ? null : v;
  }

  // Linear interpolation between lo-1 and lo
  const t0 = ts[lo - 1], t1 = ts[lo];
  const v0 = data[lo - 1], v1 = data[lo];
  if (v0 !== v0 && v1 !== v1) return null;
  if (v0 !== v0) return v1;
  if (v1 !== v1) return v0;
  const frac = t1 !== t0 ? (targetTime - t0) / (t1 - t0) : 0;
  return v0 + frac * (v1 - v0);
}

function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function CursorReadout({ cursorTime, traces, logs, offsets }: Props) {
  if (cursorTime === null) return null;

  const items: { channelName: string; value: number; color: string; opacity: number; logName: string }[] = [];

  for (const trace of traces) {
    // Compute per-log channel index
    const logCounters = new Map<string, number>();

    for (const ch of trace.channels) {
      const log = logs.find((l) => l.fileId === ch.logFileId);
      if (!log) continue;
      const lid = ch.logFileId as string;
      const chIdx = logCounters.get(lid) ?? 0;
      logCounters.set(lid, chIdx + 1);

      const offset = offsets.get(log.fileId) ?? 0;
      const val = findValueAtTime(log, ch.channelName, cursorTime, offset);
      if (val === null) continue;

      const resolved = resolveChannelStyle(ch, chIdx, log.logIndex);

      items.push({
        channelName: ch.channelName,
        value: val,
        color: resolved.color,
        opacity: resolved.opacity,
        logName: log.fileName.replace(/\.[^.]+$/, ""),
      });
    }
  }

  if (items.length === 0) return null;

  // Compute race time from the first log that has a race start
  let raceTimeStr: string | null = null;
  for (const log of logs) {
    if (log.raceStartTime !== null) {
      const offset = offsets.get(log.fileId) ?? 0;
      const raceTime = cursorTime - (log.raceStartTime + offset);
      raceTimeStr = `${raceTime.toFixed(3)}s`;
      break;
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 border-t bg-muted/30 text-xs">
      {raceTimeStr && (
        <span className="text-red-400 flex items-center gap-1"><TimerIcon className="size-3" /><span className="text-red-400/60">Race Time: </span><span className="font-mono">{raceTimeStr}</span></span>
      )}
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color, opacity: item.opacity }} />
          <span className="text-muted-foreground">{item.channelName}</span>
          <span className="font-mono font-medium">{formatValue(item.value)}</span>
        </span>
      ))}
    </div>
  );
}

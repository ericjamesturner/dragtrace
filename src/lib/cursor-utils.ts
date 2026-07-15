import type { LoadedLog } from "./viewer-types";

export function findValueAtTime(
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

  if (targetTime < ts[0] || targetTime > ts[ts.length - 1]) return null;

  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < targetTime) lo = mid + 1;
    else hi = mid;
  }

  if (lo === 0 || ts[lo] === targetTime) {
    const v = data[lo];
    return v !== v ? null : v;
  }

  const t0 = ts[lo - 1], t1 = ts[lo];
  const v0 = data[lo - 1], v1 = data[lo];
  if (v0 !== v0 && v1 !== v1) return null;
  if (v0 !== v0) return v1;
  if (v1 !== v1) return v0;
  const frac = t1 !== t0 ? (targetTime - t0) / (t1 - t0) : 0;
  return v0 + frac * (v1 - v0);
}

/**
 * Average/min/max of a channel's samples over a [tMin, tMax] display-time
 * range. Mirrors findValueAtTime's offset convention (channel timestamps are
 * raw; the selection is in aligned/display time, so we subtract `offset`).
 * Returns null if the channel/session is missing or no samples fall in range.
 */
export function computeRangeStats(
  log: LoadedLog,
  channelName: string,
  range: [number, number],
  offset: number,
): { avg: number; min: number; max: number; minTime: number; maxTime: number } | null {
  const session = log.parsed.sessions[log.activeSessionIndex];
  if (!session) return null;
  const data = session.channels.get(channelName);
  if (!data) return null;
  const ts = session.timestamps;
  if (ts.length === 0) return null;
  const lo = Math.min(range[0], range[1]) - offset;
  const hi = Math.max(range[0], range[1]) - offset;
  if (hi < ts[0] || lo > ts[ts.length - 1]) return null;

  // Binary search: first index where ts[i] >= lo
  let s = 0, e = ts.length - 1;
  while (s < e) {
    const m = (s + e) >> 1;
    if (ts[m] < lo) s = m + 1;
    else e = m;
  }

  let sum = 0, count = 0, min = Infinity, max = -Infinity, minIdx = -1, maxIdx = -1;
  for (let i = s; i < ts.length && ts[i] <= hi; i++) {
    const v = data[i];
    if (v !== v) continue; // skip NaN
    sum += v;
    count++;
    if (v < min) { min = v; minIdx = i; }
    if (v > max) { max = v; maxIdx = i; }
  }
  if (count === 0) return null;
  // Times are returned in aligned/display time (offset added back)
  return { avg: sum / count, min, max, minTime: ts[minIdx] + offset, maxTime: ts[maxIdx] + offset };
}

/**
 * Binary-search the nearest sample index for a time `t` expressed in the
 * channel's *local* timestamp space (i.e. aligned time minus the log offset).
 * Returns the index of the closest timestamp. Used for scatter highlight sync.
 */
export function findIndexAtTime(ts: Float64Array, t: number): number {
  if (ts.length === 0) return 0;
  if (t <= ts[0]) return 0;
  if (t >= ts[ts.length - 1]) return ts.length - 1;
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(ts[lo - 1] - t) < Math.abs(ts[lo] - t) ? lo - 1 : lo;
}

export function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function formatDuration(seconds: number): string {
  if (seconds < 0.1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 10) return `${seconds.toFixed(2)}s`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

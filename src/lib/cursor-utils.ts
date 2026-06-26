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

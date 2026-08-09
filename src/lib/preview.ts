/**
 * The precomputed shape of a pass, stored on the file when its dashboard
 * thumbnail is first drawn. Reused wherever a run needs to be recognised at a
 * glance without fetching and reparsing megabytes of log.
 */
export interface PreviewPayload {
  version: number;
  timestamps: number[];
  rpm: (number | null)[];
  tps: (number | null)[] | null;
  dsRpm: (number | null)[] | null;
  raceStart: number | null;
  raceEnd: number | null;
  logDuration: number;
}

export function parsePreview(raw: string | undefined | null): PreviewPayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PreviewPayload;
    return Array.isArray(p?.rpm) && Array.isArray(p?.timestamps) ? p : null;
  } catch {
    return null;
  }
}

/** A run's shape over a real time axis, so cards can share one scale. */
export interface RaceSeries {
  times: number[];
  values: (number | null)[];
  /** Seconds from the start of the window to the end of the run. */
  duration: number;
}

/**
 * The run itself, with a short lead-in so the launch is legible — the line
 * starts at the bottom rather than mid-rise. The stored preview begins 5s
 * before the race, so any lead-in up to that needs no recomputation.
 */
export function raceSeries(p: PreviewPayload, leadInSeconds = 1): RaceSeries {
  const start = p.raceStart === null ? p.timestamps[0] ?? 0 : p.raceStart - leadInSeconds;
  const end = p.raceStart === null ? p.logDuration : p.raceEnd ?? p.logDuration;
  const times: number[] = [];
  const values: (number | null)[] = [];
  for (let i = 0; i < p.timestamps.length; i++) {
    const t = p.timestamps[i];
    if (t < start || t > end) continue;
    times.push(t - start);
    values.push(p.rpm[i]);
  }
  if (times.length < 2) {
    return { times: p.timestamps.map((t) => t - (p.timestamps[0] ?? 0)), values: p.rpm, duration: p.logDuration };
  }
  return { times, values, duration: times[times.length - 1] };
}

/**
 * An SVG path over a fixed time span, so every card is drawn to the same scale
 * and a shorter run visibly ends earlier instead of being stretched to fill the
 * width. Gaps (nulls, from sensor faults or unsampled rows) break the line
 * rather than being bridged, so the shape can't imply data that isn't there.
 */
export function sparklinePath(
  series: RaceSeries,
  spanSeconds: number,
  width: number,
  height: number,
  pad = 1,
): string {
  const { times, values } = series;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "";
  const span = max - min || 1;
  const tSpan = spanSeconds > 0 ? spanSeconds : series.duration || 1;
  const innerH = height - pad * 2;

  let d = "";
  let penDown = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      penDown = false;
      continue;
    }
    const x = (times[i] / tSpan) * width;
    const y = pad + innerH - ((v - min) / span) * innerH;
    d += `${penDown ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    penDown = true;
  }
  return d;
}

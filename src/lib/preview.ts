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

/**
 * An SVG path for a series, scaled to a box. Gaps (nulls, from sensor faults or
 * unsampled rows) break the line rather than being bridged, so the sparkline
 * can't imply data that isn't there.
 */
export function sparklinePath(
  values: (number | null)[],
  width: number,
  height: number,
  pad = 1,
): string {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "";
  const span = max - min || 1;
  const innerH = height - pad * 2;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  let d = "";
  let penDown = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      penDown = false;
      continue;
    }
    const x = i * stepX;
    const y = pad + innerH - ((v - min) / span) * innerH;
    d += `${penDown ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    penDown = true;
  }
  return d;
}

/**
 * Trim a preview to the run itself, so staging and the burnout don't flatten
 * the part anyone cares about. A short lead-in keeps the launch legible — the
 * line starts at the bottom rather than mid-rise.
 *
 * The stored preview begins 5 s before the race, so any lead-in up to that is
 * available without recomputing anything.
 */
export function raceWindow(p: PreviewPayload, leadInSeconds = 1): (number | null)[] {
  if (p.raceStart === null) return p.rpm;
  const start = p.raceStart - leadInSeconds;
  const end = p.raceEnd ?? p.logDuration;
  const out: (number | null)[] = [];
  for (let i = 0; i < p.timestamps.length; i++) {
    const t = p.timestamps[i];
    if (t >= start && t <= end) out.push(p.rpm[i]);
  }
  return out.length > 1 ? out : p.rpm;
}

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { LoadedLog } from "@/lib/viewer-types";
import type { EvaluatedZone } from "@/hooks/useEvaluatedZones";

type SlipKey = "sixtyFt" | "threeThirty" | "eighthEt" | "thousandFt" | "et";

/**
 * Format a timeslip time at its stored precision, up to 3dp and never padded —
 * 6.325 stays 6.325, a 6.3 dial stays 6.3. Matches the sidebar readout, which
 * prints the raw stored value. toFixed first so float noise can't leak through.
 */
export function formatSlipTime(seconds: number): string {
  return String(parseFloat(seconds.toFixed(3)));
}

// Distance markers in run order; keys match the `timeslips` table fields.
// `feet` is the marker's distance from the start line; `mphKey` is set only
// where the slip actually traps a speed (the 1/8 and 1/4 mile lights).
const TIMESLIP_SEGMENTS: {
  key: SlipKey;
  label: string;
  color: string;
  feet: number;
  mphKey?: "eighthMph" | "mph";
}[] = [
  { key: "sixtyFt", label: "60'", color: "#ef4444", feet: 60 }, // red
  { key: "threeThirty", label: "330'", color: "#f59e0b", feet: 330 }, // amber
  { key: "eighthEt", label: "660'", color: "#22c55e", feet: 660, mphKey: "eighthMph" }, // green (1/8 mi)
  { key: "thousandFt", label: "1000'", color: "#14b8a6", feet: 1000 }, // teal
  { key: "et", label: "1320'", color: "#3b82f6", feet: 1320, mphKey: "mph" }, // blue (1/4 mi)
];

const FT_PER_SEC_PER_MPH = 5280 / 3600;

/**
 * Convert each loaded file's timeslip(s) into a synthetic EvaluatedZone whose
 * regions each carry their own segment color, anchored at the log's detected
 * race-start (raceStartTime + alignment offset).
 *
 * These render as a solid band — one row per zone — across the bottom of every
 * trace (TraceChart's timeslip plugin) and again above the OverviewBar minimap.
 * Both draw straight from `regions`; neither goes through the highlight-zone
 * strip plugin.
 */
type Knot = { t: number; d: number; slope?: number };

/**
 * (time, distance) knots for a slip: the launch plus every checkpoint. Slopes
 * are the car's speed where we actually know it — zero at the launch (standing
 * start) and the trapped speed at the 1/8 and 1/4 lights.
 */
function knotsFor(zone: EvaluatedZone): Knot[] | null {
  const rs = zone.regions;
  if (rs.length === 0) return null;
  const knots: Knot[] = [{ t: rs[0].start, d: 0, slope: 0 }];
  for (const r of rs) {
    if (r.feet == null) return null;
    knots.push({
      t: r.end,
      d: r.feet,
      slope: r.mph != null ? r.mph * FT_PER_SEC_PER_MPH : undefined,
    });
  }
  return knots.length >= 2 ? knots : null;
}

/** Fritsch–Carlson slopes: shape-preserving, so the fit can't overshoot a
 *  checkpoint or run backwards down the track between two of them. */
function monotoneSlopes(k: Knot[]): number[] {
  const n = k.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = k[i + 1].t - k[i].t;
    delta[i] = (k[i + 1].d - k[i].d) / h[i];
  }
  const m: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (k[i].slope != null) m[i] = k[i].slope!;
    else if (i === 0) m[0] = delta[0];
    else if (i === n - 1) m[n - 1] = delta[n - 2];
    else m[i] = (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    if (a < 0) m[i] = 0;
    if (b < 0) m[i + 1] = 0;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * delta[i];
      m[i + 1] = tau * b * delta[i];
    }
  }
  return m;
}

/**
 * Distance down track (feet) at an absolute chart time, from the slip alone.
 *
 * Exact at every checkpoint. Between checkpoints it's an ESTIMATE: a monotone
 * cubic through them, pinned to zero speed at the launch and to the trapped mph
 * at the 1/8 and 1/4 lights. That curvature matters — a straight line between
 * checkpoints assumes constant speed and reads long early in each segment,
 * where the car is still accelerating hardest.
 *
 * Returns null outside launch → final marker rather than extrapolating.
 */
export function distanceAtTime(zone: EvaluatedZone, t: number): number | null {
  const k = knotsFor(zone);
  if (!k) return null;
  const n = k.length;
  if (t < k[0].t || t > k[n - 1].t) return null;
  const m = monotoneSlopes(k);
  let i = 0;
  while (i < n - 2 && t > k[i + 1].t) i++;
  const h = k[i + 1].t - k[i].t;
  if (h <= 0) return k[i].d;
  const s = (t - k[i].t) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * k[i].d +
    (s3 - 2 * s2 + s) * h * m[i] +
    (-2 * s3 + 3 * s2) * k[i + 1].d +
    (s3 - s2) * h * m[i + 1]
  );
}

/** The slip anchored at a given launch time, so the distance readout pairs with
 *  the same log whose race time is being shown. */
export function findSlipAtLaunch(
  zones: EvaluatedZone[] | undefined,
  launch: number,
): EvaluatedZone | null {
  if (!zones) return null;
  return (
    zones.find((z) => z.regions.length > 0 && Math.abs(z.regions[0].start - launch) < 1e-6) ?? null
  );
}

export function buildTimeslipZones(
  logs: LoadedLog[],
  timeslipsByFile: Map<Id<"files">, Doc<"timeslips">[]>,
  offsets: Map<Id<"files">, number>,
  show: boolean,
): EvaluatedZone[] {
  if (!show) return [];
  const zones: EvaluatedZone[] = [];
  for (const log of logs) {
    if (log.raceStartTime == null) continue; // no detectable launch -> skip
    const launch = log.raceStartTime + (offsets.get(log.fileId) ?? 0);
    for (const slip of timeslipsByFile.get(log.fileId) ?? []) {
      const regions: EvaluatedZone["regions"] = [];
      let prev = launch;
      let lastLabel = "";
      let lastEt = 0;
      for (const seg of TIMESLIP_SEGMENTS) {
        const elapsed = slip[seg.key];
        if (elapsed == null || elapsed <= 0) continue;
        const end = launch + elapsed;
        const mph = seg.mphKey ? slip[seg.mphKey] : undefined;
        // label = distance marker, time = cumulative ET at that marker,
        // feet = marker distance, mph = trap speed where the slip has one
        regions.push({
          start: prev,
          end,
          color: seg.color,
          label: seg.label,
          time: elapsed,
          feet: seg.feet,
          ...(mph != null && mph > 0 ? { mph } : {}),
        });
        prev = end;
        lastLabel = seg.label;
        lastEt = elapsed;
      }
      if (regions.length === 0) continue;
      zones.push({
        config: {
          id: `timeslip:${slip._id}`,
          expression: "",
          // Fallback color for anything drawing the zone rather than its
          // regions; every timeslip region sets its own.
          color: regions[0].color ?? TIMESLIP_SEGMENTS[0].color,
          label: `${lastLabel} ${formatSlipTime(lastEt)}s`, // e.g. "1320' 11.234s"
          enabled: true,
        },
        regions,
        error: null,
      });
    }
  }
  return zones;
}

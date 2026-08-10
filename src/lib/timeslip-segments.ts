import type { Doc } from "../../convex/_generated/dataModel";

/** Marker-to-marker splits derived from a slip's cumulative clocks. */
export const SEGMENTS = [
  { key: "seg60_330", label: "60-330", from: "sixtyFt", to: "threeThirty" },
  { key: "seg330_660", label: "330-660", from: "threeThirty", to: "eighthEt" },
  { key: "seg660_1000", label: "660-1000", from: "eighthEt", to: "thousandFt" },
  { key: "seg1000_1320", label: "1000-1320", from: "thousandFt", to: "et" },
] as const;
export type SegmentKey = (typeof SEGMENTS)[number]["key"];

/** Each segment time a slip's clocks can support, rounded to slip precision so
 *  equal splits compare equal for the best-of-event highlight. */
export function segmentTimes(ts: Doc<"timeslips">): Partial<Record<SegmentKey, number>> {
  const out: Partial<Record<SegmentKey, number>> = {};
  for (const s of SEGMENTS) {
    const from = ts[s.from];
    const to = ts[s.to];
    if (from === undefined || to === undefined || from <= 0 || to <= from) continue;
    out[s.key] = parseFloat((to - from).toFixed(3));
  }
  return out;
}

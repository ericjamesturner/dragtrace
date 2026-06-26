import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { LoadedLog } from "@/lib/viewer-types";
import type { EvaluatedZone } from "@/hooks/useEvaluatedZones";

type SlipKey = "sixtyFt" | "threeThirty" | "eighthEt" | "thousandFt" | "et";

// Distance markers in run order; keys match the `timeslips` table fields.
const TIMESLIP_SEGMENTS: { key: SlipKey; label: string; color: string }[] = [
  { key: "sixtyFt", label: "60'", color: "#ef4444" }, // red
  { key: "threeThirty", label: "330'", color: "#f59e0b" }, // amber
  { key: "eighthEt", label: "660'", color: "#22c55e" }, // green (1/8 mi)
  { key: "thousandFt", label: "1000'", color: "#14b8a6" }, // teal
  { key: "et", label: "1320'", color: "#3b82f6" }, // blue (1/4 mi)
];

/**
 * Convert each loaded file's timeslip(s) into a synthetic EvaluatedZone whose
 * regions each carry their own segment color, anchored at the log's detected
 * race-start (raceStartTime + alignment offset). These render through the
 * existing highlight-zone strip plugin in TraceChart on every trace.
 *
 * Zone ids are prefixed `timeslip:<_id>` so the chart can route their
 * expand/collapse to the persisted `expandedTimeslipIds` config (not the
 * ephemeral expression-zone Set).
 */
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
      const regions: { start: number; end: number; color: string }[] = [];
      let prev = launch;
      let lastLabel = "";
      let lastEt = 0;
      for (const seg of TIMESLIP_SEGMENTS) {
        const elapsed = slip[seg.key];
        if (elapsed == null || elapsed <= 0) continue;
        const end = launch + elapsed;
        regions.push({ start: prev, end, color: seg.color });
        prev = end;
        lastLabel = seg.label;
        lastEt = elapsed;
      }
      if (regions.length === 0) continue;
      zones.push({
        config: {
          id: `timeslip:${slip._id}`,
          expression: "",
          color: regions[0].color, // checkbox + label pill color
          label: `${lastLabel} ${lastEt.toFixed(3)}s`, // e.g. "1320' 11.234s"
          enabled: true,
        },
        regions,
        error: null,
      });
    }
  }
  return zones;
}

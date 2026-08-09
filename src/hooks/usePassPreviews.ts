import { useMemo } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { parsePreview, raceSeries, type RaceSeries } from "@/lib/preview";

/** Lead-in before the launch, and a little room past the finish line. */
export const LEAD_IN_SECONDS = 1;
const FINISH_TAIL_SECONDS = 0.5;

/**
 * The shape of each run, trimmed to the run itself and drawn to one time axis.
 *
 * Each card is cut to its own elapsed time: the race timer keeps counting past
 * the stripe, so how much log follows a pass says nothing about the pass — left
 * alone it makes near-identical runs look wildly different. And the axis is
 * shared across every card, so equal time is equal width and the launch sits in
 * the same place on each.
 */
export function usePassPreviews(
  files: Doc<"files">[],
  timeslips: Map<Id<"files">, Doc<"timeslips">[]>,
): { seriesByFile: Map<string, RaceSeries | null>; spanSeconds: number } {
  const parsed = useMemo(() => {
    const map = new Map<string, RaceSeries | null>();
    for (const f of files) {
      const preview = parsePreview(f.preview);
      map.set(f._id, preview ? raceSeries(preview) : null);
    }
    return map;
  }, [files]);

  const seriesByFile = useMemo(() => {
    const out = new Map<string, RaceSeries | null>();
    for (const [fileId, series] of parsed) {
      const slip = timeslips.get(fileId as Id<"files">)?.[0];
      const et = slip?.et ?? slip?.eighthEt;
      if (!series || et === undefined) {
        out.set(fileId, series);
        continue;
      }
      const cutoff = LEAD_IN_SECONDS + et + FINISH_TAIL_SECONDS;
      let end = series.times.length;
      for (let i = 0; i < series.times.length; i++) {
        if (series.times[i] > cutoff) { end = i; break; }
      }
      out.set(
        fileId,
        end > 1
          ? {
              times: series.times.slice(0, end),
              rpm: series.rpm.slice(0, end),
              tps: series.tps ? series.tps.slice(0, end) : null,
              dsRpm: series.dsRpm ? series.dsRpm.slice(0, end) : null,
              duration: series.times[end - 1],
            }
          : series,
      );
    }
    return out;
  }, [parsed, timeslips]);

  const spanSeconds = useMemo(() => {
    let longestEt = 0;
    for (const [, slips] of timeslips) {
      const t = slips[0];
      const et = t?.et ?? t?.eighthEt;
      if (et !== undefined && et > longestEt) longestEt = et;
    }
    if (longestEt > 0) return LEAD_IN_SECONDS + longestEt + FINISH_TAIL_SECONDS;
    // No slips entered yet: fall back to the longest recorded window.
    let longest = 0;
    for (const [, s] of parsed) if (s && s.duration > longest) longest = s.duration;
    return longest || 1;
  }, [timeslips, parsed]);

  return { seriesByFile, spanSeconds };
}

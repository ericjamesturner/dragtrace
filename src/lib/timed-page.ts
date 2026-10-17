import type { ChannelOnTrace, PageConfig } from "./viewer-types";
import type { ParsedLog } from "./log-types";
import type { Id } from "../../convex/_generated/dataModel";
import { findChannel } from "./timed-tables";
import { changeArea } from "./tune-diff";
import { rowLabel } from "./legend-labels";

/** The vehicle's Timed tab, by fixed id so it can be found and topped up like Health. */
export const TIMED_PAGE_ID = "page-timed";

/**
 * What a target chases. Drawn with the target, on one scale with it, so what
 * the tune asked for and what the car did sit together.
 */
const CHASED: [RegExp, string][] = [
  [/^Boost Control Target Pressure$/, "Manifold Pressure"],
  [/Driveshaft RPM Target$/, "Driveshaft RPM"],
  [/Engine RPM Target$/, "RPM"],
];

/**
 * The order the strips read top to bottom: timing, boost, the RPM targets,
 * then the cuts. Tables not listed follow, the way a racer reads a tune.
 */
const ORDER: RegExp[] = [
  /^Base Ignition Angle$/,
  /^Torque Management Timed Ignition Correction$/,
  /^Torque Management Engine RPM Target Error Ignition Correction$/,
  /^Torque Management Driveshaft RPM Target Error Ignition Correction$/,
  /^Nitrous Stage \d+ Ignition Correction$/,
  /^Boost Control Target Pressure$/,
  /^Intake Air Bleed Table$/,
  /^Torque Management Engine RPM Target$/,
  /^Torque Management Driveshaft RPM Target$/,
  /^Torque Management Engine RPM Cut Percentage$/,
  /^Torque Management Driveshaft RPM Cut Percentage$/,
  /^Main RPM Limiter End RPM$/,
  /^Torque Converter Dump Duty Cycle$/,
  /^Generic Output \d+ Table Output$/,
];

type TimedLog = {
  fileId: Id<"files">;
  parsed: ParsedLog;
};

function rankOf(table: string, group: string[]): number {
  const i = ORDER.findIndex((name) => name.test(table));
  return i >= 0 ? i : ORDER.length + changeArea({ name: table, group }).rank;
}

/** One strip of the Timed tab: a timed table, and the channel that draws it in each log. */
export interface TimedStrip {
  /** The table's Haltech name; what a focus is stored as. */
  key: string;
  label: string;
  /** One per log that has the table, in log order. */
  runs: { logFileId: Id<"files">; channelName: string }[];
}

/**
 * Every timed table acting on the loaded logs, one strip each: the known ones
 * in the order of the list above, then the rest the way a racer reads a tune.
 */
export function timedStrips(logs: TimedLog[]): TimedStrip[] {
  const strips = new Map<string, TimedStrip & { rank: number }>();
  for (const log of logs) {
    for (const lane of log.parsed.timed ?? []) {
      let strip = strips.get(lane.table);
      if (!strip) {
        const def = log.parsed.channelDefs.find((d) => d.name === lane.channel);
        strip = {
          key: lane.table,
          // The same name the channel has on any chart.
          label: rowLabel({ label: lane.channel, name: lane.channel, shortName: def?.shortName, own: false }),
          runs: [],
          rank: rankOf(lane.table, lane.group),
        };
        strips.set(lane.table, strip);
      }
      strip.runs.push({ logFileId: log.fileId, channelName: lane.channel });
    }
  }
  return [...strips.values()]
    .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key))
    .map(({ key, label, runs }) => ({ key, label, runs }));
}

/** What the Timed tab's trace shows for a strip: the table's line in each log, and what it chases. */
export function focusChannels(strip: TimedStrip, logs: TimedLog[]): ChannelOnTrace[] {
  const out: ChannelOnTrace[] = [];
  const chased = CHASED.find(([target]) => target.test(strip.key))?.[1];
  for (const run of strip.runs) {
    out.push({ logFileId: run.logFileId, channelName: run.channelName });
    const log = logs.find((l) => l.fileId === run.logFileId);
    if (!chased || !log) continue;
    const actual = findChannel(
      log.parsed.channelDefs.map((d) => d.name),
      chased,
    );
    if (actual) out.push({ logFileId: run.logFileId, channelName: actual });
  }
  return out;
}

export const TIMED_TRACE_ID = "timed-focus";

/**
 * The Timed tab: a strip for everything the tune runs off the launch clock,
 * and one trace below showing the strip picked — `focus`, or the first.
 * Null when no loaded log carried a tune with timed tables.
 */
export function buildTimedPage(logs: TimedLog[], focus?: string): PageConfig | null {
  const strips = timedStrips(logs);
  const strip = strips.find((s) => s.key === focus) ?? strips[0];
  if (!strip) return null;
  return {
    id: TIMED_PAGE_ID,
    label: "Timed",
    timedFocus: strip.key,
    traces: [{ id: TIMED_TRACE_ID, channels: focusChannels(strip, logs), height: 200 }],
  };
}

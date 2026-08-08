import type { ParsedLog } from "../log-types";
import { loadDefinitionPack } from "./definition-pack";

/**
 * Fold the manufacturer's definition data into a freshly parsed log.
 *
 * A log carries a numeric id per channel but only a terse name; the definition
 * pack turns that id into a description, a compact name for legends, the
 * channel's place in the ECU's hierarchy, and — for state channels — the labels
 * for its values. Without this, an enumerated channel plots as a bare number
 * and its sentinel "not applicable" value (65535) shows up as a spike.
 *
 * Best-effort: an unavailable pack, or a channel the pack doesn't know, leaves
 * the log exactly as parsed.
 */
export async function enrichWithDefinitions(
  parsed: ParsedLog,
  ecuType: string,
): Promise<void> {
  const pack = await loadDefinitionPack(ecuType);
  if (!pack) return;

  for (const def of parsed.channelDefs) {
    if (def.computed || !def.id) continue;
    const identity = pack.identify(def.id);
    if (!identity) continue;

    if (identity.description) def.description = identity.description;
    if (identity.shortName) def.shortName = identity.shortName;
    if (identity.path) def.path = identity.path;
    // The log's own name may be one the user customised in the tuning software
    // ("Generic Sensor 8 Value (Density Altitude)"), which beats the generic
    // name in the definition — so names supplement, never overwrite.
    if (identity.longName && !def.name) def.name = identity.longName;

    if (identity.enumValues) {
      const split = splitLabels(identity.enumValues);
      // A hand-written table in the parser covers a couple of channels; prefer
      // it where it exists, since it was checked against real logs.
      if (split.enumValues && !def.enumValues) def.enumValues = split.enumValues;
      if (split.statusLabels) def.statusLabels = split.statusLabels;
      if (split.sentinels.length > 0) def.sentinels = split.sentinels;
    }
  }

  blankSentinels(parsed);
  nameStatusCodes(parsed);
}

/**
 * The definition data mixes two different things into one label table, and
 * telling them apart matters: treating a sensor's fault names as its value
 * space would stop it being read as a measurement at all.
 *
 * They are distinguishable by key. Fault codes are the `0x80000000 | code`
 * sentinels, which read as large negative integers. Real enumerated values are
 * small non-negative ones — and a channel only has a genuine value space if it
 * has more than one of them, which rules out sensors carrying a lone "----"
 * placeholder for "no reading".
 */
function splitLabels(labels: Record<number, string>): {
  enumValues?: Record<number, string>;
  statusLabels?: Record<number, string>;
  sentinels: number[];
} {
  const enumValues: Record<number, string> = {};
  const statusLabels: Record<number, string> = {};
  const sentinels: number[] = [];
  let enumCount = 0;
  let statusCount = 0;

  for (const [k, label] of Object.entries(labels)) {
    const key = Number(k);
    if (!Number.isFinite(key)) continue;
    if (key < 0) {
      // Recover the code from the sentinel, matching the parser's statusCodeOf.
      statusLabels[key - -2147483648] = label;
      statusCount++;
    } else if (key >= 65535) {
      sentinels.push(key);
    } else {
      enumValues[key] = label;
      enumCount++;
    }
  }

  return {
    enumValues: enumCount > 1 ? enumValues : undefined,
    statusLabels: statusCount > 0 ? statusLabels : undefined,
    sentinels,
  };
}

/** Replace the parser's generic fault names with this channel's own. */
function nameStatusCodes(parsed: ParsedLog): void {
  const byName = new Map(parsed.channelDefs.map((d) => [d.name, d]));
  for (const session of parsed.sessions) {
    for (const [name, status] of session.channelStatus) {
      const labels = byName.get(name)?.statusLabels;
      const better = labels?.[status.dominantCode];
      if (better) status.dominantLabel = better;
    }
  }
}

/**
 * Enumerated channels report "not applicable" as a large sentinel — Engine
 * Limiter Max RPM logs 65535 for "None", Idle Control Output for "Inactive".
 * Plotted literally, one of those flattens every trace sharing the axis into a
 * line at the bottom, so they are removed from the plotted series.
 *
 * The label stays on the channel definition, so the channel still reads
 * correctly wherever values are shown by name rather than drawn.
 */
function blankSentinels(parsed: ParsedLog): void {
  for (const def of parsed.channelDefs) {
    if (!def.sentinels || def.sentinels.length === 0) continue;
    const sentinelSet = new Set(def.sentinels);

    for (const session of parsed.sessions) {
      const arr = session.channels.get(def.name);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        if (sentinelSet.has(arr[i])) arr[i] = NaN;
      }
    }
  }
}

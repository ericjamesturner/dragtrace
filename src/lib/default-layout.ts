import type { ChannelDef } from "./log-types";
import type { LoadedLog, TraceConfig, ChannelOnTrace, ViewerConfig } from "./viewer-types";
import { defaultViewerConfig } from "./viewer-types";

/**
 * The layout a log opens with when there's nothing saved.
 *
 * Someone who doesn't tune for a living shouldn't have to build a chart before
 * the app tells them anything — and someone who does shouldn't have to rebuild
 * the same two traces every time they add a car. So a fresh workspace starts
 * with engine speed against throttle, and the wideband readings against what
 * the ECU was asking for.
 */

interface ChannelSpec {
  /** Exact names to prefer, in order. */
  names: string[];
  /**
   * Fallback for ECUs that name things differently: any channel of this
   * quantity whose name matches. Keeps the default working on hardware whose
   * exact channel names we haven't seen.
   */
  quantity?: string;
  pattern?: RegExp;
  limit: number;
}

/**
 * Derived and diagnostic variants sit right next to the real channel and are
 * never what someone means by "show me throttle".
 */
const EXCLUDE = /derivative|filter|error|target error|raw|diagnostic|\bmin\b|\bmax\b|average of/i;

const DEFAULT_TRACES: ChannelSpec[][] = [
  [
    { names: ["RPM", "Engine Speed"], quantity: "engine-speed", pattern: /^(rpm|engine speed)$/i, limit: 1 },
    { names: ["Throttle Position"], pattern: /^throttle position$/i, limit: 1 },
  ],
  [
    {
      names: ["Wideband O2 1", "Wideband O2 2", "Wideband O2 Overall", "Target Lambda"],
      quantity: "afr",
      limit: 4,
    },
  ],
];

function pickChannels(defs: ChannelDef[], spec: ChannelSpec): string[] {
  const byName = new Map(defs.map((d) => [d.name.toLowerCase(), d]));
  const picked: string[] = [];

  for (const name of spec.names) {
    if (picked.length >= spec.limit) break;
    if (byName.has(name.toLowerCase())) picked.push(byName.get(name.toLowerCase())!.name);
  }
  // The named list is curated, so only reach for the quantity fallback when we
  // recognised nothing at all. Topping up an already-good match tends to drag
  // in control targets and diagnostics that sit on the same quantity.
  if (picked.length > 0) return picked;

  for (const def of defs) {
    if (picked.length >= spec.limit) break;
    if (def.computed || picked.includes(def.name) || EXCLUDE.test(def.name)) continue;
    const matchesQuantity = spec.quantity !== undefined && def.quantitySlug === spec.quantity;
    const matchesPattern = spec.pattern?.test(def.name) ?? false;
    if (matchesQuantity || matchesPattern) picked.push(def.name);
  }
  return picked;
}

/**
 * Build the opening layout from what the log actually contains. Traces with no
 * matching channels are dropped rather than shown empty.
 */
export function buildDefaultTraces(logs: LoadedLog[]): TraceConfig[] {
  const primary = logs[0];
  if (!primary) return [];
  const defs = primary.parsed.channelDefs;

  const traces: TraceConfig[] = [];
  for (const specs of DEFAULT_TRACES) {
    const channels: ChannelOnTrace[] = [];
    for (const spec of specs) {
      for (const channelName of pickChannels(defs, spec)) {
        channels.push({ logFileId: primary.fileId, channelName });
      }
    }
    if (channels.length === 0) continue;
    // The timeslip band goes under the top trace only — one place to read the
    // 60'/330'/660' splits, rather than the same strip repeated down the page.
    traces.push({
      id: `trace-default-${traces.length}`,
      channels,
      height: 1,
      showTimeslip: traces.length === 0,
    });
  }
  return traces;
}

export function buildDefaultConfig(logs: LoadedLog[]): ViewerConfig {
  const traces = buildDefaultTraces(logs);
  if (traces.length === 0) return defaultViewerConfig;
  return {
    ...defaultViewerConfig,
    pages: [{ ...defaultViewerConfig.pages[0], traces }],
  };
}

import type { ChannelDef } from "./log-types";
import { getDisplayUnit, type UnitSystem, type UnitOverrides } from "./units";
import type { LoadedLog, ScatterSuggestion } from "./viewer-types";

// Build the `- "Name" [unit: X]` channel list string sent to the AI action.
export function buildScatterChannelList(
  defs: ChannelDef[],
  unitSystem: UnitSystem,
  unitOverrides?: UnitOverrides,
): string {
  return defs
    .map((d) => {
      const u = d.metricUnit ? getDisplayUnit(d.metricUnit, unitSystem, unitOverrides) : "";
      return u ? `- "${d.name}" [unit: ${u}]` : `- "${d.name}"`;
    })
    .join("\n");
}

// Union of channel defs across loaded logs, de-duped by name (first wins).
export function unionChannelDefs(logs: LoadedLog[]): ChannelDef[] {
  const seen = new Set<string>();
  const out: ChannelDef[] = [];
  for (const l of logs) {
    for (const d of l.parsed.channelDefs) {
      if (!seen.has(d.name)) {
        seen.add(d.name);
        out.push(d);
      }
    }
  }
  return out;
}

// Stable key for the channel-name union — used to decide when to (re)fetch.
export function channelSetKey(defs: ChannelDef[]): string {
  return defs
    .map((d) => d.name)
    .sort()
    .join("|");
}

// Ported from halog: exact then case-insensitive resolve; drop suggestions
// whose X or Y channel can't be resolved against the real channel names.
export function resolveSuggestions(
  raw: ScatterSuggestion[],
  defs: ChannelDef[],
): ScatterSuggestion[] {
  const names = defs.map((d) => d.name);
  const exact = new Set(names);
  const resolve = (n: string): string | null =>
    exact.has(n) ? n : (names.find((x) => x.toLowerCase() === n.toLowerCase()) ?? null);

  const out: ScatterSuggestion[] = [];
  for (const s of raw) {
    const x = resolve(s.xChannel);
    const y = resolve(s.yChannel);
    if (!x || !y) continue;
    const color = s.colorChannel ? resolve(s.colorChannel) : undefined;
    out.push({ ...s, xChannel: x, yChannel: y, colorChannel: color ?? undefined });
  }
  return out;
}

import { detectHaltech, parseHaltech } from "./haltech-parser";
import { extractHaltechLogs } from "./haltech-container";
import { MAX_HALTECH_CELLS, parseHaltechHlg } from "./haltech-hlg-parser";
import { parseHolleyV6Dl } from "./holley-dl-parser";
import type { ChannelDef, ParsedLog } from "./log-types";
import { decodeLogText, detectTextLog, parseTextLog } from "./text-log-parser";

export const TEXT_LOG_EXTENSIONS = new Set(["csv", "log", "txt"]);
export const BINARY_LOG_EXTENSIONS = new Set([
  "mlg", "xrk", "drk", "llg", "llg5", "lg1", "lg2", "dlz", "daq", "dat", "emublog",
]);
export const SUPPORTED_LOG_EXTENSIONS = new Set([...TEXT_LOG_EXTENSIONS, "dl", "hlg", "hlgzip"]);
export const SUPPORTED_LOG_ACCEPT = [...SUPPORTED_LOG_EXTENSIONS].map((extension) => `.${extension}`).join(",");
export const SUPPORTED_LOG_DESCRIPTION = "Haltech .hlgzip/.hlg · Holley V6 .dl · CSV/text exports";

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function isSupportedLogFile(fileName: string): boolean {
  return SUPPORTED_LOG_EXTENSIONS.has(fileExtension(fileName));
}

function channelSchema(def: ChannelDef): string {
  // Known quantities are already in canonical units. An unknown type keeps
  // its unit/type identity so unrelated values never share one definition.
  return JSON.stringify([
    def.quantitySlug ?? [def.type, def.unit ?? ""],
    def.enumValues ? Object.entries(def.enumValues).sort(([a], [b]) => Number(a) - Number(b)) : null,
  ]);
}

function combineHaltechLogs(logs: { name: string; parsed: ParsedLog }[]): ParsedLog {
  if (logs.length === 0) throw new Error("No Haltech .hlg logs found in this archive");
  if (logs.length === 1) return logs[0].parsed;

  const channelDefs: ChannelDef[] = [];
  const sessions: ParsedLog["sessions"] = [];
  const definitionsByName = new Map<string, Map<string, ChannelDef>>();
  const reservedNames = new Set(logs.flatMap(({ parsed }) => parsed.channelDefs.map((def) => def.name)));
  const memberCounts = new Map<string, number>();
  const members = logs.map((log) => {
    const count = (memberCounts.get(log.name) ?? 0) + 1;
    memberCounts.set(log.name, count);
    return { ...log, label: count === 1 ? log.name : `${log.name} (${count})` };
  });

  for (const { label, parsed } of members) {
    const channelNames = new Map<string, string>();
    for (const def of parsed.channelDefs) {
      const schema = channelSchema(def);
      let variants = definitionsByName.get(def.name);
      if (!variants) {
        variants = new Map();
        definitionsByName.set(def.name, variants);
      }
      const existing = variants.get(schema);
      if (existing) {
        if (Number.isFinite(def.displayMin)) {
          existing.displayMin = Number.isFinite(existing.displayMin)
            ? Math.min(existing.displayMin, def.displayMin) : def.displayMin;
        }
        if (Number.isFinite(def.displayMax)) {
          existing.displayMax = Number.isFinite(existing.displayMax)
            ? Math.max(existing.displayMax, def.displayMax) : def.displayMax;
        }
        channelNames.set(def.name, existing.name);
        continue;
      }

      let name = def.name;
      if (variants.size > 0) {
        const base = `${def.name} (${label})`;
        name = base;
        let suffix = 2;
        while (reservedNames.has(name)) name = `${base} ${suffix++}`;
        reservedNames.add(name);
      }
      const definition = { ...def, name, index: channelDefs.length };
      variants.set(schema, definition);
      channelDefs.push(definition);
      channelNames.set(def.name, name);
    }

    // Members can have different channel sets, sample rates, or recordings.
    // Keep their sessions intact instead of joining incompatible row grids.
    for (const session of parsed.sessions) {
      sessions.push({
        ...session,
        label: `${label} · ${session.label}`,
        channels: new Map(Array.from(session.channels, ([name, values]) => [channelNames.get(name) ?? name, values])),
        channelStatus: new Map(Array.from(session.channelStatus, ([name, status]) => [channelNames.get(name) ?? name, status])),
      });
    }
  }

  const metadata: Record<string, string> = {};
  const metadataKeys = new Set(members.flatMap(({ parsed }) => Object.keys(parsed.metadata)));
  for (const key of metadataKeys) {
    const values = members.filter(({ parsed }) => key in parsed.metadata);
    if (new Set(values.map(({ parsed }) => parsed.metadata[key])).size === 1) {
      metadata[key] = values[0].parsed.metadata[key];
    } else {
      for (const { label, parsed } of values) metadata[`${label}: ${key}`] = parsed.metadata[key];
    }
  }
  metadata["Archive Log Files"] = members.map(({ label }) => label).join(", ");

  return { format: "Haltech", metadata, channelDefs, sessions };
}

export async function parseDatalogBytes(bytes: ArrayBuffer, fileName: string): Promise<ParsedLog> {
  const extension = fileExtension(fileName);
  if (extension === "dl") return parseHolleyV6Dl(bytes);
  if (extension === "hlg") return parseHaltechHlg(bytes, MAX_HALTECH_CELLS, fileName);
  if (extension === "hlgzip") {
    const members = await extractHaltechLogs(bytes);
    let remainingCells = MAX_HALTECH_CELLS;
    const parsedMembers: { name: string; parsed: ParsedLog }[] = [];
    for (const { name, bytes: memberBytes } of members) {
      // Once the budget is spent, later logs are left out like any other
      // recording that doesn't fit.
      if (parsedMembers.length > 0 && remainingCells <= 0) continue;
      try {
        const parsed = parseHaltechHlg(memberBytes, remainingCells, name);
        for (const session of parsed.sessions) remainingCells -= session.channels.size * session.rowCount;
        parsedMembers.push({ name, parsed });
      } catch (error) {
        if (parsedMembers.length > 0 && /too large/.test(String(error))) continue;
        const message = error instanceof Error ? error.message : "Could not read this Haltech log";
        throw new Error(`${name}: ${message}`);
      }
    }
    return combineHaltechLogs(parsedMembers);
  }
  if (BINARY_LOG_EXTENSIONS.has(extension)) {
    throw new Error(`${extension.toUpperCase()} binary logs are not supported yet`);
  }

  const text = decodeLogText(bytes);
  if (detectHaltech(text)) return parseHaltech(text);
  if (detectTextLog(text)) return parseTextLog(text);
  throw new Error("Unsupported ECU log format");
}

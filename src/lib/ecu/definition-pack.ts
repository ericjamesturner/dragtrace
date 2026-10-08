import type { ChannelIdentity } from "./types";

/**
 * Channel definitions extracted from the ECU manufacturer's own definition
 * files. A logged channel carries a numeric id in the log header; this turns
 * that id into the name, description, hierarchy position and value labels the
 * manufacturer's software would show.
 *
 * The file is a few megabytes, so it is fetched on demand rather than bundled,
 * and only once per session — the browser's HTTP cache covers reloads.
 */

interface RawEntry {
  /** Long name. */
  L?: string;
  /** Short name, for compact legends. */
  s?: string;
  /** Description. */
  d?: string;
  /** Canonical path within the ECU's own hierarchy. */
  p?: string;
  /** Index into `groups`: the display names of the groups above this channel. */
  g?: number;
  /** Enumerated value labels. */
  e?: Record<string, string>;
}

interface RawPack {
  ecuType: string;
  sources: string[];
  groups?: string[][];
  /**
   * Ids are not stable across ECU families, so an id the families disagree on
   * holds one entry per channel it can be.
   */
  channels: Record<string, RawEntry | RawEntry[]>;
}

export interface DefinitionPack {
  ecuType: string;
  sources: string[];
  size: number;
  /**
   * The channel a log's id refers to. Pass the name the log gave it: where the
   * id means different channels on different ECUs, the name picks between them.
   */
  identify(channelId: number, logName?: string): ChannelIdentity | undefined;
}

const packs = new Map<string, Promise<DefinitionPack | null>>();

function toIdentity(e: RawEntry, groups: string[][]): ChannelIdentity {
  const out: ChannelIdentity = {};
  if (e.L) out.longName = e.L;
  if (e.g !== undefined && groups[e.g]) out.group = groups[e.g];
  if (e.s) out.shortName = e.s;
  if (e.d) out.description = e.d;
  if (e.p) out.path = e.p;
  if (e.e) {
    const enumValues: Record<number, string> = {};
    for (const [k, v] of Object.entries(e.e)) {
      const n = Number(k);
      if (Number.isFinite(n)) enumValues[n] = v;
    }
    out.enumValues = enumValues;
  }
  return out;
}

const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Choose between the channels one id can be. The log's name is either the
 * definition's own name or a user's label wrapped around it — "Line Lock
 * (Generic Output 4 Out)" — so an exact match wins, then containment. With
 * no match the newest firmware's entry, listed first, stands.
 */
function pickVariant(
  variants: ChannelIdentity[] | undefined,
  logName: string | undefined,
): ChannelIdentity | undefined {
  if (!variants || variants.length <= 1 || !logName) return variants?.[0];
  const name = normalise(logName);
  return (
    variants.find((v) => v.longName && normalise(v.longName) === name) ??
    variants.find((v) => v.longName && name.includes(normalise(v.longName))) ??
    variants[0]
  );
}

/**
 * Load the definition pack for an ECU. Resolves to null when none is published
 * — callers fall back to whatever the log itself carries rather than failing.
 */
export function loadDefinitionPack(ecuType: string): Promise<DefinitionPack | null> {
  const cached = packs.get(ecuType);
  if (cached) return cached;

  const p = (async (): Promise<DefinitionPack | null> => {
    try {
      const res = await fetch(`/ecu/${ecuType}/channels.json`);
      if (!res.ok) return null;
      const raw = (await res.json()) as RawPack;
      const groups = raw.groups ?? [];
      const identities = new Map<number, ChannelIdentity[]>();
      for (const [id, e] of Object.entries(raw.channels)) {
        const n = Number(id);
        if (!Number.isFinite(n)) continue;
        identities.set(n, (Array.isArray(e) ? e : [e]).map((x) => toIdentity(x, groups)));
      }
      return {
        ecuType: raw.ecuType,
        sources: raw.sources ?? [],
        size: identities.size,
        identify: (channelId, logName) => pickVariant(identities.get(channelId), logName),
      };
    } catch {
      // Offline, or no pack published for this ECU. Not fatal.
      return null;
    }
  })();

  packs.set(ecuType, p);
  return p;
}

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
  /** Enumerated value labels. */
  e?: Record<string, string>;
}

interface RawPack {
  ecuType: string;
  sources: string[];
  channels: Record<string, RawEntry>;
}

export interface DefinitionPack {
  ecuType: string;
  sources: string[];
  size: number;
  identify(channelId: number): ChannelIdentity | undefined;
}

const packs = new Map<string, Promise<DefinitionPack | null>>();

function toIdentity(e: RawEntry): ChannelIdentity {
  const out: ChannelIdentity = {};
  if (e.L) out.longName = e.L;
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
      const identities = new Map<number, ChannelIdentity>();
      for (const [id, e] of Object.entries(raw.channels)) {
        const n = Number(id);
        if (Number.isFinite(n)) identities.set(n, toIdentity(e));
      }
      return {
        ecuType: raw.ecuType,
        sources: raw.sources ?? [],
        size: identities.size,
        identify: (channelId) => identities.get(channelId),
      };
    } catch {
      // Offline, or no pack published for this ECU. Not fatal.
      return null;
    }
  })();

  packs.set(ecuType, p);
  return p;
}

import { useEffect, useMemo, useState } from "react";
import type { ChannelDef } from "@/lib/log-types";
import type { ChannelIdentity } from "@/lib/ecu/types";
import { loadDefinitionPack, type DefinitionPack } from "@/lib/ecu/definition-pack";

/**
 * Enriches parsed channels with the manufacturer's own definition data —
 * descriptions, compact names, value labels and the ECU's real hierarchy —
 * joined on the channel id the log already carries.
 *
 * Returns identities keyed by channel *name*, since that's how the rest of the
 * viewer refers to channels. Until the pack loads (or if none is published)
 * this is empty and callers use what the log itself provided.
 */
export function useChannelDefinitions(
  channelDefs: ChannelDef[],
  ecuType: string,
): {
  identities: Map<string, ChannelIdentity>;
  pack: DefinitionPack | null;
  loading: boolean;
} {
  // One state update, applied when the fetch settles — the pack resolver caches
  // its promise, so a remount resolves from memory on the next microtask.
  const [state, setState] = useState<{ ecuType: string; pack: DefinitionPack | null } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void loadDefinitionPack(ecuType).then((pack) => {
      if (!cancelled) setState({ ecuType, pack });
    });
    return () => {
      cancelled = true;
    };
  }, [ecuType]);

  const pack = state?.ecuType === ecuType ? state.pack : null;
  const loading = state?.ecuType !== ecuType;

  const identities = useMemo(() => {
    const out = new Map<string, ChannelIdentity>();
    if (!pack) return out;
    for (const def of channelDefs) {
      if (def.computed || !def.id) continue;
      const id = pack.identify(def.id);
      if (id) out.set(def.name, id);
    }
    return out;
  }, [pack, channelDefs]);

  return { identities, pack, loading };
}

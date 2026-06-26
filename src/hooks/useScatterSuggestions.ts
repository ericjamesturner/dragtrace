import { useEffect, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  buildScatterChannelList,
  channelSetKey,
  resolveSuggestions,
  unionChannelDefs,
} from "@/lib/ai-scatter-suggestions";
import type { LoadedLog, ScatterSuggestion, ViewerConfig } from "@/lib/viewer-types";
import type { UnitSystem, UnitOverrides } from "@/lib/units";

// Background-fetches AI scatter suggestions once per unique channel set.
// Skips the network call when the persisted config already carries suggestions
// for the current channel-set key (loaded from Convex / localStorage).
export function useScatterSuggestions(
  logs: LoadedLog[],
  config: ViewerConfig,
  unitSystem: UnitSystem,
  unitOverrides: UnitOverrides | undefined,
  onSuggestions: (s: ScatterSuggestion[], key: string) => void,
) {
  const generate = useAction(api.scatterSuggestions.generate);

  // Latest values without re-triggering the effect on every render.
  const inflight = useRef<string | null>(null);
  const onSuggestionsRef = useRef(onSuggestions);
  onSuggestionsRef.current = onSuggestions;
  const unitSystemRef = useRef(unitSystem);
  unitSystemRef.current = unitSystem;
  const unitOverridesRef = useRef(unitOverrides);
  unitOverridesRef.current = unitOverrides;
  const hasSuggestionsRef = useRef(false);
  hasSuggestionsRef.current = !!config.scatterSuggestions;

  const persistedKey = config.scatterSuggestionsKey;

  useEffect(() => {
    if (logs.length === 0) return;
    const defs = unionChannelDefs(logs);
    const key = channelSetKey(defs);

    // Already persisted for this exact channel set -> no API call.
    if (persistedKey === key && hasSuggestionsRef.current) return;
    if (inflight.current === key) return;
    inflight.current = key;
    let cancelled = false;

    generate({
      channelList: buildScatterChannelList(defs, unitSystemRef.current, unitOverridesRef.current),
    })
      .then((raw) => {
        if (!cancelled) onSuggestionsRef.current(resolveSuggestions(raw, defs), key);
      })
      .catch((e) => console.error("[AI Scatter]", e))
      .finally(() => {
        if (inflight.current === key) inflight.current = null;
      });

    return () => {
      cancelled = true;
    };
    // Deliberately NOT depending on unit system/overrides — like halog, only
    // refetch when the channel set (logs) or the persisted key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, persistedKey, generate]);
}

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { LoadedLog } from "@/lib/viewer-types";
import { evaluateExpression } from "@/lib/zone-evaluator";

export interface MathChannelError {
  name: string;
  message: string;
}

/**
 * Compute the user's derived channels into each loaded log, so they appear
 * alongside real ones everywhere — sidebar, traces, scatter, export.
 *
 * Applied here rather than in the parser because the definitions live in Convex
 * and can change without the logs reloading. Each pass removes what it added
 * last time before recomputing, so editing a definition doesn't leave the old
 * version behind.
 */
export function useMathChannels(
  vehicleId: Id<"vehicles"> | undefined,
  logs: LoadedLog[],
  enabled = true,
): { definitions: Doc<"mathChannels">[]; errors: MathChannelError[]; version: number } {
  const definitions = useQuery(
    api.mathChannels.listByVehicle,
    enabled && vehicleId ? { vehicleId } : "skip",
  );
  const [state, setState] = useState<{ version: number; errors: MathChannelError[] }>({
    version: 0,
    errors: [],
  });

  const defsKey = (definitions ?? [])
    .map((d) => `${d._id}:${d.name}:${d.expression}:${d.quantitySlug ?? ""}`)
    .join("|");
  const logsKey = logs.map((l) => l.fileId).join(",");

  useEffect(() => {
    if (!enabled || !definitions) return;
    const errors: MathChannelError[] = [];
    const wanted = new Set(definitions.map((d) => d.name));

    for (const log of logs) {
      const parsed = log.parsed;

      // Drop previously-applied custom channels that are gone or renamed.
      const stale = parsed.channelDefs.filter(
        (d) => d.custom && !wanted.has(d.name),
      );
      for (const d of stale) {
        for (const session of parsed.sessions) session.channels.delete(d.name);
      }
      if (stale.length > 0) {
        parsed.channelDefs = parsed.channelDefs.filter(
          (d) => !(d.custom && !wanted.has(d.name)),
        );
      }

      for (const def of definitions) {
        let ok = true;
        for (const session of parsed.sessions) {
          try {
            session.channels.set(def.name, evaluateExpression(def.expression, session));
          } catch (err) {
            ok = false;
            const message = err instanceof Error ? err.message : "Could not be computed";
            if (!errors.some((e) => e.name === def.name)) errors.push({ name: def.name, message });
            session.channels.delete(def.name);
          }
        }

        const existing = parsed.channelDefs.find((d) => d.name === def.name);
        if (!ok) {
          if (existing?.custom) {
            parsed.channelDefs = parsed.channelDefs.filter((d) => d.name !== def.name);
          }
          continue;
        }
        if (existing) {
          existing.quantitySlug = def.quantitySlug;
          existing.computed = true;
          existing.custom = true;
        } else {
          parsed.channelDefs.push({
            name: def.name,
            id: -1,
            type: "Custom",
            displayMax: 0,
            displayMin: 0,
            index: parsed.channelDefs.length,
            quantitySlug: def.quantitySlug,
            computed: true,
            custom: true,
          });
        }
      }
    }

    setState((prev) => ({ version: prev.version + 1, errors }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defsKey, logsKey, enabled]);

  return { definitions: definitions ?? [], errors: state.errors, version: state.version };
}

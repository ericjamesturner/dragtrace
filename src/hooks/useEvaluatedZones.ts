import { useMemo } from "react";
import type { HighlightZoneConfig, LoadedLog } from "@/lib/viewer-types";
import type { Id } from "../../convex/_generated/dataModel";
import { convertForDisplay, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { evaluateZoneExpression, scanTrueRegions } from "@/lib/zone-evaluator";

export interface EvaluatedZone {
  config: HighlightZoneConfig;
  regions: { start: number; end: number }[];
  error: string | null;
}

export function useEvaluatedZones(
  zones: HighlightZoneConfig[] | undefined,
  logs: LoadedLog[],
  offsets: Map<Id<"files">, number>,
  unitSystem: UnitSystem,
  unitOverrides?: UnitOverrides,
): EvaluatedZone[] {
  return useMemo(() => {
    if (!zones || zones.length === 0) return [];

    // Cache evaluated expressions to avoid duplicates
    const cache = new Map<string, { regions: { start: number; end: number }[]; error: string | null }>();

    return zones.map((zone) => {
      if (!zone.enabled) {
        return { config: zone, regions: [], error: null };
      }

      const cached = cache.get(zone.expression);
      if (cached) {
        return { config: zone, ...cached };
      }

      const allRegions: { start: number; end: number }[] = [];
      let error: string | null = null;

      for (const log of logs) {
        const session = log.parsed.sessions[log.activeSessionIndex];
        if (!session) continue;
        const offset = offsets.get(log.fileId) ?? 0;

        // Build unit converter
        const metricUnitByChannel = new Map<string, string>();
        for (const def of log.parsed.channelDefs) {
          if (def.metricUnit) metricUnitByChannel.set(def.name, def.metricUnit);
        }

        const converter = (channelName: string, value: number): number => {
          const mu = metricUnitByChannel.get(channelName);
          if (!mu) return value;
          return convertForDisplay(value, mu, unitSystem, unitOverrides);
        };

        try {
          const mask = evaluateZoneExpression(zone.expression, session, converter);
          const regions = scanTrueRegions(mask, session.timestamps, offset);
          allRegions.push(...regions);
        } catch (e) {
          error = (e as Error).message;
        }
      }

      const result = { regions: allRegions, error };
      cache.set(zone.expression, result);
      return { config: zone, ...result };
    });
  }, [zones, logs, offsets, unitSystem, unitOverrides]);
}

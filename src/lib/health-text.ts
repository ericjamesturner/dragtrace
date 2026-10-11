import type { Anomaly, PassChecks } from "./anomalies";
import { findAnomalies } from "./anomalies";
import { convertForDisplay, getDisplayPrecision, getDisplayUnit, type UnitOverrides } from "./units";
import type { UnitSystem } from "./ecu/types";

/**
 * The Health check as a few plain lines, for somewhere that isn't the run
 * sheet — the phone alert. In the racer's own units; one line per problem.
 */
export function healthLines(pass: PassChecks, refs: PassChecks[], system: UnitSystem, overrides: UnitOverrides): string[] {
  const show = (v: number, slug: string | undefined) => {
    if (!slug) return v.toFixed(1);
    const shown = convertForDisplay(v, slug, system, overrides);
    const unit = getDisplayUnit(slug, system, overrides) ?? "";
    return `${shown.toFixed(getDisplayPrecision(slug, system, overrides) ?? 1)} ${unit}`.trim();
  };
  // A difference, not a reading: no offset (a 50 °C gap is 90 °F, not 122).
  const gap = (v: number, slug: string | undefined) => {
    if (!slug) return v.toFixed(1);
    const g = convertForDisplay(v, slug, system, overrides) - convertForDisplay(0, slug, system, overrides);
    const unit = getDisplayUnit(slug, system, overrides) ?? "";
    return `${slug === "temperature" ? Math.round(g) : g.toFixed(getDisplayPrecision(slug, system, overrides) ?? 1)} ${unit}`.trim();
  };
  const sensor = (label: string) => `${label.startsWith("B") ? "Bank" : "Cylinder"} ${label.slice(1)}`;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const line = (a: Anomaly): string => {
    switch (a.kind) {
      case "low":
        return `${a.level.name} low: ${show(a.level.min, a.level.quantitySlug)} (usually ${show(a.usualMin, a.level.quantitySlug)})`;
      case "high":
        return `${a.level.name} high: ${show(a.level.max!, a.level.quantitySlug)} (usually ${show(a.usualMax, a.level.quantitySlug)})`;
      case "short":
        return `${a.level.name} ${gap(a.level.shortfall!.gap, a.level.quantitySlug)} below expected`;
      case "hot":
        return `${a.level.name} hot: ${show(a.level.max!, a.level.quantitySlug)}`;
      case "lean":
        return `${sensor(a.label)} lean of target for ${a.seconds.toFixed(2)} s`;
      case "target-lean":
        return `${sensor(a.label)} averaging ${pct(a.ratio)} lean of target`;
      case "drift":
        return a.group === "lambda"
          ? `${sensor(a.label)} running ${pct(a.offset)} lean of the others (usually ${pct(a.usual)})`
          : `${sensor(a.label)} EGT ${a.offset < a.usual ? "cold" : "hot"} against the others`;
      case "spread":
        return a.group === "lambda" ? `Widebands spread ${pct(a.spread)} (usually ${pct(a.usual)})` : `EGTs spread ${gap(a.spread, a.quantitySlug)}`;
      case "egt-odd":
        return `${sensor(a.label)} EGT ${a.offset < 0 ? "cold — check it's firing" : "hot — check it isn't lean"}`;
      case "egt-spike":
        return `${sensor(a.label)} EGT peaked at ${show(a.peak, a.quantitySlug)}`;
      case "boost":
        return `Boost peaked at ${show(a.boost.peak, "pressure")} (usually ${show(a.usual, "pressure")})`;
      case "boost-target":
        return `Boost ${gap(a.boost.targetGap!, "pressure")} short of target`;
      case "limiter":
        return `Limiter cut for ${a.limiter.seconds.toFixed(2)} s`;
      case "fault":
        return `${a.fault.name} sensor fault`;
      case "spin":
        return `Tire spin: driveshaft ${pct(a.ahead)} ahead of usual at ${a.at.toFixed(2)} s`;
      case "slip":
        return `Converter slip: ${a.slip.ratio.toFixed(3)} (usually ${a.usual.toFixed(3)})`;
      case "duty":
        return `${a.injector.name} at ${a.injector.max.toFixed(0)}%`;
    }
  };
  return [...new Set(findAnomalies(pass, refs).map(line))];
}

import type { ChannelDef } from "./log-types";

export interface ScatterPreset {
  label: string;
  x: string;
  y: string;
  color: string;
}

/**
 * Regex-match common Haltech channels (RPM/MAP/AFR/TPS/timing/inj duty) and
 * return quick-setup scatter presets. Ported from halog ScatterConfigPanel.
 */
export function buildScatterPresets(channelDefs: ChannelDef[]): ScatterPreset[] {
  const find = (pattern: RegExp) =>
    channelDefs.find((d) => pattern.test(d.name))?.name ?? "";

  const rpm = find(/^RPM$/i);
  const map =
    find(/^Manifold Pressure$/i) || find(/manifold.*press/i) || find(/\bMAP\b/i);
  const afr =
    find(/^Wideband O2 Overall$/i) ||
    find(/wideband.*overall/i) ||
    find(/\bAFR\b/i) ||
    find(/\blambda\b/i);
  const tps = find(/^TPS$/i) || find(/throttle.*pos/i);
  const timing =
    find(/^Ign Advance$/i) || find(/ignition.*advance/i) || find(/timing/i);
  const injDuty = find(/injector.*duty/i) || find(/^Inj Duty$/i);

  const list: ScatterPreset[] = [];
  if (rpm && map && afr) list.push({ label: "RPM vs MAP (AFR)", x: rpm, y: map, color: afr });
  if (rpm && tps && afr) list.push({ label: "RPM vs TPS (AFR)", x: rpm, y: tps, color: afr });
  if (rpm && timing) list.push({ label: "RPM vs Timing", x: rpm, y: timing, color: map || "" });
  if (rpm && injDuty) list.push({ label: "RPM vs Inj Duty", x: rpm, y: injDuty, color: "" });
  return list;
}

import type { Doc } from "../../convex/_generated/dataModel";

/**
 * The weather station's correction factor for a timeslip: the slip's air
 * against standard air (60 °F, 29.92 inHg, dry). How much a given car's ET
 * actually moves with it is learned per car — see dial-predictor.ts.
 */

const STD_PRESSURE_INHG = 29.92;
const STD_TEMP_R = 519.67; // 60 °F in Rankine
const MBAR_PER_INHG = 33.8639;

/** Saturation vapour pressure (Buck), inHg, at a temperature in °F. */
function saturationVaporInHg(tempF: number): number {
  const c = ((tempF - 32) * 5) / 9;
  const mbar = 6.1121 * Math.exp((18.678 - c / 234.5) * (c / (257.14 + c)));
  return mbar / MBAR_PER_INHG;
}

/**
 * The slip's correction factor against standard air. Above 1 means worse air
 * than standard. Needs air temperature and the barometer (station pressure,
 * as track weather stations read it); humidity counts when it's there.
 */
export function correctionFactor(ts: Doc<"timeslips">): number | null {
  const t = ts.airTemperatureF;
  const baro = ts.barometricPressureInHg;
  if (t === undefined || baro === undefined || baro <= 0) return null;
  const vapor = ts.humidityPct !== undefined ? (saturationVaporInHg(t) * ts.humidityPct) / 100 : 0;
  const dry = baro - vapor;
  if (dry <= 0) return null;
  return (STD_PRESSURE_INHG / dry) * Math.sqrt((t + 459.67) / STD_TEMP_R);
}

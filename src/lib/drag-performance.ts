export interface WeightPowerEstimates {
  distance: "1/4" | "1/8";
  etHp?: number;
  mphHp?: number;
}

/**
 * Back-calculate approximate power from race weight and a timeslip.
 *
 * The quarter-mile equations are the common empirical drag-racing formulas:
 *   HP = weight / (ET / 5.825)^3
 *   HP = weight * (MPH / 234)^3
 *
 * For an eighth-mile-only slip, the 1/8 clocks are first converted to common
 * quarter-mile approximations (ET x 1.57, MPH x 1.25). These are track-side
 * estimates, not dyno measurements; traction, aero, weather, gearing and a
 * lifted pass can all move them substantially.
 */
export function estimatePowerFromTimeslip({
  raceWeightLb,
  quarterEt,
  quarterMph,
  eighthEt,
  eighthMph,
}: {
  raceWeightLb: number;
  quarterEt?: number;
  quarterMph?: number;
  eighthEt?: number;
  eighthMph?: number;
}): WeightPowerEstimates | null {
  if (!Number.isFinite(raceWeightLb) || raceWeightLb <= 0) return null;

  const isQuarter = quarterEt !== undefined || quarterMph !== undefined;
  const distance = isQuarter ? "1/4" : "1/8";
  const et = isQuarter ? quarterEt : eighthEt !== undefined ? eighthEt * 1.57 : undefined;
  const mph = isQuarter
    ? quarterMph
    : eighthMph !== undefined
      ? eighthMph * 1.25
      : undefined;

  const etHp = et !== undefined && et > 0
    ? raceWeightLb / Math.pow(et / 5.825, 3)
    : undefined;
  const mphHp = mph !== undefined && mph > 0
    ? raceWeightLb * Math.pow(mph / 234, 3)
    : undefined;

  return etHp !== undefined || mphHp !== undefined
    ? { distance, etHp, mphHp }
    : null;
}

/**
 * Next-round dial-in from the car's own passes: correct each picked pass to
 * the air right now, then average them. The spread of those corrected times
 * is how far to trust the number.
 *
 * How much the air moves this car's ET is learned from its own history once
 * there is enough of it — a turbo car with boost control loses far less to
 * bad air than the textbook says. Until then the textbook rule is used (ET
 * goes with the cube root of the correction factor), and the result says so.
 */

export interface DialPass {
  id: string;
  /** "Q2", or the pass number when no round is set. */
  label: string;
  /** ET at the distance being predicted (1/8 or 1/4). */
  et: number;
  /** Correction factor of the air it ran in. */
  cf: number;
  /** Whether it ran at the event being dialled for. */
  thisEvent: boolean;
  /** The slip's clocks, for predicting a whole slip and not just the ET. */
  clocks?: SlipClocks;
}

export interface SlipClocks {
  sixtyFt?: number;
  threeThirty?: number;
  eighthEt?: number;
  eighthMph?: number;
  thousandFt?: number;
  et?: number;
  mph?: number;
}

export interface DialBasisPass extends DialPass {
  /** Its ET corrected to the target air. */
  corrected: number;
}

export interface DialPrediction {
  et: number;
  /** Standard deviation of the corrected times; absent with a single pass. */
  spread?: number;
  basis: DialBasisPass[];
}

/** History needed before the car's own sensitivity replaces the textbook. */
const MIN_LEARN_PASSES = 5;
/** ...and the air must have varied this much, or the slope is just noise. */
const MIN_LEARN_CF_RANGE = 0.02;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Least-squares slope of ET against correction factor. */
function slope(passes: DialPass[]): number {
  const mx = mean(passes.map((p) => p.cf));
  const my = mean(passes.map((p) => p.et));
  let num = 0;
  let den = 0;
  for (const p of passes) {
    num += (p.cf - mx) * (p.et - my);
    den += (p.cf - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}

export interface AirSensitivity {
  /** Seconds of ET per 1.00 of correction factor. */
  secPerCf: number;
  textbookSecPerCf: number;
  sensitivity: "learned" | "textbook";
  learnedFrom?: number;
}

/**
 * How much the air moves this car's ET, near correction factor `atCf`:
 * learned from its clean passes when they're enough and spread over enough
 * air, otherwise the textbook (ET ∝ cf^(1/3), so dET/dcf = ET / (3·cf)).
 */
export function airSensitivity(history: DialPass[], atCf: number): AirSensitivity {
  const typicalEt = mean(history.map((p) => p.et));
  const textbook = typicalEt / (3 * atCf);
  const cfs = history.map((p) => p.cf);
  if (history.length >= MIN_LEARN_PASSES && Math.max(...cfs) - Math.min(...cfs) >= MIN_LEARN_CF_RANGE) {
    const fitted = slope(history);
    // Worse air can't make a car quicker, and a slope far past the textbook
    // is the track or the tune changing, not the air.
    if (fitted > 0 && fitted <= 2 * textbook) {
      return { secPerCf: fitted, textbookSecPerCf: textbook, sensitivity: "learned", learnedFrom: history.length };
    }
  }
  return { secPerCf: textbook, textbookSecPerCf: textbook, sensitivity: "textbook" };
}

/** Hand-picked passes only need to differ this much in air to teach a slope. */
const MIN_PICKED_CF_RANGE = 0.01;

/**
 * How much the air moves the car, learned from passes the racer picked — the
 * ones on the current tune, say. Needs two in different enough air, and the
 * same sanity bounds as the history fit. Null when they can't teach it.
 */
export function pickedSensitivity(picked: DialPass[], atCf: number): AirSensitivity | null {
  if (picked.length < 2) return null;
  const cfs = picked.map((p) => p.cf);
  if (Math.max(...cfs) - Math.min(...cfs) < MIN_PICKED_CF_RANGE) return null;
  const textbook = mean(picked.map((p) => p.et)) / (3 * atCf);
  const fitted = slope(picked);
  if (!(fitted > 0) || fitted > 2 * textbook) return null;
  return { secPerCf: fitted, textbookSecPerCf: textbook, sensitivity: "learned", learnedFrom: picked.length };
}

/** Each picked pass moved to the target air by `correct`, then averaged. */
export function correctPicked(
  picked: DialPass[],
  correct: (p: DialPass) => number
): DialPrediction | null {
  if (picked.length === 0) return null;
  const basis = picked.map((p) => ({ ...p, corrected: correct(p) }));
  const et = mean(basis.map((b) => b.corrected));
  const spread =
    basis.length > 1
      ? Math.sqrt(basis.reduce((a, b) => a + (b.corrected - et) ** 2, 0) / (basis.length - 1))
      : undefined;
  return { et, spread, basis };
}

/** The textbook move to the target air: ET goes with the cube root of the factor. */
export function textbookCorrected(p: DialPass, targetCf: number): number {
  return p.et * Math.cbrt(targetCf / p.cf);
}

/** Typical change in correction factor per 1,000 ft of density altitude. */
const DEFAULT_CF_PER_1000FT = 0.024;

/**
 * How much the correction factor moves per 1,000 ft of density altitude, read
 * off the car's own slips when they carry both (a weather station reports
 * D.A.); racers think in D.A., so sensitivity is shown that way.
 */
export function cfPerThousandFt(points: { da: number; cf: number }[]): number {
  if (points.length < 3) return DEFAULT_CF_PER_1000FT;
  const das = points.map((p) => p.da);
  if (Math.max(...das) - Math.min(...das) < 500) return DEFAULT_CF_PER_1000FT;
  const mx = mean(das);
  const my = mean(points.map((p) => p.cf));
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.da - mx) * (p.cf - my);
    den += (p.da - mx) ** 2;
  }
  const perFt = den > 0 ? num / den : 0;
  return perFt > 0 ? perFt * 1000 : DEFAULT_CF_PER_1000FT;
}

/**
 * The event's best pass once the air is evened out: every clean pass here
 * moved to the same air, using the car's own sensitivity. Needs three passes.
 * Returns the pass and how far ahead of the next one it is, on equal air.
 */
export function bestForAir(history: DialPass[]): { id: string; margin: number; secPerCf: number } | null {
  const here = history.filter((p) => p.thisEvent);
  if (here.length < 3) return null;
  const refCf = mean(here.map((p) => p.cf));
  const { secPerCf } = airSensitivity(history, refCf);
  const adjusted = here
    .map((p) => ({ id: p.id, et: p.et + secPerCf * (refCf - p.cf) }))
    .sort((a, b) => a.et - b.et);
  return { id: adjusted[0].id, margin: adjusted[1].et - adjusted[0].et, secPerCf };
}

const TIME_CLOCKS = ["sixtyFt", "threeThirty", "eighthEt", "thousandFt", "et"] as const;
const SPEED_CLOCKS = ["eighthMph", "mph"] as const;

/**
 * A whole predicted slip: every clock of each basis pass moved to the target
 * air by the same factor its ET moved, then averaged clock by clock.
 */
export function predictSlip(prediction: Pick<DialPrediction, "basis">): SlipClocks {
  const out: SlipClocks = {};
  const average = (key: keyof SlipClocks, scaled: (b: DialBasisPass, v: number) => number, dp: number) => {
    const vals = prediction.basis
      .map((b) => (b.clocks?.[key] !== undefined ? scaled(b, b.clocks[key]!) : undefined))
      .filter((v): v is number => v !== undefined);
    if (vals.length > 0) out[key] = parseFloat(mean(vals).toFixed(dp));
  };
  for (const k of TIME_CLOCKS) average(k, (b, v) => v * (b.corrected / b.et), 3);
  for (const k of SPEED_CLOCKS) average(k, (b, v) => v * (b.et / b.corrected), 2);
  return out;
}

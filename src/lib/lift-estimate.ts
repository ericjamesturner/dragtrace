/**
 * What a pass ran at one finish line (the 1/8 or the 1/4) when the driver may
 * have lifted before it — which bracket racers do on purpose. A flat pass is
 * used as it ran. A lifted one is projected from the last clock it passed at
 * full throttle, with this car's own finish ÷ split ratio (the method the pass
 * gallery's no-lift estimate uses), and its trap speed from the car's own
 * speed-for-ET. A pedal, or a lift before any usable clock, can't be undone.
 */
import type { SlipClocks } from "./dial-predictor";

export interface PassLift {
  kind: "lifted" | "pedaled";
  /** Seconds after the launch. */
  at: number;
}

export type Distance = "1/8" | "1/4";

export interface RunAt {
  state: "clean" | "estimated" | "out";
  et?: number;
  mph?: number;
  lift: PassLift | null;
  /** The clock an estimate was projected from. */
  from?: { label: string; value: number };
  /** The slip's clocks up to the lift, with the finish replaced by the estimate. */
  clocks: SlipClocks;
}

/** The car's own ratios, from its passes that ran flat to each finish. */
export interface LiftRefs {
  /** 1/8 ET ÷ 330'. */
  eighthPer330?: number;
  /** 1/8 ET × 1/8 MPH: near constant for one car, so MPH ≈ this ÷ ET. */
  eighthEtTimesMph?: number;
  /** 1/4 ET ÷ 1000'. */
  quarterPer1000?: number;
  /** 1/4 ET ÷ 1/8 ET. */
  quarterPerEighth?: number;
  /** 1/4 MPH ÷ 1/8 MPH. */
  quarterMphPerEighth?: number;
}

/** References use at most this many flat passes, newest first. */
const MAX_REFS = 8;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

function ratios(passes: SlipClocks[], num: (p: SlipClocks) => number | undefined, den: (p: SlipClocks) => number | undefined) {
  return avg(
    passes.flatMap((p) => {
      const n = num(p);
      const d = den(p);
      return n !== undefined && d !== undefined && d > 0 ? [n / d] : [];
    })
  );
}

/** `flatEighth` / `flatQuarter`: slips that ran flat to that finish, newest first. */
export function liftRefs(flatEighth: SlipClocks[], flatQuarter: SlipClocks[]): LiftRefs {
  const e = flatEighth.slice(0, MAX_REFS);
  const q = flatQuarter.slice(0, MAX_REFS);
  return {
    eighthPer330: ratios(e, (p) => p.eighthEt, (p) => p.threeThirty),
    eighthEtTimesMph: avg(
      e.flatMap((p) => (p.eighthEt !== undefined && p.eighthMph !== undefined ? [p.eighthEt * p.eighthMph] : []))
    ),
    quarterPer1000: ratios(q, (p) => p.et, (p) => p.thousandFt),
    quarterPerEighth: ratios(q, (p) => p.et, (p) => p.eighthEt),
    quarterMphPerEighth: ratios(q, (p) => p.mph, (p) => p.eighthMph),
  };
}

export function runAt(slip: SlipClocks, lift: PassLift | null, distance: Distance, refs: LiftRefs): RunAt {
  const finish = distance === "1/8" ? slip.eighthEt : slip.et;
  const finishMph = distance === "1/8" ? slip.eighthMph : slip.mph;
  if (finish === undefined || finish <= 0) return { state: "out", lift, clocks: {} };
  if (!lift) return { state: "clean", et: finish, mph: finishMph, lift: null, clocks: { ...slip } };
  if (lift.kind === "pedaled") return { state: "out", lift, clocks: {} };

  // Clocks the car reached before the lift still stand.
  const passed = (v: number | undefined) => (v !== undefined && v <= lift.at ? v : undefined);
  const kept: SlipClocks = {
    sixtyFt: passed(slip.sixtyFt),
    threeThirty: passed(slip.threeThirty),
    eighthEt: passed(slip.eighthEt),
    eighthMph: passed(slip.eighthEt) !== undefined ? slip.eighthMph : undefined,
    thousandFt: passed(slip.thousandFt),
  };

  let et: number | undefined;
  let mph: number | undefined;
  let from: RunAt["from"];
  if (distance === "1/8") {
    if (kept.threeThirty !== undefined && refs.eighthPer330 !== undefined) {
      et = kept.threeThirty * refs.eighthPer330;
      from = { label: "330'", value: kept.threeThirty };
      if (refs.eighthEtTimesMph !== undefined) mph = refs.eighthEtTimesMph / et;
    }
  } else {
    if (kept.thousandFt !== undefined && refs.quarterPer1000 !== undefined) {
      et = kept.thousandFt * refs.quarterPer1000;
      from = { label: "1000'", value: kept.thousandFt };
    } else if (kept.eighthEt !== undefined && refs.quarterPerEighth !== undefined) {
      et = kept.eighthEt * refs.quarterPerEighth;
      from = { label: "1/8", value: kept.eighthEt };
    }
    if (et !== undefined && kept.eighthMph !== undefined && refs.quarterMphPerEighth !== undefined) {
      mph = kept.eighthMph * refs.quarterMphPerEighth;
    }
  }
  if (et === undefined) return { state: "out", lift, clocks: {} };
  // A projection no quicker than the slip means the lift cost nothing.
  if (et >= finish) return { state: "clean", et: finish, mph: finishMph, lift: null, clocks: { ...slip } };
  const clocks: SlipClocks =
    distance === "1/8" ? { ...kept, eighthEt: et, eighthMph: mph } : { ...kept, et, mph };
  return { state: "estimated", et, mph, lift, from, clocks };
}

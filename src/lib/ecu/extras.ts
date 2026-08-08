import type { UnitAlternate } from "./types";

/**
 * Adjustments layered on top of the generated vendor table.
 *
 * Two reasons something lands here. Either the vendor's own label is ambiguous
 * once it leaves their software (AFR is listed three times with the same text,
 * distinguished only by the stoichiometric ratio baked into the scale), or the
 * alternate simply isn't in their table — Haltech ships gasoline and methanol
 * injector flow but no E85, which most of our users run.
 *
 * Raw lambda is logged as λ×1000, so an AFR alternate's scale is
 * `stoichiometric ratio / 1000`. Injector flow is logged in cc/min, so an
 * lb/hr alternate's scale is `density(g/cc) × 60 / 453.592`.
 */
export interface QuantityExtras {
  /** Replace the generated label for an alternate key. */
  relabel?: Record<string, string>;
  /** Alternates the vendor table doesn't carry. */
  add?: UnitAlternate[];
}

const lbHrPerCcMin = (density: number) => (density * 60) / 453.592;

export const QUANTITY_EXTRAS: Record<string, QuantityExtras> = {
  afr: {
    relabel: {
      "afr-14-71": "AFR Gas",
      "afr-6-47": "AFR Meth",
      // Two E85 ratios are in play — the one Haltech's software uses and the
      // one we shipped first. Tuners disagree on it, so name both explicitly
      // rather than making the user guess which "AFR E85" they're looking at.
      "afr-9": "AFR E85 (9.0)",
    },
    add: [
      { key: "afr-e85", label: "AFR E85 (9.77)", dp: 2, scale: 9.765 / 1000, offset: 0 },
      { key: "afr-diesel", label: "AFR Diesel", dp: 2, scale: 14.5 / 1000, offset: 0 },
    ],
  },
  flow: {
    relabel: {
      "inj-lb-hr": "lb/hr (Haltech)",
      "meth-lb-hr": "lb/hr Meth",
    },
    add: [
      { key: "lbhr-gas", label: "lb/hr Gas", dp: 2, scale: lbHrPerCcMin(0.743), offset: 0 },
      { key: "lbhr-e85", label: "lb/hr E85", dp: 2, scale: lbHrPerCcMin(0.781), offset: 0 },
    ],
  },
};

import type { UnitSystem, UnitAlternate } from "./ecu/types";
import { QUANTITIES, getQuantity, resolveAlternate, canonicalAlternate } from "./ecu/quantities";

export type { UnitSystem, UnitAlternate };

/** Display-unit choice per quantity slug, e.g. `{ pressure: "psi" }`. */
export type UnitOverrides = Record<string, string>;

/**
 * Channel values are stored in each quantity's canonical unit (see
 * `canonicalAlternate`). Both canonical and display are defined as linear
 * functions of the ECU's raw integer, so converting between them means undoing
 * one and applying the other.
 */
function canonicalToDisplay(value: number, slug: string | undefined): (a: UnitAlternate) => number {
  const c = canonicalAlternate(slug);
  return (a) => {
    if (!c || c.scale === 0) return value;
    const raw = (value - c.offset) / c.scale;
    return raw * a.scale + a.offset;
  };
}

export function convertForDisplay(
  value: number,
  quantitySlug: string,
  system: UnitSystem,
  overrides?: UnitOverrides,
): number {
  const alt = resolveAlternate(quantitySlug, system, overrides);
  if (!alt) return value;
  return canonicalToDisplay(value, quantitySlug)(alt);
}

/** Inverse of convertForDisplay: a value typed in display units -> canonical. */
export function convertFromDisplay(
  value: number,
  quantitySlug: string,
  system: UnitSystem,
  overrides?: UnitOverrides,
): number {
  const alt = resolveAlternate(quantitySlug, system, overrides);
  const c = canonicalAlternate(quantitySlug);
  if (!alt || !c || alt.scale === 0) return value;
  const raw = (value - alt.offset) / alt.scale;
  return raw * c.scale + c.offset;
}

export function getDisplayUnit(
  quantitySlug: string,
  system: UnitSystem,
  overrides?: UnitOverrides,
): string {
  const alt = resolveAlternate(quantitySlug, system, overrides);
  if (!alt) return "";
  // "Raw" and other unitless quantities carry a blank label.
  return alt.label.trim();
}

/** Decimal places this quantity is conventionally shown to, if known. */
export function getDisplayPrecision(
  quantitySlug: string | undefined,
  system: UnitSystem,
  overrides?: UnitOverrides,
): number | undefined {
  if (!quantitySlug) return undefined;
  return resolveAlternate(quantitySlug, system, overrides)?.dp;
}

/** Advance to the next display unit for a quantity; a no-op when there's one. */
export function cycleUnit(
  quantitySlug: string,
  system: UnitSystem,
  overrides: UnitOverrides,
): UnitOverrides {
  const q = getQuantity(quantitySlug);
  if (!q || q.alternates.length <= 1) return overrides;
  const current = resolveAlternate(quantitySlug, system, overrides);
  const idx = q.alternates.findIndex((a) => a.key === current?.key);
  const next = q.alternates[(idx + 1) % q.alternates.length];
  return { ...overrides, [q.slug]: next.key };
}

/** Display-unit options for a quantity, for building a unit picker. */
export function getUnitOptions(quantitySlug: string | undefined): UnitAlternate[] {
  return getQuantity(quantitySlug)?.alternates ?? [];
}

/** Quantities offering a real choice — the ones worth showing in preferences. */
export function quantitiesWithChoices() {
  return Object.values(QUANTITIES).filter((q) => q.alternates.length > 1);
}

/** The alternate key a quantity currently resolves to, for a unit picker. */
export function resolveUnitKey(
  quantitySlug: string,
  system: UnitSystem,
  overrides?: UnitOverrides,
): string {
  return resolveAlternate(quantitySlug, system, overrides)?.key ?? "";
}

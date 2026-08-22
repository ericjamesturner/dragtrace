import type { Quantity, UnitAlternate, UnitSystem } from "./types";
import { GENERATED_QUANTITIES } from "./quantities.generated";
import { QUANTITY_EXTRAS } from "./extras";

/**
 * The shared quantity registry: generated vendor data with our own additions
 * merged in. Keyed by vendor-neutral slug, it supplies default display units;
 * individual named channels may override those defaults.
 */
export const QUANTITIES: Record<string, Quantity> = (() => {
  const out: Record<string, Quantity> = {};
  for (const [slug, q] of Object.entries(GENERATED_QUANTITIES)) {
    const extras = QUANTITY_EXTRAS[slug];
    if (!extras) {
      out[slug] = q;
      continue;
    }
    const alternates: UnitAlternate[] = q.alternates.map((a) =>
      extras.relabel?.[a.key] ? { ...a, label: extras.relabel[a.key] } : a,
    );
    for (const add of extras.add ?? []) {
      if (!alternates.some((a) => a.key === add.key)) alternates.push(add);
    }
    out[slug] = { ...q, alternates };
  }
  return out;
})();

export function getQuantity(slug: string | undefined): Quantity | undefined {
  return slug ? QUANTITIES[slug] : undefined;
}

/** The alternate a quantity displays in, honouring an explicit user override. */
export function resolveAlternate(
  slug: string | undefined,
  system: UnitSystem,
  overrides?: Record<string, string>,
): UnitAlternate | undefined {
  const q = getQuantity(slug);
  if (!q) return undefined;
  const chosen = overrides?.[q.slug] ?? (system === "imperial" ? q.imperialKey : q.metricKey);
  return q.alternates.find((a) => a.key === chosen) ?? q.alternates[0];
}

/**
 * The alternate a channel's stored values are held in. Everything downstream of
 * the parser works in this unit, and display conversion goes through it, so it
 * must stay fixed for a given quantity.
 */
export function canonicalAlternate(slug: string | undefined): UnitAlternate | undefined {
  const q = getQuantity(slug);
  return q?.alternates.find((a) => a.key === q.metricKey) ?? q?.alternates[0];
}

/** Raw logged integer -> canonical stored value. */
export function rawToCanonical(raw: number, slug: string | undefined): number {
  const c = canonicalAlternate(slug);
  return c ? raw * c.scale + c.offset : raw;
}

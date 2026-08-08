// Generates src/lib/ecu/quantities.generated.ts from the Haltech unit table.
//
// The unit table was extracted from Haltech's NSP software (see the companion
// haltech reverse-engineering notes). It is the best measurement-unit data we
// have, so it seeds the shared quantity registry — but the registry itself is
// vendor-neutral: quantities are keyed by a plain slug like "pressure", and
// each ECU adapter maps its own channel-type tokens onto those slugs. A second
// vendor reuses the same quantities rather than bringing its own.
//
//   npm run gen:quantities

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SRC = join(root, "src/lib/ecu/haltech-units.json");
const OUT = join(root, "src/lib/ecu/quantities.generated.ts");

// Unit labels are full of symbols that would otherwise slug down to nothing or
// collide (λ and µL both vanish under a plain [^a-z0-9] filter).
const TRANSLITERATE = [
  [/λ/g, "lambda"], [/Ω|Ω/g, "ohm"], [/µ|μ/g, "u"], [/°/g, "deg"],
  [/²/g, "2"], [/³/g, "3"], [/⋅|·/g, "-"], [/%/g, "pct"],
];
const slug = (s) => {
  let out = s.trim().toLowerCase();
  for (const [re, to] of TRANSLITERATE) out = out.replace(re, to);
  return out.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
};

// Labels that mark an alternate as the imperial-system choice.
const IMPERIAL = [
  "psi", "inhg", "mph", " mi", "^mi$", "ft", "inches", "°f", "lb", "gal",
  "hp", "grains", "cid", "us fl oz", "us tsp", "mpg", "cfm", "lbf",
];
const isImperial = (label) => {
  const l = label.toLowerCase();
  if (l === "mi" || l === "ft" || l === "inches") return true;
  return IMPERIAL.some((t) => !t.startsWith("^") && t !== "ft" && l.includes(t));
};

// Quantities where the heuristic would pick the wrong default, or where we
// deliberately keep one unit for both systems (tuners read lambda and cc/min
// regardless of where they live).
const DEFAULT_OVERRIDES = {
  afr: { metric: "λ", imperial: "λ" },
  lambda: { metric: "λ", imperial: "λ" },
  flow: { metric: "cc/min", imperial: "cc/min" },
  acceleration: { metric: "m/s²", imperial: "g" },
  raw: { metric: " ", imperial: " " },
};

const raw = JSON.parse(readFileSync(SRC, "utf8"));

const quantities = {};
const typeToSlug = {};
const collisions = [];
const collisionsType = [];

for (const [id, q] of Object.entries(raw)) {
  const s = slug(q.name);
  // The CSV "Type :" token is the same name in a different spelling — spaces
  // removed ("AbsPressure"), or underscored ("Time_ms_as_s"), and the extractor
  // itself splits some camelCase apart ("Current m A as A" vs "Current_mA_as_A").
  // Matching on alphanumerics only makes every spelling agree.
  const norm = q.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (typeToSlug[norm] && typeToSlug[norm] !== s) {
    collisionsType.push(`${norm}: ${typeToSlug[norm]} vs ${s}`);
  }
  typeToSlug[norm] = s;

  // Haltech's table repeats some alternates verbatim (Abs Pressure lists
  // psi (Abs.) three times). Identical entries are noise in a unit picker.
  const alts = [];
  const seenAlt = new Set();
  for (const a of q.v ?? []) {
    const sig = `${a.label}|${a.scale}|${a.offset}`;
    if (seenAlt.has(sig)) continue;
    seenAlt.add(sig);
    alts.push(a);
  }
  // Value of the raw integer that reads as 1.0 in the first alternate, used to
  // disambiguate alternates that share a label (AFR is listed three times, once
  // per fuel, with no distinguishing text).
  const a0 = alts[0];
  const rawFor1 = a0 && a0.scale !== 0 ? (1 - a0.offset) / a0.scale : 0;

  const labelCounts = {};
  for (const a of alts) labelCounts[a.label] = (labelCounts[a.label] ?? 0) + 1;

  const usedKeys = new Set();
  const alternates = alts.map((a, i) => {
    let label = a.label;
    if (labelCounts[a.label] > 1) {
      const at1 = rawFor1 * a.scale + a.offset;
      label = `${a.label} (${Number(at1.toFixed(2))})`;
      if (i === 0) collisions.push(`${q.name}: ${a.label}`);
    }
    let key = slug(label);
    if (key === "unknown") key = `alt-${i}`;
    while (usedKeys.has(key)) key = `${key}-${i}`;
    usedKeys.add(key);
    return { key, label, dp: a.dp ?? 1, scale: a.scale, offset: a.offset };
  });

  if (alternates.length === 0) continue;

  const ov = DEFAULT_OVERRIDES[s];
  const findByLabel = (l) => alternates.find((x) => x.label === l)?.key;
  const metricKey = (ov && findByLabel(ov.metric)) || alternates[0].key;
  const imperialKey =
    (ov && findByLabel(ov.imperial)) ||
    alternates.find((x) => isImperial(x.label))?.key ||
    alternates[0].key;

  quantities[s] = {
    slug: s,
    name: q.name,
    sourceId: Number(id),
    alternates,
    metricKey,
    imperialKey,
  };
}

const banner = `// GENERATED FILE — do not edit by hand.
// Run \`npm run gen:quantities\` to regenerate from src/lib/ecu/haltech-units.json.
//
// ${Object.keys(quantities).length} quantities, ${Object.values(quantities).reduce((n, q) => n + q.alternates.length, 0)} alternates,
// ${Object.values(quantities).filter((q) => q.alternates.length > 1).length} of which offer a choice of display unit.

import type { Quantity } from "./types";

export const GENERATED_QUANTITIES: Record<string, Quantity> = ${JSON.stringify(
  quantities,
  null,
  2,
)};

/**
 * Haltech \`Type :\` token -> quantity slug, keyed by the token reduced to
 * lowercase alphanumerics. Use \`normalizeTypeToken\` to look up.
 */
export const HALTECH_TYPE_TO_SLUG: Record<string, string> = ${JSON.stringify(
  typeToSlug,
  null,
  2,
)};

export function normalizeTypeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}
`;

writeFileSync(OUT, banner);
console.log(
  `wrote ${OUT}\n  ${Object.keys(quantities).length} quantities` +
    `\n  ${Object.values(quantities).filter((q) => q.alternates.length > 1).length} with alternates` +
    `\n  ${Object.keys(typeToSlug).length} type tokens` +
    (collisions.length ? `\n  disambiguated labels: ${collisions.join(", ")}` : "") +
    (collisionsType.length ? `\n  TYPE TOKEN COLLISIONS: ${collisionsType.join(", ")}` : ""),
);

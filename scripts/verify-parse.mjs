// End-to-end check of the real parsing pipeline against a log on disk.
//
// Bundles the actual source modules with esbuild and runs them in node, so this
// exercises the same code the browser does rather than a reimplementation.
//
//   node scripts/verify-parse.mjs <log.csv>

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const csvPath = process.argv[2];
if (!csvPath) {
  console.error("usage: node scripts/verify-parse.mjs <log.csv>");
  process.exit(1);
}

// The pack is fetched over HTTP in the browser; serve it from disk here.
const packJson = readFileSync(join(root, "public/ecu/haltech/channels.json"), "utf8");
globalThis.fetch = async (url) => {
  if (String(url).includes("channels.json")) {
    return { ok: true, json: async () => JSON.parse(packJson) };
  }
  return { ok: false, json: async () => ({}) };
};

const entry = `
  export { parseHaltech, detectHaltech } from ${JSON.stringify(join(root, "src/lib/haltech-parser.ts"))};
  export { enrichWithDefinitions } from ${JSON.stringify(join(root, "src/lib/ecu/enrich.ts"))};
  export { convertForDisplay, getDisplayUnit, getDisplayPrecision } from ${JSON.stringify(join(root, "src/lib/units.ts"))};
  export { formatChannelValue } from ${JSON.stringify(join(root, "src/lib/cursor-utils.ts"))};
`;

const out = await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node22",
  loader: { ".json": "json" },
  alias: { "@": join(root, "src") },
});

const mod = await import(
  `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
);

const text = readFileSync(resolve(csvPath), "utf8");
console.log(`log: ${csvPath.split("/").pop()}  (${(text.length / 1e6).toFixed(1)} MB)\n`);

if (!mod.detectHaltech(text)) {
  console.error("not recognised as a Haltech log");
  process.exit(1);
}

const t0 = Date.now();
const parsed = mod.parseHaltech(text);
const tParse = Date.now() - t0;
await mod.enrichWithDefinitions(parsed, "haltech");
const tTotal = Date.now() - t0;

const session = parsed.sessions[0];
const defs = parsed.channelDefs.filter((d) => !d.computed);
console.log(
  `parsed ${defs.length} channels x ${session.rowCount} rows in ${tParse}ms ` +
    `(+${tTotal - tParse}ms enrich)\n`,
);

const withQuantity = defs.filter((d) => d.quantitySlug).length;
const withDesc = defs.filter((d) => d.description).length;
const withShort = defs.filter((d) => d.shortName).length;
const withEnum = defs.filter((d) => d.enumValues).length;
const withPath = defs.filter((d) => d.path).length;
console.log("resolved from the definition data:");
console.log(`  quantity (unit scaling) ${withQuantity}/${defs.length}`);
console.log(`  description             ${withDesc}/${defs.length}`);
console.log(`  short name              ${withShort}/${defs.length}`);
console.log(`  hierarchy path          ${withPath}/${defs.length}`);
console.log(`  value labels (enum)     ${withEnum}/${defs.length}`);

console.log(`\nsensor faults reported: ${session.channelStatus.size} channels`);
for (const [name, st] of [...session.channelStatus].slice(0, 6)) {
  const pct = Math.round((st.samples / st.rowCount) * 100);
  console.log(`  ${name.slice(0, 46).padEnd(48)} ${st.dominantLabel ?? st.dominantCode} (${pct}% of run)`);
}

// Anything that still plots as an absurd number is a scaling miss.
console.log("\nsanity — extreme values after scaling (should be none):");
let bad = 0;
for (const def of defs) {
  const arr = session.channels.get(def.name);
  if (!arr) continue;
  let mx = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = Math.abs(arr[i]);
    if (v === v && v > mx) mx = v;
  }
  if (mx > 1e6) {
    console.log(`  ${def.name.slice(0, 46).padEnd(48)} max ${mx.toExponential(2)}  [${def.type}]`);
    bad++;
  }
}
if (bad === 0) console.log("  none");

console.log("\nsample readings at mid-run:");
const mid = Math.floor(session.rowCount / 2);
const interesting = ["Engine Speed", "RPM", "Wideband O2 1", "Stoichiometric Ratio",
  "Engine Limiter Max RPM", "Manifold Pressure", "Fuel - Load (MAP)", "Coolant Temperature"];
for (const def of defs) {
  if (!interesting.some((n) => def.name === n)) continue;
  const arr = session.channels.get(def.name);
  if (!arr) continue;
  const raw = arr[mid];
  const slug = def.quantitySlug ?? "";
  const shown = def.enumValues
    ? mod.formatChannelValue(raw, { enumValues: def.enumValues })
    : mod.formatChannelValue(mod.convertForDisplay(raw, slug, "imperial"), {
        decimals: mod.getDisplayPrecision(slug, "imperial"),
      });
  const unit = def.enumValues ? "" : mod.getDisplayUnit(slug, "imperial");
  console.log(`  ${def.name.slice(0, 34).padEnd(36)} ${String(shown).padStart(12)} ${unit}`);
}

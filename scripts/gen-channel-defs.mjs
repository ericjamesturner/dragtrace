// Builds public/ecu/haltech/channels.json from the ECU definition packs.
//
// The packs are produced by the companion haltech project (`hdefs.py pack`) and
// live outside this repo; the emitted JSON is committed so a checkout doesn't
// need them. Point at a different directory with HALTECH_PACK_DIR.
//
//   npm run gen:channels
//
// A logged channel's `ID :` in the CSV export is the definition object's id, so
// this file turns that number into a name, a description, a place in the ECU's
// own hierarchy, and — for state channels — the labels for its values.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PACK_DIR = process.env.HALTECH_PACK_DIR || join(root, "../haltech");
const OUT_DIR = join(root, "public/ecu/haltech");
const OUT = join(OUT_DIR, "channels.json");

if (!existsSync(PACK_DIR)) {
  console.error(
    `No pack directory at ${PACK_DIR}.\n` +
      `Set HALTECH_PACK_DIR to where the pack-*.json files live. ` +
      `The committed ${OUT} is left untouched.`,
  );
  process.exit(1);
}

const packFiles = readdirSync(PACK_DIR).filter((f) => /^pack-.*\.json$/.test(f));
if (packFiles.length === 0) {
  console.error(`No pack-*.json files in ${PACK_DIR}.`);
  process.exit(1);
}

// An entry is a loggable channel if it carries a unit type or enumerated
// values. Tune-only settings (addresses, table payloads) are dropped — they
// can never appear as a log channel and are the bulk of the file.
const isChannel = (v) => Boolean(v.u || v.e);

const merged = {};
const sources = [];

// Merge newest-first so a later firmware's naming wins on conflict.
for (const file of packFiles.sort().reverse()) {
  const pack = JSON.parse(readFileSync(join(PACK_DIR, file), "utf8"));
  sources.push(`${pack.name ?? file} ${pack.version ?? ""}`.trim());
  let added = 0;
  for (const [id, v] of Object.entries(pack.defs ?? {})) {
    if (!isChannel(v)) continue;
    const entry = {};
    if (v.L) entry.L = v.L;
    if (v.s && v.s !== v.L) entry.s = v.s;
    // Most descriptions restate the name, sometimes with a trailing period or
    // different casing. Those add nothing to a tooltip.
    const sameAsName = (a, b) =>
      a && b && a.replace(/[.\s]+$/, "").toLowerCase() === b.replace(/[.\s]+$/, "").toLowerCase();
    if (v.d && !sameAsName(v.d, v.L)) entry.d = v.d;
    if (v.p) entry.p = v.p;
    if (v.e) entry.e = v.e;
    if (Object.keys(entry).length === 0) continue;
    if (!(id in merged)) added++;
    merged[id] = { ...entry, ...merged[id] };
  }
  console.log(`  ${file}: +${added} channels`);
}

mkdirSync(OUT_DIR, { recursive: true });
const payload = {
  ecuType: "haltech",
  sources,
  channels: merged,
};
writeFileSync(OUT, JSON.stringify(payload));

const bytes = Buffer.byteLength(JSON.stringify(payload));
console.log(
  `wrote ${OUT}\n  ${Object.keys(merged).length} channels from ${packFiles.length} packs` +
    `\n  ${Math.round(bytes / 1024)} KB (served compressed)`,
);

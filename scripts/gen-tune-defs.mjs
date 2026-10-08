// Builds public/ecu/haltech/tune/<product>-<variant>-<firmware>.json from the
// ECU definition packs, for comparing tunes.
//
// A tune (the .nexmap inside an .hlgzip) is a flat list of object ids and raw
// bytes. This file is what turns an id back into a setting: its name, its
// place in Haltech's tree, its value type, table shape and axes, unit, and the
// labels of its choices. One file per ECU model and firmware — ids mean
// different things on an Elite than on a Nexus, and can move between firmware
// releases — fetched only by the compare page. A tune whose exact firmware
// has no file here is read with the nearest one for the same model.
//
//   npm run gen:tunes
//
// The packs come from the companion haltech project (`hdefs.py pack`); set
// HALTECH_PACK_DIR if they live somewhere other than ../haltech.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { groupNames, indexSegments } from "./lib/haltech-groups.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PACK_DIR = process.env.HALTECH_PACK_DIR || join(root, "../haltech");
const OUT_DIR = join(root, "public/ecu/haltech/tune");

if (!existsSync(PACK_DIR)) {
  console.error(`No pack directory at ${PACK_DIR}. Set HALTECH_PACK_DIR.`);
  process.exit(1);
}
const packFiles = readdirSync(PACK_DIR).filter((f) => /^pack-.*\.json$/.test(f)).sort();
const packs = packFiles.map((file) => ({ file, pack: JSON.parse(readFileSync(join(PACK_DIR, file), "utf8")) }));
indexSegments(packs.map(({ pack }) => pack));

mkdirSync(OUT_DIR, { recursive: true });
const index = [];

for (const { file, pack } of packs) {
  if (!pack.groups) {
    console.error(`${file} has no group names. Rebuild it with the current hdefs.py.`);
    process.exit(1);
  }
  const groupTable = [];
  const groupIndex = new Map();
  const groupId = (names) => {
    const key = names.join("\u0000");
    let id = groupIndex.get(key);
    if (id === undefined) {
      id = groupTable.length;
      groupTable.push(names);
      groupIndex.set(key, id);
    }
    return id;
  };

  const defs = {};
  for (const [id, v] of Object.entries(pack.defs ?? {})) {
    const entry = {};
    if (v.L) entry.L = v.L;
    else if (v.n) entry.L = v.n;
    if (v.t) entry.t = v.t;
    if (v.D) entry.D = v.D;
    if (v.u) entry.u = v.u;
    if (v.e) entry.e = v.e;
    if (v.c) entry.c = v.c;
    if (v.p) {
      const names = groupNames(v.p, pack.groups);
      if (names.length > 0) entry.g = groupId(names);
      // Axis members and table payloads are found through their table's `c`;
      // flag them so a diff reports the table, not its plumbing.
      if (/\/(Column|Row|Slice)Axis\//.test(v.p)) entry.x = 1;
    }
    defs[id] = entry;
  }

  const out = `${pack.product}-${pack.variant}-${pack.version}.json`;
  writeFileSync(
    join(OUT_DIR, out),
    JSON.stringify({ product: pack.product, variant: pack.variant, name: pack.name, version: pack.version, groups: groupTable, defs }),
  );
  index.push({ product: pack.product, variant: pack.variant, name: pack.name, version: pack.version, file: out });
  console.log(`  ${out}: ${pack.name} ${pack.version}, ${Object.keys(defs).length} objects`);
}

writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(index));
console.log(`wrote ${OUT_DIR}`);

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
//
// Ids are not stable across ECU families: the same id is a different channel on
// an Elite than on a Nexus. Where the packs disagree, an id keeps one entry per
// distinct channel and the viewer picks the one whose name matches the log.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fallbacks, groupNames, indexSegments, prettify } from "./lib/haltech-groups.mjs";

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

// An entry can be a logged channel if it carries a unit type or enumerated
// values, or is a named scalar — unitless channels such as "Generic Output 1
// Out" or "Torque Management Driveshaft RPM Target Error" carry neither.
// Tables, table axes and internal objects (leading underscore) are dropped:
// they can never appear in a log and are the bulk of the file.
const isChannel = (v) =>
  !/\/(Column|Row|Slice)Axis\//.test(v.p ?? "") &&
  Boolean(v.u || v.e || (v.L && !v.D && !v.c && !v.L.startsWith("_")));

// Most descriptions restate the name, sometimes with a trailing period or
// different casing. Those add nothing to a tooltip.
const sameAsName = (a, b) =>
  a && b && a.replace(/[.\s]+$/, "").toLowerCase() === b.replace(/[.\s]+$/, "").toLowerCase();

const groupTable = [];
const groupIndex = new Map();
function groupId(names) {
  const key = names.join("\u0000");
  let id = groupIndex.get(key);
  if (id === undefined) {
    id = groupTable.length;
    groupTable.push(names);
    groupIndex.set(key, id);
  }
  return id;
}

/** id -> distinct entries, newest pack first. */
const merged = new Map();
const sources = [];

const packs = packFiles
  .sort()
  .reverse()
  .map((file) => ({ file, pack: JSON.parse(readFileSync(join(PACK_DIR, file), "utf8")) }));
indexSegments(packs.map(({ pack }) => pack));
const sameChannel = (a, b) => (a.L ?? "").trim().toLowerCase() === (b.L ?? "").trim().toLowerCase();

// Newest-first, so a later firmware's naming wins where two packs agree on the
// channel but word it differently.
for (const { file, pack } of packs) {
  if (!pack.groups) {
    console.error(
      `${file} has no group names. Rebuild it with the current hdefs.py ` +
        `(\`python3 hdefs.py pack --md5 <HDEF_MD5>\`).`,
    );
    process.exit(1);
  }
  sources.push(`${pack.name ?? file} ${pack.version ?? ""}`.trim());
  let added = 0;
  let variants = 0;
  for (const [id, v] of Object.entries(pack.defs ?? {})) {
    if (!isChannel(v)) continue;
    const entry = {};
    if (v.L) entry.L = v.L;
    if (v.s && v.s !== v.L) entry.s = v.s;
    if (v.d && !sameAsName(v.d, v.L)) entry.d = v.d;
    if (v.p) {
      entry.p = v.p;
      const names = groupNames(v.p, pack.groups);
      if (names.length > 0) entry.g = groupId(names);
    }
    if (v.e) entry.e = v.e;
    if (Object.keys(entry).length === 0) continue;

    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, [entry]);
      added++;
      continue;
    }
    const same = existing.find((x) => sameChannel(x, entry));
    if (same) {
      // Fill anything the newer pack left out.
      for (const [k, val] of Object.entries(entry)) if (!(k in same)) same[k] = val;
    } else {
      existing.push(entry);
      variants++;
    }
  }
  console.log(`  ${file}: +${added} channels, +${variants} variants of existing ids`);
}

const channels = {};
for (const [id, entries] of merged) channels[id] = entries.length === 1 ? entries[0] : entries;

mkdirSync(OUT_DIR, { recursive: true });
const payload = {
  ecuType: "haltech",
  sources,
  groups: groupTable,
  channels,
};
writeFileSync(OUT, JSON.stringify(payload));

const bytes = Buffer.byteLength(JSON.stringify(payload));
console.log(
  `wrote ${OUT}\n  ${merged.size} channels, ${groupTable.length} groups from ${packFiles.length} packs` +
    `\n  ${Math.round(bytes / 1024)} KB (served compressed)`,
);
if (process.env.SHOW_FALLBACKS) {
  for (const [seg, n] of [...fallbacks].sort((x, y) => y[1] - x[1])) console.log(`  ${n}\t${seg} -> ${prettify(seg)}`);
}

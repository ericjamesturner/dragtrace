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

// ── Group names ──
// The object tree's own segment names are internal ("HCO25", "WIDEBAND_AVG",
// "FuelAdditonalTables"). Most containers carry a display name in the
// definition; the ones that don't — mostly the top level — are named here.
const SEGMENT_NAMES = {
  Functions: "Functions",
  Sensors: "Sensors",
  InjectionSystem: "Injection System",
  FuelSystem: "Fuel System",
  IgnitionSystem: "Ignition System",
  SparkTiming: "Ignition Timing",
  ElectronicThrottle: "Electronic Throttle",
  Trigger: "Trigger",
  EngineDescription: "Engine",
  EngineParameters: "Engine",
  EngineRuntimeInfo: "Engine",
  VehicleDescription: "Vehicle",
  DTC_Codes: "Fault Codes",
  DTC: "Fault Codes",
  DTC_LIST: "Fault Codes",
  AVI: "Analogue Voltage Inputs",
  SPI: "Synced Pulse Inputs",
  DPO: "Digital Pulsed Outputs",
  HBO: "Half Bridge Outputs",
  HCO8: "8A High Current Outputs",
  HCO25: "25A High Current Outputs",
  INJ: "Injector Outputs",
  IGN: "Ignition Outputs",
  GENERIC_TIMER: "Generic Timers",
  POWER_MAN: "Power Management",
  POWER_MAN_DEVICE: "Power Management",
  CAN_MATRIX: "CAN Signals",
  CAN_system: "CAN",
  CAN_PORT: "CAN",
  THIRD_PARTY_CAN: "Third Party CAN",
  INTERNAL_WBI: "Internal Wideband",
  INTERNAL_IMU: "Internal IMU",
  KNOCK_INPUTS: "Knock Inputs",
  DataLogging: "Data Logging",
  DASH: "Dash",
  Devices: "Devices",
  System: "System",
  Limiter: "Limiters",
  Switches: "Switches",
  Scheduler: "Scheduler",
  Button: "Buttons",
  // Second level, where the definition carries no name.
  N2O: "Nitrous",
  WIDEBAND_AVG: "Wideband Averaging",
  FuelAdditonalTables: "Fuel Corrections",
  SparkAdditonalTables: "Ignition Corrections",
  IgnitionOutputs: "Ignition Outputs",
  AIR_PRESSURE: "Air Pressure",
  EGT_Cyl_SHUTDOWN: "EGT Cylinder Shutdown",
  MISC: "Miscellaneous",
  VEHICLE_SPEED: "Vehicle Speed",
  FUEL_PRESSURE: "Fuel Pressure",
  AirSystem: "Air System",
  ATMOSPHERIC_DATA: "Atmospheric Data",
  RTC: "Clock",
  UserLogging: "User Logging",
  CONTROLLERS: "Controllers",
  ENABLERS: "Enablers",
  TPS: "Throttle Position",
  APP: "Accelerator Pedal",
  HOME: "Home",
  FuelLevel: "Fuel Level",
};

/** Segments that carry no grouping information of their own. */
const SKIP_SEGMENTS = new Set(["Settings", "VALUE", "VALUES", "Value", "Values"]);

/** Most specific first; groups deeper than this fold into their parent. */
const MAX_DEPTH = 3;

/** A definition name fit to show: not an internal identifier or stray prose. */
function cleanName(s) {
  if (!s) return null;
  const t = s.trim().replace(/\s+/g, " ");
  if (!t || t.startsWith("_") || t.length > 48 || /[.:]/.test(t)) return null;
  if (/^[A-Z0-9_]+$/.test(t) && t.includes("_")) return null;
  return t;
}

/** Short words kept in capitals when a segment is spelled out. */
const ACRONYMS = new Set(["ECU", "RPM", "TPS", "GPS", "DTC", "CAN", "IO", "EGT", "TMS", "TCA", "WBC", "OBPS", "AC", "DC"]);

/** Every path segment in every pack, for telling 0-based numbering apart. */
const allSegments = new Set();

function prettify(seg) {
  // The tree numbers from zero ("STAGE_0" holds Injection Stage 1); the names
  // users see number from one. A segment family is 0-based if it has a _0.
  const numbered = seg.match(/^(.*)_(\d+)$/);
  if (numbered && allSegments.has(`${numbered[1]}_0`)) {
    const n = Number(numbered[2]) + 1;
    // A lone _0 is not one of a series; the number only adds noise.
    const label = n === 1 && !allSegments.has(`${numbered[1]}_1`) ? "" : ` ${n}`;
    return prettify(numbered[1]) + label;
  }
  // CamelCase splits into words; a capitals token ("TI4L") is one word.
  const words = seg.includes("_") || seg.includes(" ") || !/[a-z]/.test(seg)
    ? seg.split(/[_\s]+/)
    : seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return words
    .filter(Boolean)
    .map((w) => {
      const upper = w === w.toUpperCase();
      // "PD16", "TI4L", "CO2": model and part names stay as written.
      if (upper && (/\d/.test(w) || ACRONYMS.has(w))) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Segments named by `prettify`, reported so the table above can be extended. */
const fallbacks = new Map();

/** Display names for the groups above a channel, outermost first. */
function groupNames(path, packGroups) {
  const segments = path.split("/");
  const names = [];
  // The final segment names the channel itself, not a group.
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!seg || SKIP_SEGMENTS.has(seg)) continue;
    const g = packGroups[segments.slice(0, i + 1).join("/")];
    const name = cleanName(g?.L) ?? cleanName(g?.m) ?? SEGMENT_NAMES[seg];
    if (name) {
      names.push(name);
    } else if (!seg.startsWith("_")) {
      // Underscore segments are internal plumbing with no name of their own.
      names.push(prettify(seg));
      fallbacks.set(seg, (fallbacks.get(seg) ?? 0) + 1);
    }
  }
  // A container often repeats its parent's name ("Nitrous" > "Nitrous").
  const deduped = names.filter((n, i) => i === 0 || n.toLowerCase() !== names[i - 1].toLowerCase());
  return deduped.slice(0, MAX_DEPTH);
}

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
for (const { pack } of packs) {
  for (const v of Object.values(pack.defs ?? {})) for (const seg of (v.p ?? "").split("/")) allSegments.add(seg);
}
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

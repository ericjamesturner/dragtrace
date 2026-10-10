/**
 * Tune changes read from a car's .hlgzip uploads: a fingerprint per upload
 * (so two passes on the same tune are known equal without opening either),
 * and the settings that moved between two tunes, written for the car's
 * change log.
 */
import type { Tune } from "./haltech-tune";
import { changeArea, deltaSpan, diffTunes, type AxisRange, type TuneChange, type TuneDefs, type UnitChoice } from "./tune-diff";
import { inGroupLabel } from "./legend-labels";

/** When NSP wrote the log, from its file name stamp: "2026-10-08_1248pm". */
export function timeFromName(name: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})([ap])m/i.exec(name);
  if (!m) return null;
  const hour = (Number(m[4]) % 12) + (m[6].toLowerCase() === "p" ? 12 : 0);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[5])).getTime();
}

/** What a racer calls the run: the name before NSP's date and log stamps. */
export function runLabel(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cut = base.search(/\s*-?\s*\d{4}-\d{2}-\d{2}_\d{4}[ap]m/i);
  const short = (cut > 0 ? base.slice(0, cut) : base).replace(/[\s_-]+$/, "").trim();
  return short || base;
}

/** Same for two tunes exactly when every stored setting is the same. */
export async function tuneFingerprint(tune: Tune): Promise<string> {
  const ids = [...tune.values.keys()].sort((a, b) => a - b);
  const text = `${tune.meta.product}/${tune.meta.variant}|${ids.map((id) => `${id}:${tune.values.get(id)}`).join(",")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "01.31.03.000" -> "1.31.3". */
const shortFirmware = (v: string) =>
  v.split(".").slice(0, 3).map((p) => String(Number(p) || 0)).join(".");

export interface TuneLogEntry {
  category: "tune" | "firmware";
  title: string;
  items?: string[];
  notes?: string;
}

/**
 * What changed from tune `a` to tune `b`, as a change-log entry — or null
 * when nothing a racer set is different. Only settings stored in both tunes
 * count: one that exists on one side only is a difference between firmware
 * versions, not a change anyone made. Across a firmware update the settings
 * can't be lined up at all (ids can move between releases), so that is
 * logged as the update alone.
 */
export function compareTunes(a: Tune, b: Tune, defs: TuneDefs | null, units: UnitChoice): TuneLogEntry | null {
  const sameEcu = a.meta.product === b.meta.product && a.meta.variant === b.meta.variant;
  if (!sameEcu || a.meta.firmware !== b.meta.firmware || a.meta.hdefMd5 !== b.meta.hdefMd5) {
    return {
      category: "firmware",
      title: `Firmware ${shortFirmware(a.meta.firmware)} → ${shortFirmware(b.meta.firmware)}`,
      notes: "Tune settings can't be compared across firmware versions, so any edits made with this update aren't listed.",
    };
  }
  // Without a settings list for this ECU there are no names to show.
  if (!defs) return null;
  const made = diffTunes(a, b, defs, units).filter(
    (c) => c.kind === "table" || (c.before !== undefined && c.after !== undefined && c.before !== "—" && c.after !== "—")
  );
  if (made.length === 0) return null;
  return {
    category: "tune",
    ...tuneChangeEntry(made),
    notes: defs.exact
      ? undefined
      : `Setting names are from the ${defs.version} settings list; this ECU runs ${shortFirmware(b.meta.firmware)}.`,
  };
}

/** What a racer calls a setting, given the tree it sits in. */
const FRIENDLY: { group?: RegExp; name: RegExp; label: string | ((m: RegExpExecArray) => string) }[] = [
  { group: /boost control/i, name: /^target pressure/i, label: "Boost target" },
  { name: /shift point/i, label: "Shift point" },
  { name: /timed ignition correction/i, label: "TM timing" },
  { name: /engine rpm cut percentage/i, label: "TM cut" },
  { name: /engine rpm target error ignition correction/i, label: "TM timing on RPM error" },
  { name: /engine rpm target$/i, label: "TM RPM line" },
  { name: /driveshaft rpm target$/i, label: "TM driveshaft line" },
  { name: /target lambda/i, label: "Target lambda" },
  { name: /base fuel/i, label: "Base fuel" },
  { name: /^fuel cylinder (\d+) correction/i, label: (m) => `Cyl ${m[1]} fuel trim` },
  { name: /^fuel generic (\d+) correction/i, label: (m) => `Fuel trim ${m[1]}` },
  { group: /launch control/i, name: /end rpm/i, label: "Launch end RPM" },
  { group: /launch control/i, name: /^ignition/i, label: "Launch timing" },
  { group: /launch control/i, name: /fuel correction/i, label: "Launch fuel" },
  { group: /launch control/i, name: /^enable/i, label: "Launch control" },
  { group: /trans-?brake/i, name: /rpm limiter method/i, label: "Trans-brake limiter" },
  { name: /number of teeth/i, label: "Driveshaft sensor teeth" },
  { group: /o2 control/i, name: /min rpm/i, label: "O2 control min RPM" },
];

/** Names that mean nothing without the group they sit in. */
const GENERIC = /^(enable|pull up enable|method|type|channel \d+|condition \d+|operator \d+|number of operations)$/i;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

function friendlyName(c: TuneChange): string {
  const leaf = c.group[c.group.length - 1];
  const where = c.group.join(" > ");
  for (const f of FRIENDLY) {
    if (f.group && !f.group.test(where)) continue;
    const m = f.name.exec(inGroupLabel(c.name, leaf)) ?? f.name.exec(c.name);
    if (m) return typeof f.label === "string" ? f.label : f.label(m);
  }
  const own = inGroupLabel(c.name, leaf);
  return GENERIC.test(own) && leaf ? sentence(`${leaf} ${own}`) : own;
}

/** "trim knob 1 12" -> "knob 12"; a single throttle value says nothing. */
function friendlyRange(r: AxisRange): string | null {
  const span = r.from !== r.to ? `${r.from}–${r.to}` : r.from;
  if (/^trim knob \d+$/i.test(r.name)) return `knob ${span}`;
  if (/torque management knob/i.test(r.name)) return `TM knob ${span}`;
  if (/^throttle$/i.test(r.name) && r.from === r.to) return null;
  if (/^time$/i.test(r.name)) return `${span} s`;
  return `${r.name} ${span}${r.unit ? ` ${r.unit}` : ""}`;
}

const onOff = (v: string | undefined) => (v === "Enable" ? "on" : v === "Disable" ? "off" : v);

/**
 * A change-log entry for one tune change: a title naming the areas that
 * moved ("Boost, Ignition"), and one line per setting, "Name: change", the
 * change first and where on the table after it.
 */
export function tuneChangeEntry(changes: TuneChange[]): { title: string; items: string[] } {
  const ranked = changes
    .map((c) => ({ c, ...changeArea(c) }))
    .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));
  const areas = [...new Set(ranked.map((r) => r.area))];
  const items = ranked.map(({ c }) => {
    const name = friendlyName(c);
    if (c.kind !== "table" || !c.table) return `${name}: ${onOff(c.before)} → ${onOff(c.after)}`;
    const t = c.table;
    if (!t.cellsChanged) return `${name}: breakpoints moved`;
    const unit = t.unit ? ` ${t.unit}` : "";
    // An axis with one breakpoint says nothing about where.
    const where = [t.rows > 1 ? t.rowRange : undefined, t.cols > 1 ? t.colRange : undefined]
      .filter((r): r is AxisRange => !!r)
      .map(friendlyRange)
      .filter((r): r is string => !!r);
    // One cell: its old and new value say more than the step alone.
    let change = `${deltaSpan(t)}${unit}`;
    if (t.cellsChanged === 1) {
      const fmt = (v: number) =>
        v.toLocaleString("en-US", { minimumFractionDigits: t.dp, maximumFractionDigits: t.dp }).replace("-", "−");
      for (let r = 0; r < t.after.length; r++) {
        const col = t.after[r].findIndex((v, j) => fmt(v) !== fmt(t.before[r][j]));
        if (col >= 0) {
          change = `${fmt(t.before[r][col])} → ${fmt(t.after[r][col])}${unit} (${deltaSpan(t)})`;
          break;
        }
      }
    }
    return `${name}: ${[change, ...where].join(" · ")}`;
  });
  return { title: `${areas.slice(0, 3).join(", ")}${areas.length > 3 ? " and more" : ""}`, items };
}

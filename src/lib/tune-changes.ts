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
  details?: TuneDetail[];
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

/** A position on one table axis, as a racer says it: "1.25 s", "knob 12", "6,500 RPM". */
function axisPoint(name: string, unit: string, value: string): string {
  if (/^trim knob \d+$/i.test(name)) return `knob ${value}`;
  if (/torque management knob/i.test(name)) return `TM knob ${value}`;
  if (/^time$/i.test(name)) return `${value} s`;
  if (/rpm$/i.test(name) && unit === "RPM") return `${value} RPM`;
  return `${name} ${value}${unit ? ` ${unit}` : ""}`;
}

/** An axis whose unit already names it: "6,250–7,750 RPM", not "RPM 6,250–7,750 RPM". */
const selfNamed = (r: AxisRange) => /^rpm$/i.test(r.name) && r.unit === "RPM";

/** "trim knob 1 12" -> "knob 12"; a single throttle value says nothing. */
function friendlyRange(r: AxisRange): string | null {
  if (/^throttle$/i.test(r.name) && r.from === r.to) return null;
  if (r.from === r.to) return axisPoint(r.name, r.unit, r.from);
  if (/^trim knob \d+$/i.test(r.name)) return `knob ${r.from}–${r.to}`;
  if (/torque management knob/i.test(r.name)) return `TM knob ${r.from}–${r.to}`;
  if (/^time$/i.test(r.name)) return `${r.from}–${r.to} s`;
  if (selfNamed(r)) return `${r.from}–${r.to} RPM`;
  return `${r.name} ${r.from}–${r.to}${r.unit ? ` ${r.unit}` : ""}`;
}

const onOff = (v: string | undefined) => (v === "Enable" ? "on" : v === "Disable" ? "off" : v);

/** One setting in a tune change, laid out for reading. */
export interface TuneDetail {
  name: string;
  /** The step: "+2.3 to +5.5 psi", "+100 RPM", or "on → off". */
  change: string;
  direction?: "up" | "down";
  /** The setting's unit, "psi", "RPM", "°". */
  unit?: string;
  /** Where on the table, for the axes the change didn't move along: "knob 12". */
  where?: string;
  /** Up to MAX_CELLS changed cells, each with its old and new value. */
  cells?: { at: string; from: string; to: string; step: string }[];
}

/** More changed cells than this read better as a range than a list. */
const MAX_CELLS = 4;

function detailOf(c: TuneChange): TuneDetail {
  const name = friendlyName(c);
  if (c.kind !== "table" || !c.table) {
    return { name, change: `${onOff(c.before)} → ${onOff(c.after)}`, direction: c.direction };
  }
  const t = c.table;
  const unit = t.unit ? ` ${t.unit}` : "";
  if (!t.cellsChanged) return { name, change: "breakpoints moved" };
  const fmt = (v: number, signed = false) =>
    `${signed && v > 0 ? "+" : ""}${v.toLocaleString("en-US", { minimumFractionDigits: t.dp, maximumFractionDigits: t.dp })}`.replace("-", "−");
  const shown = (v: number) => fmt(v);
  // The changed cells of the first changed layer, by row and column.
  const moved: { r: number; col: number }[] = [];
  t.after.forEach((row, r) => row.forEach((v, col) => {
    if (shown(v) !== shown(t.before[r][col])) moved.push({ r, col });
  }));
  const deltas = moved.map(({ r, col }) => t.after[r][col] - t.before[r][col]);
  const direction = deltas.every((d) => d > 0) ? "up" : deltas.every((d) => d < 0) ? "down" : undefined;
  const change = `${deltaSpan(t)}${unit}`;
  // An axis with one breakpoint says nothing; an axis the cells don't move
  // along is said once, as "where".
  const rowAxis = t.rows > 1 ? t.rowRange : undefined;
  const colAxis = t.cols > 1 ? t.colRange : undefined;
  const rowsVary = new Set(moved.map((m) => m.r)).size > 1;
  const colsVary = new Set(moved.map((m) => m.col)).size > 1;
  if (t.cellsChanged > MAX_CELLS || moved.length === 0) {
    const where = [rowAxis, colAxis].filter((r): r is AxisRange => !!r).map(friendlyRange).filter((r): r is string => !!r);
    return { name, change, direction, unit: t.unit || undefined, where: where.join(" · ") || undefined };
  }
  const where = [
    !rowsVary && rowAxis ? friendlyRange(rowAxis) : null,
    !colsVary && colAxis ? friendlyRange(colAxis) : null,
  ].filter((r): r is string => !!r);
  const cells = moved.map(({ r, col }) => ({
    at: [
      rowsVary && rowAxis ? axisPoint(rowAxis.name, rowAxis.unit, t.rowLabels[r]) : null,
      colsVary && colAxis ? axisPoint(colAxis.name, colAxis.unit, t.colLabels[col]) : null,
    ].filter(Boolean).join(" · "),
    from: shown(t.before[r][col]),
    to: shown(t.after[r][col]),
    step: fmt(t.after[r][col] - t.before[r][col], true),
  }));
  return { name, change, direction, unit: t.unit || undefined, where: where.join(" · ") || undefined, cells };
}

/**
 * A change-log entry for one tune change: a title naming the areas that
 * moved ("Boost, Ignition"), the settings structured for display, and the
 * same as one plain line each ("Shift point: 7,200 → 7,300 RPM (+100)").
 */
export function tuneChangeEntry(changes: TuneChange[]): { title: string; items: string[]; details: TuneDetail[] } {
  const ranked = changes
    .map((c) => ({ c, ...changeArea(c) }))
    .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));
  const areas = [...new Set(ranked.map((r) => r.area))];
  const details = ranked.map(({ c }) => detailOf(c));
  const items = details.map((d) => {
    const single = d.cells?.length === 1 && !d.cells[0].at ? d.cells[0] : null;
    const change = single ? `${single.from} → ${single.to}${d.change.replace(/^[^\s]+/, "")} (${single.step})` : d.change;
    const cells = d.cells && !single ? d.cells.map((x) => `${x.at} ${x.from} → ${x.to}`).join(", ") : null;
    return `${d.name}: ${[change, d.where, cells].filter(Boolean).join(" · ")}`;
  });
  return { title: `${areas.slice(0, 3).join(", ")}${areas.length > 3 ? " and more" : ""}`, items, details };
}

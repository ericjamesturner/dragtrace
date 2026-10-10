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

/** Names that mean nothing without the group they sit in. */
const GENERIC = /^(enable|pull up enable|.*method|type|channel \d+|condition \d+|operator \d+|number of operations)$/i;

/**
 * A setting by the name NSP shows for it, trimmed of its group's prefix —
 * unless that leaves something too short to place ("End RPM"), in which
 * case the group goes back in front. Boost Control's target is "Boost".
 */
function settingName(c: TuneChange): string {
  const leaf = c.group[c.group.length - 1];
  if (/boost control/i.test(c.group.join(" ")) && /target pressure/i.test(c.name)) return "Boost";
  const own = inGroupLabel(c.name, leaf);
  if (leaf && (GENERIC.test(own) || own.split(/\s+/).length <= 2) && !own.toLowerCase().startsWith(leaf.toLowerCase())) {
    return `${leaf} ${own}`;
  }
  return own;
}

/**
 * Shift tables key their rows by the shift: "15,152" is up from 1st to 2nd,
 * "5,352" down from 3rd to 2nd (a leading 1 for up, then 5 + each gear).
 * Checked on a 2-speed (one row, 15,152) and a 3-speed (5,251 5,352 15,152
 * 15,253). Null for anything else.
 */
function shiftOf(label: string): string | null {
  const m = /^(1?)5(\d)5(\d)$/.exec(label.replace(/,/g, ""));
  if (!m) return null;
  return m[1] ? `${m[2]}-${m[3]} shift` : `${m[2]}-${m[3]} downshift`;
}

/** A position on one table axis, as a racer says it: "1.25 s", "knob 12", "6,500 RPM". */
function axisPoint(name: string, unit: string, value: string): string {
  if (/knob/i.test(name)) return `row ${value}`;
  if (/^time$/i.test(name)) return `${value} s`;
  if (/rpm$/i.test(name) && unit === "RPM") return `${value} RPM`;
  return `${name} ${value}${unit ? ` ${unit}` : ""}`;
}

/** An axis whose unit already names it: "6,250–7,750 RPM", not "RPM 6,250–7,750 RPM". */
const selfNamed = (r: AxisRange) => /^rpm$/i.test(r.name) && r.unit === "RPM";

/** "trim knob 1 12" -> "row 12" (the knob picks the table row); a single throttle value says nothing. */
function friendlyRange(r: AxisRange): string | null {
  if (/^throttle$/i.test(r.name) && r.from === r.to) return null;
  if (r.from === r.to) return axisPoint(r.name, r.unit, r.from);
  if (/knob/i.test(r.name)) return `rows ${r.from}–${r.to}`;
  if (/^time$/i.test(r.name)) return `${r.from}–${r.to} s`;
  if (selfNamed(r)) return `${r.from}–${r.to} RPM`;
  return `${r.name} ${r.from}–${r.to}${r.unit ? ` ${r.unit}` : ""}`;
}

const onOff = (v: string | undefined) => (v === "Enable" ? "on" : v === "Disable" ? "off" : v);

/** One setting in a tune change, laid out for reading. */
export interface TuneDetail {
  name: string;
  /** The change said the way a tuner writes it down: "Added 2.3 to 5.5 psi to Boost at 1.25–1.75 s on row 12". */
  sentence?: string;
  /** The part of the sentence to make bold: "2.3 to 5.5 psi". */
  amount?: string;
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
  const name = settingName(c);
  if (c.kind !== "table" || !c.table) {
    const before = onOff(c.before);
    const after = onOff(c.after);
    if ((before === "on" || before === "off") && (after === "on" || after === "off")) {
      return { name, change: `${before} → ${after}`, sentence: `Turned ${name} ${after}`, amount: after };
    }
    return {
      name,
      change: `${before} → ${after}`,
      direction: c.direction,
      sentence: `Changed ${name} from ${before} to ${after}`,
      amount: `${after}`,
    };
  }
  const t = c.table;
  const unit = t.unit ? ` ${t.unit}` : "";
  if (!t.cellsChanged) return { name, change: "breakpoints moved", sentence: `Moved the ${name} breakpoints` };
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
  // A shift table names its rows by the shift itself.
  const shifts = !t.rowRange ? [...new Set(moved.map((m) => shiftOf(t.rowLabels[m.r])))] : [];
  const shift = shifts.length > 0 && shifts.every((x) => x) ? shifts.join(" and ") : null;
  const said = (d: TuneDetail): TuneDetail =>
    deltas.length === 0
      ? { ...d, sentence: `Changed ${name}` }
      : { ...d, ...sentenceFor(d, t, deltas, [rowAxis, colAxis].filter((r): r is AxisRange => !!r), shift) };
  if (t.cellsChanged > MAX_CELLS || moved.length === 0) {
    const where = [rowAxis, colAxis].filter((r): r is AxisRange => !!r).map(friendlyRange).filter((r): r is string => !!r);
    return said({ name, change, direction, unit: t.unit || undefined, where: where.join(" · ") || undefined });
  }
  const where = [
    !rowsVary && rowAxis ? friendlyRange(rowAxis) : null,
    !colsVary && colAxis ? friendlyRange(colAxis) : null,
  ].filter((r): r is string => !!r);
  const cells = moved.map(({ r, col }) => ({
    at: [
      rowsVary && rowAxis ? axisPoint(rowAxis.name, rowAxis.unit, t.rowLabels[r]) : null,
      rowsVary && !rowAxis ? shiftOf(t.rowLabels[r]) : null,
      colsVary && colAxis ? axisPoint(colAxis.name, colAxis.unit, t.colLabels[col]) : null,
    ].filter(Boolean).join(" · "),
    from: shown(t.before[r][col]),
    to: shown(t.after[r][col]),
    step: fmt(t.after[r][col] - t.before[r][col], true),
  }));
  return said({ name, change, direction, unit: t.unit || undefined, where: where.join(" · ") || undefined, cells });
}

/**
 * "Added 2.3 to 5.5 psi to Boost at 1.25–1.75 s on row 12": the action from
 * the direction, the size as a plain amount, then where — time and RPM as
 * "at", a knob position as the table row it picks.
 */
function sentenceFor(d: TuneDetail, t: NonNullable<TuneChange["table"]>, deltas: number[], places: AxisRange[], shift: string | null): { sentence: string; amount: string } {
  const unit = !t.unit ? "" : t.unit === "°" ? "°" : t.unit === "%" ? "%" : ` ${t.unit}`;
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: t.dp, maximumFractionDigits: t.dp });
  // Steps that round away at this precision aren't part of the size.
  const sizes = deltas.map(Math.abs).filter((v) => fmt(v) !== fmt(0));
  if (sizes.length === 0) sizes.push(...deltas.map(Math.abs));
  const lo = Math.min(...sizes);
  const hi = Math.max(...sizes);
  const span = fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
  const object = shift ? `the ${shift}` : d.name;
  const at: string[] = [];
  const rows: string[] = [];
  for (const r of places) {
    const range = r.from === r.to ? r.from : `${r.from}–${r.to}`;
    if (/knob/i.test(r.name)) rows.push(r.from === r.to ? `row ${range}` : `rows ${range}`);
    else if (/^time$/i.test(r.name)) at.push(`${range} s`);
    else if (selfNamed(r)) at.push(`${range} RPM`);
    else if (!(/^throttle$/i.test(r.name) && r.from === r.to)) at.push(`${r.name} ${range}${r.unit ? ` ${r.unit}` : ""}`);
  }
  const where = [at.length ? `at ${at.join(", ")}` : "", rows.length ? `on ${rows.join(", ")}` : ""].filter(Boolean).join(" ");
  if (d.direction === "up") {
    const amount = `${span}${unit}`;
    return { amount, sentence: `Added ${amount} to ${object}${where ? ` ${where}` : ""}` };
  }
  if (d.direction === "down") {
    const amount = `${span}${unit}`;
    return { amount, sentence: `Took ${amount} out of ${object}${where ? ` ${where}` : ""}` };
  }
  const amount = `${deltaSpan(t)}${unit}`;
  return { amount, sentence: `Changed ${object} by ${amount}${where ? ` ${where}` : ""}` };
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
  // The plain line is the sentence, with the cells' old and new values after it.
  const items = details.map((d) => {
    const cells = d.cells?.map((x) => `${x.at ? `${x.at} ` : ""}${x.from} → ${x.to}`).join(", ");
    return `${d.sentence ?? `${d.name}: ${d.change}`}${cells ? ` (${cells})` : ""}`;
  });
  return { title: `${areas.slice(0, 3).join(", ")}${areas.length > 3 ? " and more" : ""}`, items, details };
}

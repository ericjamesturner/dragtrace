/**
 * What changed between Haltech tunes, setting by setting.
 *
 * A tune is object ids and raw bytes; the definition for its ECU and firmware
 * turns each id into a named setting with a type, a unit, choice labels and —
 * for tables — a shape and two axes. Only what differs is reported, grouped the
 * way Haltech's own tree groups it, and with the values the ECU works out for
 * itself (learned trims, counters, odometers) left out: they differ between
 * any two files and say nothing about what the tuner did.
 */

import type { Tune, TuneMeta } from "./haltech-tune";
import { QUANTITIES, resolveAlternate } from "./ecu/quantities";
import type { UnitAlternate, UnitSystem } from "./ecu/types";

interface Def {
  L?: string;
  /** Bit width; negative = signed. */
  t?: string;
  /** "{layers, rows, cols}". */
  D?: string;
  /** Haltech unit type id. */
  u?: string;
  /** Choice labels by raw value. */
  e?: Record<string, string>;
  /** Children: { RowAxis: { Data, Count, Chanel, … }, ColumnAxis: …, _direct: { Data } }. */
  c?: Record<string, Record<string, number>>;
  /** Index into `groups`. */
  g?: number;
  /** Table plumbing (axis members); reported through its table. */
  x?: 1;
}

export interface TuneDefs {
  product: number;
  variant: number;
  name: string;
  version: string;
  groups: string[][];
  defs: Record<string, Def>;
  /** False when no definition for the tune's exact firmware exists. */
  exact: boolean;
}

interface DefsIndexEntry {
  product: number;
  variant: number;
  name: string;
  version: string;
  file: string;
}

const BASE = "/ecu/haltech/tune";
const defsCache = new Map<string, Promise<TuneDefs>>();

/** "01.31.03.000" -> "1.31.3". */
function normaliseVersion(v: string): string {
  return v
    .split(".")
    .slice(0, 3)
    .map((p) => String(Number(p) || 0))
    .join(".");
}
const versionNumber = (v: string) => v.split(".").reduce((acc, p) => acc * 1000 + (Number(p) || 0), 0);

/**
 * The definition for a tune: its exact firmware when published, otherwise the
 * nearest release for the same ECU model — ids rarely move between releases,
 * but the caller should say the names may be off.
 */
export async function loadTuneDefs(meta: TuneMeta): Promise<TuneDefs | null> {
  const index = (await (await fetch(`${BASE}/index.json`)).json()) as DefsIndexEntry[];
  const sameModel = index.filter((e) => e.product === meta.product && e.variant === meta.variant);
  if (sameModel.length === 0) return null;
  const want = normaliseVersion(meta.firmware);
  const exact = sameModel.find((e) => e.version === want);
  const pick =
    exact ??
    [...sameModel].sort(
      (a, b) =>
        Math.abs(versionNumber(a.version) - versionNumber(want)) -
        Math.abs(versionNumber(b.version) - versionNumber(want)),
    )[0];
  let p = defsCache.get(pick.file);
  if (!p) {
    p = fetch(`${BASE}/${pick.file}`).then(async (r) => ({ ...(await r.json()), exact: true }) as TuneDefs);
    defsCache.set(pick.file, p);
  }
  const defs = await p;
  return { ...defs, exact: !!exact };
}

// ── Decoding ──

function readValues(hex: string | undefined, type: string | undefined): number[] {
  if (!hex) return [];
  const bits = parseInt(type ?? "", 10) || 8;
  const bytes = Math.abs(bits) / 8;
  const signed = bits < 0;
  const n = Math.floor(hex.length / 2 / bytes);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let b = 0; b < bytes; b++) v = v * 256 + parseInt(hex.substr((i * bytes + b) * 2, 2), 16);
    if (signed) {
      const lim = 2 ** (Math.abs(bits) - 1);
      if (v >= lim) v -= lim * 2;
    }
    out[i] = v;
  }
  return out;
}

function dimsOf(d: string | undefined): [number, number, number] | null {
  const m = d?.match(/-?\d+/g);
  return m && m.length === 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : null;
}

/** Quantity slug for a Haltech unit type id. */
const slugByUnitType = new Map<string, string>();
for (const q of Object.values(QUANTITIES)) {
  if (q.sourceId !== undefined) slugByUnitType.set(String(q.sourceId), q.slug);
}

export interface UnitChoice {
  system: UnitSystem;
  overrides?: Record<string, string>;
}

function alternateFor(def: Def | undefined, units: UnitChoice): UnitAlternate | undefined {
  const slug = def?.u ? slugByUnitType.get(def.u) : undefined;
  return slug ? resolveAlternate(slug, units.system, units.overrides) : undefined;
}

function toDisplay(raw: number, alt: UnitAlternate | undefined): number {
  return alt ? raw * alt.scale + alt.offset : raw;
}

function formatNumber(v: number, alt: UnitAlternate | undefined): string {
  const dp = Math.min(4, alt?.dp ?? 0);
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function unitLabel(alt: UnitAlternate | undefined): string {
  const l = alt?.label?.trim();
  return l && l !== "Raw" ? l : "";
}

/** Text settings — custom names, descriptions — are NUL-padded ASCII. */
function asText(hex: string): string | null {
  if (hex.length < 4) return null;
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (c === 0) break;
    if (c < 0x20 || c > 0x7e) return null;
    out += String.fromCharCode(c);
  }
  return out.length > 0 ? out : null;
}

// ── What not to report ──

/**
 * Values the ECU keeps for itself. They differ between any two files saved at
 * different times, so reporting them would bury what the tuner changed.
 */
const RUNTIME = /odometer|hour meter|trip|running time|run time|engine hours|boot count|connection time|memory writes|learn|long term trim|accumulat|total fuel used|service (indicator|interval)|last position|time since|counter$|count$/i;

function isNoise(def: Def, groups: string[][]): boolean {
  const name = def.L ?? "";
  if (!name || name.startsWith("_")) return true;
  if (RUNTIME.test(name)) return true;
  const group = def.g !== undefined ? groups[def.g] : undefined;
  return !!group?.some((g) => /long term trim|learn/i.test(g));
}

// ── The diff ──

export interface AxisRange {
  name: string;
  unit: string;
  from: string;
  to: string;
}

export interface TableChange {
  layers: number;
  rows: number;
  cols: number;
  cells: number;
  cellsChanged: number;
  /** Change of the changed cells, in display units. */
  minDelta: number;
  maxDelta: number;
  unit: string;
  dp: number;
  /** Where on each axis the changed cells sit. */
  rowRange?: AxisRange;
  colRange?: AxisRange;
  axisChanged: boolean;
  /** For drawing: the first changed layer, before and after, in display units. */
  before: number[][];
  after: number[][];
  rowLabels: string[];
  colLabels: string[];
}

export interface TuneChange {
  id: number;
  name: string;
  group: string[];
  kind: "value" | "text" | "table";
  before?: string;
  after?: string;
  table?: TableChange;
}

/** Each axis member and data object, back to the table that owns it. */
function ownerIndex(defs: Record<string, Def>): Map<number, number> {
  const owner = new Map<number, number>();
  for (const [id, d] of Object.entries(defs)) {
    if (!d.c) continue;
    for (const members of Object.values(d.c)) {
      for (const child of Object.values(members)) owner.set(child, Number(id));
    }
  }
  return owner;
}
const ownerCache = new WeakMap<object, Map<number, number>>();

interface AxisRead {
  name: string;
  values: number[];
  labels: string[];
  unit: string;
  hex: string;
}

function readAxis(
  table: Def,
  which: "RowAxis" | "ColumnAxis",
  tune: Tune,
  defs: Record<string, Def>,
  units: UnitChoice,
): AxisRead | null {
  const m = table.c?.[which];
  if (!m || m.Data === undefined) return null;
  const dataDef = defs[m.Data];
  const raw = readValues(tune.values.get(m.Data), dataDef?.t);
  const count = m.Count !== undefined ? readValues(tune.values.get(m.Count), defs[m.Count]?.t)[0] : undefined;
  const used = count && count > 0 ? raw.slice(0, count) : raw;
  // The axis is in the units of the channel it follows.
  const channelId = m.Chanel !== undefined ? readValues(tune.values.get(m.Chanel), defs[m.Chanel]?.t)[0] : undefined;
  const channel = channelId !== undefined ? defs[channelId] : undefined;
  const alt = alternateFor(channel ?? dataDef, units);
  const values = used.map((v) => toDisplay(v, alt));
  return {
    name: channel?.L ?? (which === "RowAxis" ? "Row" : "Column"),
    values,
    labels: values.map((v) => formatNumber(v, alt)),
    unit: unitLabel(alt),
    hex: tune.values.get(m.Data) ?? "",
  };
}

function tableChange(
  table: Def,
  dataId: number,
  a: Tune,
  b: Tune,
  defs: Record<string, Def>,
  units: UnitChoice,
): TableChange | null {
  const dataDef = defs[dataId] ?? table;
  const dims = dimsOf(dataDef.D);
  if (!dims) return null;
  const [layers, rows, cols] = dims;
  const alt = alternateFor(dataDef.u ? dataDef : table, units);
  const va = readValues(a.values.get(dataId), dataDef.t).map((v) => toDisplay(v, alt));
  const vb = readValues(b.values.get(dataId), dataDef.t).map((v) => toDisplay(v, alt));

  const rowA = readAxis(table, "RowAxis", a, defs, units);
  const rowB = readAxis(table, "RowAxis", b, defs, units);
  const colA = readAxis(table, "ColumnAxis", a, defs, units);
  const colB = readAxis(table, "ColumnAxis", b, defs, units);
  const axisChanged = (rowA?.hex ?? "") !== (rowB?.hex ?? "") || (colA?.hex ?? "") !== (colB?.hex ?? "");
  const usedRows = Math.min(rows, rowB?.values.length || rows);
  const usedCols = Math.min(cols, colB?.values.length || cols);

  let changed = 0;
  let minDelta = Infinity;
  let maxDelta = -Infinity;
  let firstLayer = -1;
  let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
  for (let l = 0; l < layers; l++) {
    for (let r = 0; r < usedRows; r++) {
      for (let c = 0; c < usedCols; c++) {
        const i = l * rows * cols + r * cols + c;
        const d = (vb[i] ?? 0) - (va[i] ?? 0);
        if (Math.abs(d) < 1e-9) continue;
        changed++;
        if (d < minDelta) minDelta = d;
        if (d > maxDelta) maxDelta = d;
        if (firstLayer < 0) firstLayer = l;
        if (l === firstLayer) {
          r0 = Math.min(r0, r); r1 = Math.max(r1, r);
          c0 = Math.min(c0, c); c1 = Math.max(c1, c);
        }
      }
    }
  }
  if (changed === 0 && !axisChanged) return null;

  const layer = Math.max(0, firstLayer);
  const grid = (vals: number[]) =>
    Array.from({ length: usedRows }, (_, r) =>
      Array.from({ length: usedCols }, (_, c) => vals[layer * rows * cols + r * cols + c] ?? 0),
    );
  const range = (axis: AxisRead | null, lo: number, hi: number): AxisRange | undefined =>
    axis && hi >= 0 && axis.labels.length > hi
      ? { name: axis.name, unit: axis.unit, from: axis.labels[lo], to: axis.labels[hi] }
      : undefined;

  return {
    layers,
    rows: usedRows,
    cols: usedCols,
    cells: layers * usedRows * usedCols,
    cellsChanged: changed,
    minDelta: changed ? minDelta : 0,
    maxDelta: changed ? maxDelta : 0,
    unit: unitLabel(alt),
    dp: Math.min(4, alt?.dp ?? 0),
    rowRange: range(rowB, r0, r1),
    colRange: range(colB, c0, c1),
    axisChanged,
    before: grid(va),
    after: grid(vb),
    rowLabels: rowB?.labels ?? [],
    colLabels: colB?.labels ?? [],
  };
}

function formatScalar(hex: string | undefined, def: Def, defs: Record<string, Def>, units: UnitChoice): string {
  if (hex === undefined) return "—";
  const values = readValues(hex, def.t);
  if (values.length === 0) return "—";
  // A setting that picks a channel holds the channel's object id.
  if (!def.u && !def.e && values.length === 1 && /channel|input|source/i.test(def.L ?? "")) {
    const target = defs[values[0]];
    if (target?.L && !target.L.startsWith("_")) return target.L;
  }
  if (def.e) {
    const labels = values.map((v) => def.e![String(v)] ?? String(v));
    return labels.join(", ");
  }
  const alt = alternateFor(def, units);
  const shown = values.slice(0, 8).map((v) => formatNumber(toDisplay(v, alt), alt));
  const unit = unitLabel(alt);
  return `${shown.join(", ")}${values.length > 8 ? ", …" : ""}${unit ? ` ${unit}` : ""}`;
}

/** Every setting that differs from `a` to `b`, by Haltech group then name. */
export function diffTunes(a: Tune, b: Tune, tuneDefs: TuneDefs, units: UnitChoice): TuneChange[] {
  const { defs, groups } = tuneDefs;
  let owner = ownerCache.get(defs);
  if (!owner) {
    owner = ownerIndex(defs);
    ownerCache.set(defs, owner);
  }

  const ids = new Set<number>([...a.values.keys(), ...b.values.keys()]);
  const tablesDone = new Set<number>();
  const out: TuneChange[] = [];

  for (const id of ids) {
    if (a.values.get(id) === b.values.get(id)) continue;
    const def = defs[id];
    if (!def) continue;

    // Part of a table: report the table once.
    const tableId = owner.get(id);
    const table = tableId !== undefined ? defs[tableId] : undefined;
    if (tableId !== undefined && table?.c && !tablesDone.has(tableId)) {
      tablesDone.add(tableId);
      if (isNoise(table, groups)) continue;
      const dataId = table.c._direct?.Data;
      if (dataId === undefined) continue;
      const change = tableChange(table, dataId, a, b, defs, units);
      if (change) {
        out.push({
          id: tableId,
          name: table.L ?? `Table ${tableId}`,
          group: table.g !== undefined ? groups[table.g] : [],
          kind: "table",
          table: change,
        });
      }
      continue;
    }
    if (tableId !== undefined || def.x) continue;
    if (isNoise(def, groups)) continue;

    const ha = a.values.get(id);
    const hb = b.values.get(id);
    const group = def.g !== undefined ? groups[def.g] : [];
    const textA = !def.u && !def.e && ha ? asText(ha) : null;
    const textB = !def.u && !def.e && hb ? asText(hb) : null;
    if (textA !== null || textB !== null) {
      if ((textA ?? "") === (textB ?? "")) continue;
      out.push({ id, name: def.L!, group, kind: "text", before: textA ?? "—", after: textB ?? "—" });
      continue;
    }
    const before = formatScalar(ha, def, defs, units);
    const after = formatScalar(hb, def, defs, units);
    // Two raw encodings can display the same (rounding); not a change anyone made.
    if (before === after) continue;
    out.push({ id, name: def.L!, group, kind: "value", before, after });
  }

  const key = (c: TuneChange) => `${c.group.join("\u0000")}\u0001${c.name}`;
  return out.sort((x, y) => key(x).localeCompare(key(y)));
}

/** One line per change, for the AI summary: compact, but every number kept. */
export function describeChanges(changes: TuneChange[]): string {
  return changes
    .map((c) => {
      const where = c.group.length ? `${c.group.join(" > ")} > ` : "";
      if (c.kind !== "table" || !c.table) return `${where}${c.name}: ${c.before} -> ${c.after}`;
      const t = c.table;
      const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(t.dp)}`;
      const span = fmt(t.minDelta) === fmt(t.maxDelta) ? fmt(t.minDelta) : `${fmt(t.minDelta)} to ${fmt(t.maxDelta)}`;
      const at = [t.rowRange, t.colRange]
        .filter((r): r is AxisRange => !!r)
        .map((r) => `${r.name} ${r.from}${r.from !== r.to ? `–${r.to}` : ""}${r.unit ? ` ${r.unit}` : ""}`)
        .join(", ");
      const parts = [
        t.cellsChanged ? `${t.cellsChanged} of ${t.cells} cells changed by ${span}${t.unit ? ` ${t.unit}` : ""}` : null,
        at ? `at ${at}` : null,
        t.axisChanged ? "axis breakpoints changed" : null,
      ].filter(Boolean);
      return `${where}${c.name} (table): ${parts.join("; ")}`;
    })
    .join("\n");
}

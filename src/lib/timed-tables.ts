/**
 * The tune's timed tables — the ones looked up by Race Time — replayed
 * through the log.
 *
 * A Haltech tune holds a dozen or so tables that run off the clock from the
 * launch: the timed ignition pull, the boost ramp, the driveshaft RPM target,
 * generic outputs that fire a solenoid at 0.6 s. Some of them the ECU logs and
 * some it doesn't. Replaying a table means looking it up at every sample the
 * way the ECU does: Race Time from the log on the time axis, and the log's own
 * knob, gear or throttle reading on the other axes. That gives a line for the
 * outputs nobody logged, on the same clock as everything else.
 *
 * Everything here is in the stored (canonical) units the parser uses, so the
 * replayed lines convert for display like any logged channel.
 */

import type { ChannelDef, LogSession, ParsedLog } from "./log-types";
import { readTune, type Tune } from "./haltech-tune";
import { dimsOf, loadTuneDefs, quantityForUnitType, readValues, type Def, type TuneDefs } from "./tune-diff";
import { getQuantity, rawToCanonical } from "./ecu/quantities";
import { loadDefinitionPack } from "./ecu/definition-pack";
import { DEFAULT_ECU_TYPE } from "./ecu/registry";
import { racerLabel } from "./legend-labels";

const RACE_TIME = "Race Time";

/** Suffix on a replayed channel's name, so it never passes for a logged one. */
export const TUNE_SUFFIX = " (tune)";

interface Axis {
  /** The channel the axis follows; null when it follows none. */
  channel: string | null;
  /** Breakpoints in use, in the channel's stored units. */
  points: number[];
}

export interface TimedTable {
  id: number;
  name: string;
  /** Haltech's groups above the table, outermost first. */
  group: string[];
  quantitySlug?: string;
  /** Null when the tune has no on/off setting for the table's function. */
  enabled: boolean | null;
  dims: [number, number, number];
  /** Slice, row and column axis; null where the table has none. */
  axes: [Axis | null, Axis | null, Axis | null];
  /** Every cell, in stored units, layer by row by column. */
  data: number[];
}

/** One lane of the Timed view: a timed table, and the channel that draws it. */
export interface TimedLane {
  table: string;
  group: string[];
  /** The logged channel when the ECU logged the output, otherwise the replay. */
  channel: string;
  fromTune: boolean;
}

function readAxis(table: Def, which: "SliceAxis" | "RowAxis" | "ColumnAxis", tune: Tune, defs: Record<string, Def>): Axis | null {
  const m = table.c?.[which];
  if (!m || m.Data === undefined) return null;
  const raw = readValues(tune.values.get(m.Data), defs[m.Data]?.t);
  const count = m.Count !== undefined ? readValues(tune.values.get(m.Count), defs[m.Count]?.t)[0] : undefined;
  const used = count && count > 0 ? raw.slice(0, count) : raw;
  const channelId = m.Chanel !== undefined ? readValues(tune.values.get(m.Chanel), defs[m.Chanel]?.t)[0] : undefined;
  const channel = channelId !== undefined ? defs[channelId] : undefined;
  // The breakpoints are in the units of the channel the axis follows.
  const slug = quantityForUnitType(channel?.u ?? defs[m.Data]?.u);
  return {
    channel: channel?.L && !channel.L.startsWith("_") ? channel.L : null,
    points: used.map((v) => rawToCanonical(v, slug)),
  };
}

/**
 * Whether the table's function is switched on, from the "… Enable" setting
 * nearest to it in Haltech's tree: "Intake Air Bleed Enable" for the air
 * bleed table, "Torque Converter Enable" for the converter dump.
 */
function functionEnabled(table: Def, tuneDefs: TuneDefs, tune: Tune, byGroup: Map<number, [number, Def][]>): boolean | null {
  const { groups } = tuneDefs;
  if (table.g === undefined) return null;
  const name = table.L ?? "";
  const path = groups[table.g];
  const groupIndex = new Map(groups.map((g, i) => [g.join("\u0000"), i]));
  // Deepest group first, never as far up as "Functions" alone.
  for (let depth = path.length; depth >= 2; depth--) {
    const g = groupIndex.get(path.slice(0, depth).join("\u0000"));
    if (g === undefined) continue;
    const candidates = (byGroup.get(g) ?? []).flatMap(([id, d]) => {
      const m = /^(.+) Enable$/.exec(d.L ?? "");
      if (!m || !d.e || !Object.values(d.e).some((label) => /^disabled?$/i.test(label))) return [];
      return [{ id, def: d, subject: m[1] }];
    });
    if (candidates.length === 0) continue;
    const pick =
      // "Nitrous Stage 3 Enable" for "Nitrous Stage 3 Ignition Correction".
      candidates.filter((c) => name.startsWith(`${c.subject} `)).sort((a, b) => b.subject.length - a.subject.length)[0] ??
      // "RPM Limiter Enable" in the RPM Limiter group.
      candidates.find((c) => c.subject === path[depth - 1]) ??
      [...candidates].sort((a, b) => a.subject.length - b.subject.length)[0];
    const raw = readValues(tune.values.get(pick.id), pick.def.t)[0];
    const label = raw !== undefined ? pick.def.e![String(raw)] : undefined;
    return label === undefined ? null : !/disable/i.test(label);
  }
  return null;
}

/**
 * Whether the clock moves the table: two neighbouring cells along the time
 * axis differ somewhere in the part of the table in use. Main fuel and
 * ignition tables carry Race Time as a spare third axis with one breakpoint;
 * they change with boost and RPM, not with time.
 */
function variesWithTime(table: TimedTable): boolean {
  const timeAxis = table.axes.findIndex((a) => a?.channel === RACE_TIME);
  const [layers, rows, cols] = table.dims;
  const sizes = [layers, rows, cols];
  const used = table.axes.map((a, i) => Math.min(sizes[i], Math.max(1, a?.points.length ?? 1)));
  if (used[timeAxis] < 2) return false;
  const stride = [rows * cols, cols, 1];
  for (let l = 0; l < used[0]; l++) {
    for (let r = 0; r < used[1]; r++) {
      for (let c = 0; c < used[2]; c++) {
        const idx = [l, r, c];
        if (idx[timeAxis] === 0) continue;
        const here = l * stride[0] + r * stride[1] + c;
        if (table.data[here] !== table.data[here - stride[timeAxis]]) return true;
      }
    }
  }
  return false;
}

/** Every table in the tune that Race Time moves. */
export function readTimedTables(tune: Tune, tuneDefs: TuneDefs): TimedTable[] {
  const { defs, groups } = tuneDefs;
  const byGroup = new Map<number, [number, Def][]>();
  for (const [id, d] of Object.entries(defs)) {
    if (d.g === undefined) continue;
    const list = byGroup.get(d.g) ?? [];
    list.push([Number(id), d]);
    byGroup.set(d.g, list);
  }
  const out: TimedTable[] = [];
  for (const [id, table] of Object.entries(defs)) {
    const dataId = table.c?._direct?.Data;
    if (dataId === undefined || !table.L || table.L.startsWith("_")) continue;
    const axes: TimedTable["axes"] = [
      readAxis(table, "SliceAxis", tune, defs),
      readAxis(table, "RowAxis", tune, defs),
      readAxis(table, "ColumnAxis", tune, defs),
    ];
    if (!axes.some((a) => a?.channel === RACE_TIME)) continue;
    const dataDef = defs[dataId] ?? table;
    const dims = dimsOf(dataDef.D);
    if (!dims) continue;
    const slug = quantityForUnitType(dataDef.u ?? table.u);
    const timed: TimedTable = {
      id: Number(id),
      name: table.L.trim(),
      group: table.g !== undefined ? groups[table.g] : [],
      quantitySlug: slug,
      enabled: functionEnabled(table, tuneDefs, tune, byGroup),
      dims,
      axes,
      data: readValues(tune.values.get(dataId), dataDef.t).map((v) => rawToCanonical(v, slug)),
    };
    if (variesWithTime(timed)) out.push(timed);
  }
  return out;
}

/**
 * A channel by its Haltech name, or under the racer's own label for it, on
 * either side: "Boost (Rotary Trim Module Position 1)" from NSP's log,
 * "Rotary Trim Module Position 1 (Boost)" from its CSV export.
 */
export function findChannel(names: readonly string[], name: string): string | undefined {
  return names.find((n) => n === name) ?? names.find((n) => n.endsWith(`(${name})`) || n.startsWith(`${name} (`));
}

/** Where `v` falls on the breakpoints: the cell below it and how far towards the next. Clamped at the ends, as the ECU does. */
function locate(points: number[], v: number): [number, number] {
  const n = points.length;
  if (n <= 1 || v <= points[0]) return [0, 0];
  if (v >= points[n - 1]) return [n - 1, 0];
  let i = 0;
  while (i < n - 2 && v >= points[i + 1]) i++;
  const span = points[i + 1] - points[i];
  return [i, span > 0 ? (v - points[i]) / span : 0];
}

/**
 * The table looked up at every sample of a session, or null when the log
 * lacks a channel one of its axes needs. NaN before the launch: the clock
 * the table runs on hasn't started.
 */
export function replayTable(table: TimedTable, session: LogSession, names: readonly string[]): Float64Array | null {
  const raceTime = session.channels.get(RACE_TIME);
  if (!raceTime) return null;
  const inputs: (Float64Array | null)[] = [];
  for (const axis of table.axes) {
    if (!axis || axis.points.length <= 1) {
      inputs.push(null);
      continue;
    }
    if (axis.channel === RACE_TIME) {
      inputs.push(raceTime);
      continue;
    }
    const name = axis.channel ? findChannel(names, axis.channel) : undefined;
    const values = name ? session.channels.get(name) : undefined;
    if (!values) return null;
    inputs.push(values);
  }
  const [layers, rows, cols] = table.dims;
  const sizes = [layers, rows, cols];
  const out = new Float64Array(session.rowCount);
  const at = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  for (let i = 0; i < session.rowCount; i++) {
    if (!(raceTime[i] > 0)) {
      out[i] = NaN;
      continue;
    }
    let missing = false;
    for (let a = 0; a < 3; a++) {
      const input = inputs[a];
      const axis = table.axes[a];
      if (!input || !axis) {
        at[a][0] = 0;
        at[a][1] = 0;
        continue;
      }
      const v = input[i];
      if (v !== v) {
        missing = true;
        break;
      }
      const [cell, frac] = locate(axis.points, v);
      at[a][0] = Math.min(cell, sizes[a] - 1);
      at[a][1] = frac;
    }
    if (missing) {
      out[i] = NaN;
      continue;
    }
    // Linear between breakpoints on every axis: the up-to-eight cells around the point.
    let sum = 0;
    for (let corner = 0; corner < 8; corner++) {
      let weight = 1;
      const idx = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const up = (corner >> a) & 1;
        const [cell, frac] = at[a];
        if (up && frac === 0) {
          weight = 0;
          break;
        }
        weight *= up ? frac : 1 - frac;
        idx[a] = cell + up;
      }
      if (weight === 0) continue;
      sum += weight * (table.data[idx[0] * rows * cols + idx[1] * cols + idx[2]] ?? 0);
    }
    out[i] = sum;
  }
  return out;
}

/** Whether a line moves at all after the launch. */
function movesAfterLaunch(values: Float64Array, raceTime: Float64Array): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (!(raceTime[i] > 0)) continue;
    const v = values[i];
    if (v !== v) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo > 1e-6 * Math.max(1, Math.abs(hi), Math.abs(lo));
}

/**
 * Find the timed tables that do something on this log's passes and record
 * them as `parsed.timed`. A table the ECU logged is drawn from the log; one
 * it didn't is replayed and added as a computed channel. A table whose
 * function is switched off, or that stays flat after the launch, is left out.
 */
export function addTimedChannels(
  parsed: ParsedLog,
  tables: TimedTable[],
  /** The ECU maker's short name for a table, for the replayed line's legend. */
  shortNameOf: (table: TimedTable) => string | undefined = () => undefined,
): void {
  const names = parsed.channelDefs.map((d) => d.name);
  const lanes: TimedLane[] = [];
  for (const table of tables) {
    const lane = { table: table.name, group: table.group };
    const logged = findChannel(names, table.name);
    if (logged) {
      const moves = parsed.sessions.some((s) => {
        const raceTime = s.channels.get(RACE_TIME);
        const values = s.channels.get(logged);
        return !!raceTime && !!values && movesAfterLaunch(values, raceTime);
      });
      if (moves) lanes.push({ ...lane, channel: logged, fromTune: false });
      continue;
    }
    if (table.enabled === false) continue;
    const name = `${table.name}${TUNE_SUFFIX}`;
    let moves = false;
    let lo = Infinity;
    let hi = -Infinity;
    const replays = parsed.sessions.map((s) => {
      const values = replayTable(table, s, names);
      const raceTime = s.channels.get(RACE_TIME);
      if (!values || !raceTime) return null;
      if (movesAfterLaunch(values, raceTime)) moves = true;
      for (const v of values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return values;
    });
    if (!moves) continue;
    parsed.sessions.forEach((s, i) => {
      const values = replays[i];
      if (values) s.channels.set(name, values);
    });
    const def: ChannelDef = {
      name,
      id: -1,
      type: getQuantity(table.quantitySlug)?.name ?? "Raw",
      displayMin: lo,
      displayMax: hi,
      index: parsed.channelDefs.length,
      quantitySlug: table.quantitySlug,
      computed: true,
      shortName: replayShortName(table, names, shortNameOf),
      group: table.group,
      description: `What the tune's ${table.name} table asks for at each moment of the pass. Not logged by the ECU.`,
    };
    parsed.channelDefs.push(def);
    lanes.push({ ...lane, channel: name, fromTune: true });
  }
  parsed.timed = lanes;
}

/**
 * A replayed line's short name: the racer's label for the output when the
 * log carries one ("Nitrous Purge (Generic Output 6 Out)"), else the ECU
 * maker's short name for the table — marked as the tune's either way.
 */
function replayShortName(table: TimedTable, names: readonly string[], shortNameOf: (table: TimedTable) => string | undefined): string | undefined {
  const output = /^Generic Output \d+\b/.exec(table.name)?.[0];
  const own = output
    ? names.map(racerLabel).find((label, i) => label && names[i].includes(`${output} `))
    : undefined;
  const base = own ?? shortNameOf(table);
  return base ? `${base}${TUNE_SUFFIX}` : undefined;
}

/**
 * Read the tune a Haltech .hlgzip carries and add its timed tables to the
 * log. A file whose tune can't be read, or whose ECU has no published
 * definition, simply gets no Timed tab.
 */
export async function addTuneTimedChannels(parsed: ParsedLog, bytes: ArrayBuffer): Promise<void> {
  try {
    const tune = await readTune(bytes);
    const tuneDefs = await loadTuneDefs(tune.meta);
    if (!tuneDefs) return;
    // A tune's tables and a log's channels share the ECU's object ids.
    const pack = await loadDefinitionPack(DEFAULT_ECU_TYPE);
    addTimedChannels(parsed, readTimedTables(tune, tuneDefs), (t) => pack?.identify(t.id, t.name)?.shortName);
  } catch (e) {
    console.warn("Timed tables not read:", e);
  }
}

import type { LoadedLog } from "@/lib/viewer-types";
import { convertForDisplay, getDisplayUnit, type UnitSystem, type UnitOverrides } from "@/lib/units";

const MAX_ROWS = 500;

function fmtNum(v: number): string {
  if (!isFinite(v)) return "";
  return String(Math.round(v * 1000) / 1000); // trim float noise to ~3 decimals
}

function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV of EVERY channel in `log` over the aligned time range `range`.
 * One row per sample (downsampled to MAX_ROWS), columns = Time + each channel
 * converted to display units. Intended for pasting into an LLM.
 *
 * `offset` is the log's alignment offset, so the aligned range maps back to the
 * log's native timestamps.
 */
export function buildSelectionCsv(
  log: LoadedLog,
  range: [number, number],
  offset: number,
  unitSystem: UnitSystem,
  unitOverrides: UnitOverrides | undefined,
): string {
  const session = log.parsed.sessions[log.activeSessionIndex];
  if (!session) return "";
  const ts = session.timestamps;
  if (ts.length === 0) return "";

  const lo = Math.min(range[0], range[1]) - offset;
  const hi = Math.max(range[0], range[1]) - offset;

  // ts is ascending: find the [iStart, iEnd] sample window inside [lo, hi].
  let iStart = -1;
  let iEnd = -1;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] < lo) continue;
    if (ts[i] > hi) break;
    if (iStart === -1) iStart = i;
    iEnd = i;
  }
  if (iStart === -1) return "";

  const count = iEnd - iStart + 1;
  const step = Math.max(1, Math.ceil(count / MAX_ROWS));

  const defs = log.parsed.channelDefs;
  const header = ["Time (s)"];
  for (const d of defs) {
    const unit = d.metricUnit ? getDisplayUnit(d.metricUnit, unitSystem, unitOverrides) : "";
    header.push(csvField(unit ? `${d.name} (${unit})` : d.name));
  }
  const lines = [header.join(",")];

  for (let i = iStart; i <= iEnd; i += step) {
    const cols = [fmtNum(ts[i])];
    for (const d of defs) {
      const data = session.channels.get(d.name);
      const v = data ? data[i] : NaN;
      if (v == null || v !== v) {
        cols.push("");
        continue;
      }
      const cv = d.metricUnit ? convertForDisplay(v, d.metricUnit, unitSystem, unitOverrides) : v;
      cols.push(fmtNum(cv));
    }
    lines.push(cols.join(","));
  }

  return lines.join("\n");
}

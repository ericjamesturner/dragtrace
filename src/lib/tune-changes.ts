/**
 * Tune changes read from a car's .hlgzip uploads: a fingerprint per upload
 * (so two passes on the same tune are known equal without opening either),
 * and the settings that moved between two tunes, written for the car's
 * change log.
 */
import type { Tune } from "./haltech-tune";
import { changeArea, deltaSpan, type TuneChange } from "./tune-diff";
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

/**
 * A change-log entry for one tune change: a title naming the areas that
 * moved ("Boost, Ignition"), and one plain line per setting.
 */
export function tuneChangeEntry(changes: TuneChange[]): { title: string; items: string[] } {
  const ranked = changes
    .map((c) => ({ c, ...changeArea(c) }))
    .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));
  const areas = [...new Set(ranked.map((r) => r.area))];
  const items = ranked.map(({ c }) => {
    const name = inGroupLabel(c.name, c.group[c.group.length - 1]);
    if (c.kind !== "table" || !c.table) return `${name}: ${c.before} → ${c.after}`;
    const t = c.table;
    const unit = t.unit ? ` ${t.unit}` : "";
    const where = [t.rowRange, t.colRange]
      .filter((r) => !!r)
      .map((r) => `${r!.name} ${r!.from}${r!.from !== r!.to ? `–${r!.to}` : ""}${r!.unit ? ` ${r!.unit}` : ""}`)
      .join(", ");
    if (!t.cellsChanged) return `${name}: axis changed`;
    return `${name}: ${deltaSpan(t)}${unit}${where ? ` at ${where}` : ""}`;
  });
  return { title: `${areas.slice(0, 3).join(", ")}${areas.length > 3 ? " and more" : ""}`, items };
}

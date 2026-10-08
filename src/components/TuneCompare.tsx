import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ChevronDownIcon, ChevronRightIcon, FileUpIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { readTune, type Tune } from "@/lib/haltech-tune";
import {
  changeArea,
  describeChanges,
  diffTunes,
  loadTuneDefs,
  type AxisPoint,
  type AxisRange,
  type TableChange,
  type TuneChange,
  type TuneDefs,
  type UnitChoice,
} from "@/lib/tune-diff";
import { inGroupLabel } from "@/lib/legend-labels";
import { loadLastTune, saveLastTune } from "@/lib/tune-store";
import type { UnitSystem } from "@/lib/ecu/types";

interface LoadedTune {
  label: string;
  /** For ordering: the time in the file name, else the file's own date. */
  time: number;
  tune: Tune;
}

/** One column: a tune, and every run that was made on it. */
interface Column {
  runs: { label: string; time: number }[];
  tune: Tune;
}

/** One row: a setting, and what it was or how it moved in each column. */
interface Row {
  id: number;
  name: string;
  group: string[];
  area: string;
  rank: number;
  kind: TuneChange["kind"];
  /** Single settings: the value in each column. */
  values?: string[];
  /** Per column (index 0 is always empty): the change into that column. */
  steps: (TuneChange | undefined)[];
}

/** "2025-10-09_1042am" in a Haltech file name -> a timestamp. */
function timeFromName(name: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})([ap])m/i.exec(name);
  if (!m) return null;
  const hour = (Number(m[4]) % 12) + (m[6].toLowerCase() === "p" ? 12 : 0);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[5])).getTime();
}

/** What a racer calls the run: the name before NSP's date and log stamps. */
function runLabel(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cut = base.search(/\s*-?\s*\d{4}-\d{2}-\d{2}_\d{4}[ap]m/i);
  const short = (cut > 0 ? base.slice(0, cut) : base).replace(/[\s_-]+$/, "").trim();
  return short || base;
}

const shortDate = (t: number) =>
  new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "01.31.03.000" -> "1.31.3". */
const firmwareText = (v: string) =>
  v.split(".").slice(0, 3).map((p) => String(Number(p) || 0)).join(".");

/** "13", "0.04", "2.5" — a number without the zeros nobody says. */
const plain = (v: number, dp: number) => {
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
  return s;
};
const signed = (v: number, dp: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${plain(v, dp)}`;

/** A table's move in words: "raised 100 RPM", "lowered up to 28.2 psi". */
function tablePhrase(t: TableChange): { text: string; tone: "up" | "down" | "mixed" } {
  const unit = t.unit ? ` ${t.unit}` : "";
  const abs = (v: number) => plain(v, t.dp);
  if (t.cellsChanged === 0) return { text: "lookup points moved", tone: "mixed" };
  if (t.minDelta > 0) {
    return { text: abs(t.minDelta) === abs(t.maxDelta) ? `raised ${abs(t.maxDelta)}${unit}` : `raised up to ${abs(t.maxDelta)}${unit}`, tone: "up" };
  }
  if (t.maxDelta < 0) {
    return { text: abs(t.minDelta) === abs(t.maxDelta) ? `lowered ${abs(t.minDelta)}${unit}` : `lowered up to ${abs(t.minDelta)}${unit}`, tone: "down" };
  }
  return { text: `${signed(t.minDelta, t.dp)} to ${signed(t.maxDelta, t.dp)}${unit}`, tone: "mixed" };
}

/** Convex wraps server errors in request ids and paths; show the sentence. */
function summaryError(e: unknown): string {
  const raw = e instanceof Error ? e.message : "";
  if (/could not find public function/i.test(raw)) return "The summary isn't available on this server yet.";
  const message = raw.replace(/^\[CONVEX[^\]]*\]\s*(\[Request ID:[^\]]*\]\s*)?/i, "").replace(/^(Server Error|Uncaught Error:)\s*/i, "").split("\n")[0].trim();
  return message || "The summary couldn't be written. Try again.";
}

/** "6.5–35.0 psi": the span of a table's values before a change. */
function tableRange(t: TableChange): string {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of t.before) for (const v of row) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return "";
  const f = (v: number) => `${v < 0 ? "−" : ""}${plain(v, t.dp)}`;
  return `${f(lo)}${hi !== lo ? ` to ${f(hi)}` : ""}${t.unit ? ` ${t.unit}` : ""}`;
}

const TONE = { up: "text-sky-400", down: "text-rose-400", mixed: "text-amber-300" } as const;

const unitSuffix = (u: string) => (u ? ` ${u}` : "");

/** "from 0.75 to 2 s", "trim knob 1 at 8", "RPM 2,000 to 8,750". */
function rangePhrase(r: AxisRange): string {
  const same = r.from === r.to;
  if (r.name === "time") return same ? `at ${r.from} s` : `from ${r.from} to ${r.to} s`;
  return same ? `${r.name} at ${r.from}${unitSuffix(r.unit)}` : `${r.name} ${r.from} to ${r.to}${unitSuffix(r.unit)}`;
}

/**
 * Where on a table it changed, time first: "from 0.75 to 2 s · trim knob 1
 * at 8" for a cell, or joined with ", with" to sit inside a sentence.
 */
function wherePhrase(t: TableChange, sentence = false): string {
  return [t.rowRange, t.colRange]
    .filter((r): r is AxisRange => !!r)
    .sort((a, b) => Number(b.name === "time") - Number(a.name === "time"))
    .map(rangePhrase)
    .join(sentence ? ", with " : " · ");
}

/** "1.75 s, trim knob 1 at 8". */
function pointPhrase(points: AxisPoint[]): string {
  return [...points]
    .sort((a, b) => Number(b.name === "time") - Number(a.name === "time"))
    .map((p) => (p.name === "time" ? `${p.value} s` : `${p.name} at ${p.value}${unitSuffix(p.unit)}`))
    .join(", ");
}

type GridMode = "before" | "after" | "diff";

/**
 * The changed corner of a table — one cell of context around the change, and
 * never a wall of numbers — as the values before, after, or the difference.
 * All three views show the same cells on the same colour scale, so flicking
 * between Before and After shows only what moved.
 */
function TableGrid({ t, mode }: { t: TableChange; mode: GridMode }) {
  const still = (d: number) => Math.abs(d) < 0.5 * 10 ** -t.dp;
  let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
  t.after.forEach((row, r) =>
    row.forEach((v, c) => {
      if (still(v - t.before[r][c])) return;
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
      c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }),
  );
  if (r1 < 0) return null;
  r0 = Math.max(0, r0 - 1); r1 = Math.min(t.rows - 1, r1 + 1, r0 + 15);
  c0 = Math.max(0, c0 - 1); c1 = Math.min(t.cols - 1, c1 + 1, c0 + 15);
  const rows = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
  const cols = Array.from({ length: c1 - c0 + 1 }, (_, i) => c0 + i);

  // One scale for both Before and After, so a colour means the same value.
  let lo = Infinity, hi = -Infinity, maxDelta = 0;
  for (const r of rows) {
    for (const c of cols) {
      for (const v of [t.before[r][c], t.after[r][c]]) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      maxDelta = Math.max(maxDelta, Math.abs(t.after[r][c] - t.before[r][c]));
    }
  }
  const heat = (v: number) => {
    const k = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    // Low blue to high red, kept dim enough for white text.
    return `hsla(${Math.round(220 - 220 * k)}, 70%, 45%, 0.45)`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 font-mono text-[10px] tabular-nums">
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c} className="px-1 font-normal text-muted-foreground">{t.colLabels[c] ?? c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th className="pr-1 text-right font-normal text-muted-foreground">{t.rowLabels[r] ?? r}</th>
              {cols.map((c) => {
                const b = t.before[r][c];
                const a = t.after[r][c];
                const d = a - b;
                const moved = !still(d);
                let bg = "transparent";
                let text: React.ReactNode;
                if (mode === "diff") {
                  const k = maxDelta > 0 ? Math.abs(d) / maxDelta : 0;
                  bg = !moved ? "transparent" : d > 0 ? `rgba(56, 189, 248, ${0.15 + 0.55 * k})` : `rgba(251, 113, 133, ${0.15 + 0.55 * k})`;
                  text = moved ? signed(d, t.dp) : <span className="text-muted-foreground/40">·</span>;
                } else {
                  const v = mode === "before" ? b : a;
                  bg = heat(v);
                  text = v.toFixed(t.dp);
                }
                return (
                  <td
                    key={c}
                    title={`${b.toFixed(t.dp)} → ${a.toFixed(t.dp)}`}
                    className={`rounded-sm px-1 text-right ${moved && mode !== "diff" ? "outline outline-1 -outline-offset-1 outline-white/70" : ""}`}
                    style={{ backgroundColor: bg }}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Everything about one table change: where, the biggest move, the cells. */
function TableDetail({ change, from, to }: { change: TuneChange; from: string; to: string }) {
  const t = change.table!;
  const [mode, setMode] = useState<GridMode>("diff");
  const where = wherePhrase(t, true);
  const tabs: { mode: GridMode; label: string }[] = [
    { mode: "before", label: "Before" },
    { mode: "after", label: "After" },
    { mode: "diff", label: "Diff" },
  ];
  return (
    <div
      className="space-y-1.5 outline-none"
      tabIndex={0}
      // Space flicks between Before and After, the quickest way to see what moved.
      onKeyDown={(e) => {
        if (e.key !== " ") return;
        e.preventDefault();
        setMode((m) => (m === "before" ? "after" : "before"));
      }}
    >
      <div className="text-xs">
        <span className="text-muted-foreground">{from}</span>
        <span className="px-1.5 text-muted-foreground/60">→</span>
        <span className="font-medium">{to}</span>
      </div>
      <p className="text-sm">
        {t.cellsChanged > 0 ? `${tablePhrase(t).text[0].toUpperCase()}${tablePhrase(t).text.slice(1)}` : "The values stayed the same"}
        {where && `, ${where}`}.
        {t.axisChanged && " The points the table is looked up by moved too."}
      </p>
      {t.cellsChanged > 0 && t.largest.at.length > 0 && t.minDelta !== t.maxDelta && (
        <p className="text-sm text-muted-foreground">
          Biggest change: <span className="text-foreground">{signed(t.largest.delta, t.dp)}{unitSuffix(t.unit)}</span> at {pointPhrase(t.largest.at)}.
        </p>
      )}
      {t.cellsChanged > 0 && (
        <>
          <div className="flex items-center gap-2 pt-1">
            <div className="inline-flex rounded-md border p-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.mode}
                  type="button"
                  onClick={(e) => {
                    setMode(tab.mode);
                    // Keep focus on the panel so Space keeps working.
                    (e.currentTarget.closest("[tabindex]") as HTMLElement | null)?.focus();
                  }}
                  className={`cursor-pointer rounded px-2.5 py-0.5 text-xs ${mode === tab.mode ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">Space switches Before / After</span>
          </div>
          <TableGrid t={t} mode={mode} />
        </>
      )}
    </div>
  );
}

function SummaryText({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-•]\s/.test(l)).map((l) => l.replace(/^[-•]\s+/, ""));
  const prose = lines.filter((l) => !/^[-•]\s/.test(l));
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {prose.map((p, i) => <p key={i}>{p}</p>)}
      {bullets.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
          {bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * Drop in Haltech .hlgzip files and see what changed in the tune between
 * them, as one table: a column per tune in the order they were saved, a row
 * per setting that changed, each cell in plain words. One file is compared
 * with the last tune this browser saw from the same ECU. Tunes are read here
 * and never uploaded; only the list of changes is sent for the AI summary.
 */
export function TuneCompare() {
  const prefs = useQuery(api.userPreferences.get);
  const summarize = useAction(api.tuneSummary.summarize);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tunes, setTunes] = useState<LoadedTune[]>([]);
  const [defs, setDefs] = useState<TuneDefs | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [area, setArea] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<{ key?: string; text?: string; error?: string; busy?: boolean }>({});

  const units: UnitChoice = useMemo(() => {
    let overrides: Record<string, string> | undefined;
    try {
      overrides = prefs?.unitOverrides ? JSON.parse(prefs.unitOverrides) : undefined;
    } catch {
      overrides = undefined;
    }
    return { system: (prefs?.unitSystem as UnitSystem | undefined) ?? "imperial", overrides };
  }, [prefs]);

  const open = useCallback(async (files: File[]) => {
    setLoading(true);
    setError(null);
    setNote(null);
    setArea(null);
    setExpanded(new Set());
    try {
      const loaded: LoadedTune[] = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          const tune = await readTune(await file.arrayBuffer());
          loaded.push({ label: runLabel(file.name), time: timeFromName(file.name) ?? file.lastModified, tune });
        } catch (e) {
          failed.push(`${file.name}: ${e instanceof Error ? e.message : "could not be read"}`);
        }
      }
      if (loaded.length === 0) throw new Error(failed.join("\n") || "No tunes found in those files.");
      const models = new Set(loaded.map((t) => `${t.tune.meta.product}/${t.tune.meta.variant}`));
      if (models.size > 1) throw new Error("These files come from different ECU models, so their settings can't be compared.");
      loaded.sort((a, b) => a.time - b.time);

      const first = loaded[0].tune.meta;
      const d = await loadTuneDefs(first);
      if (!d) throw new Error("DragTrace doesn't have the settings list for this ECU yet.");

      // One file: compare with the last tune this browser saw from the ECU.
      if (loaded.length === 1) {
        const last = await loadLastTune(first.serial);
        if (last) loaded.unshift({ label: `${last.label} (last seen)`, time: last.savedAt, tune: last.tune });
        else setNote("This is the first tune DragTrace has seen from this ECU in this browser. It's saved now — open the next one to see what changed.");
      }
      const serials = new Set(loaded.map((t) => t.tune.meta.serial));
      const newest = loaded[loaded.length - 1];
      if (serials.size === 1) void saveLastTune(newest.label, newest.tune);
      else setNote("These files come from more than one ECU of the same model, so some differences may be between the cars rather than tune edits.");
      if (failed.length) setError(`Skipped:\n${failed.join("\n")}`);
      setDefs(d);
      setTunes(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Those files could not be read.");
      setTunes([]);
      setDefs(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Runs on the same tune share a column; each column is diffed with the last.
  const { columns, steps } = useMemo(() => {
    const columns: Column[] = [];
    const steps: TuneChange[][] = [];
    if (!defs) return { columns, steps };
    for (const t of tunes) {
      const prev = columns[columns.length - 1];
      const diff = prev ? diffTunes(prev.tune, t.tune, defs, units) : [];
      if (prev && diff.length === 0) {
        prev.runs.push({ label: t.label, time: t.time });
        continue;
      }
      if (prev) steps.push(diff);
      columns.push({ runs: [{ label: t.label, time: t.time }], tune: t.tune });
    }
    return { columns, steps };
  }, [tunes, defs, units]);

  const rows = useMemo(() => {
    const byId = new Map<number, Row>();
    steps.forEach((changes, s) => {
      for (const c of changes) {
        let row = byId.get(c.id);
        if (!row) {
          const { area, rank } = changeArea(c);
          const leaf = c.group[c.group.length - 1];
          row = { id: c.id, name: inGroupLabel(c.name, leaf), group: c.group, area, rank, kind: c.kind, steps: new Array(columns.length).fill(undefined) };
          byId.set(c.id, row);
        }
        row.steps[s + 1] = c;
      }
    });
    // A single setting reads as its value in every column: before its first
    // change it held that change's "before", after each change its "after".
    for (const row of byId.values()) {
      if (row.kind === "table") continue;
      const values: string[] = [];
      let current = row.steps.find((c) => c)?.before ?? "—";
      for (let j = 0; j < columns.length; j++) {
        if (row.steps[j]) current = row.steps[j]!.after ?? current;
        values.push(current);
      }
      row.values = values;
    }
    return [...byId.values()].sort(
      (a, b) => a.rank - b.rank || a.group.join("\u0000").localeCompare(b.group.join("\u0000")) || a.name.localeCompare(b.name),
    );
  }, [steps, columns.length]);

  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
    return [...counts];
  }, [rows]);
  const shown = area ? rows.filter((r) => r.area === area) : rows;

  const meta = tunes[0]?.tune.meta;
  const colName = (c: Column) => c.runs.map((r) => r.label).join(" · ");

  // The summary writes itself once the comparison is ready; the same
  // comparison opened again is answered from the saved copy.
  const summaryInput = useMemo(() => {
    if (rows.length === 0) return null;
    return {
      car: meta?.profileName || "Car",
      steps: steps.map((changes, s) => ({
        from: colName(columns[s]),
        to: colName(columns[s + 1]),
        changes: describeChanges(changes),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, columns, rows.length, meta?.profileName]);
  const summaryKey = summaryInput ? JSON.stringify(summaryInput) : null;
  useEffect(() => {
    if (!summaryInput || !summaryKey || summary.key === summaryKey) return;
    setSummary({ key: summaryKey, busy: true });
    summarize(summaryInput)
      .then((text) => setSummary((s) => (s.key === summaryKey ? { key: summaryKey, text } : s)))
      .catch((e) =>
        setSummary((s) =>
          s.key === summaryKey ? { key: summaryKey, error: summaryError(e) } : s,
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryKey]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  let lastArea: string | null = null;

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">Compare tunes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop Haltech .hlgzip files to see what changed in the tune between them. The files are read in your browser and never uploaded.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = [...e.dataTransfer.files];
          if (files.length) void open(files);
        }}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left text-sm transition-colors ${
          dragging ? "border-primary bg-primary/5" : "hover:bg-muted/40"
        }`}
      >
        {loading ? <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" /> : <FileUpIcon className="size-5 text-muted-foreground" />}
        <span className="flex-1">{loading ? "Reading tunes…" : "Drop .hlgzip files here, or click to choose"}</span>
        <span className="text-xs text-muted-foreground">One file compares with the last tune seen from that ECU</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".hlgzip,.nexmap"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void open(files);
        }}
      />

      {error && <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</pre>}

      {meta && defs && (
        <div className="space-y-1 text-sm">
          <div>
            <span className="font-medium">{meta.profileName || "Tune"}</span>
            <span className="text-muted-foreground">
              {" "}· {defs.name} {firmwareText(meta.firmware)} · {tunes.length} file{tunes.length === 1 ? "" : "s"}, {columns.length} different tune{columns.length === 1 ? "" : "s"}
            </span>
          </div>
          {!defs.exact && (
            <p className="text-xs text-amber-400/90">
              No settings list for firmware {firmwareText(meta.firmware)}; using {defs.version}. A few setting names may be wrong.
            </p>
          )}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
      )}

      {columns.length === 1 && tunes.length > 1 && (
        <p className="text-sm text-muted-foreground">All {tunes.length} files have the same tune.</p>
      )}

      {rows.length > 0 && (
        <>
          <section className="rounded-lg border bg-muted/20 px-4 py-3">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              <SparklesIcon className="size-4 text-primary" />
              What changed
              {summary.busy && <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />}
            </div>
            {summary.text && <SummaryText text={summary.text} />}
            {summary.busy && <p className="text-sm text-muted-foreground">Reading the changes…</p>}
            {summary.error && <p className="text-xs text-destructive">{summary.error}</p>}
          </section>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setArea(null)}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${area === null ? "border-primary/60 bg-primary/10" : "hover:bg-muted"}`}
            >
              All {rows.length}
            </button>
            {areas.map(([a, n]) => (
              <button
                key={a}
                type="button"
                onClick={() => setArea(area === a ? null : a)}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${area === a ? "border-primary/60 bg-primary/10" : "hover:bg-muted"}`}
              >
                {a} <span className="text-muted-foreground">{n}</span>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left align-bottom">
                  <th className="sticky left-0 z-10 min-w-64 bg-background/95 px-3 py-2 text-xs font-medium text-muted-foreground">Setting</th>
                  {columns.map((c, j) => (
                    <th key={j} className="min-w-40 px-3 py-2 font-normal">
                      <Tip content={c.runs.map((r) => `${r.label} — ${shortDate(r.time)}`).join("\n")}>
                        <div className="max-w-56">
                          {j === 0 && <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Starting tune</div>}
                          <div className="truncate text-sm font-medium">{c.runs[c.runs.length - 1].label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {shortDate(c.runs[0].time)}
                            {c.runs.length > 1 && ` · ${c.runs.length} runs on this tune`}
                          </div>
                        </div>
                      </Tip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const header = row.area !== lastArea;
                  lastArea = row.area;
                  const isOpen = expanded.has(row.id);
                  return (
                    <Fragment key={row.id}>
                      {header && (
                        <tr className="border-t">
                          <td colSpan={columns.length + 1} className="sticky left-0 bg-background px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {row.area}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-border/40 align-top hover:bg-muted/20">
                        <td className="sticky left-0 z-10 bg-background/95 px-3 py-1.5">
                          <button
                            type="button"
                            disabled={row.kind !== "table"}
                            onClick={() => toggle(row.id)}
                            className="flex items-start gap-1 text-left enabled:cursor-pointer"
                          >
                            {row.kind === "table" &&
                              (isOpen ? <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />)}
                            <span>
                              <span className="block">{row.name}</span>
                              {row.group.length > 0 && <span className="block text-[11px] text-muted-foreground">{row.group.slice(-1)[0]}</span>}
                            </span>
                          </button>
                        </td>
                        {columns.map((_, j) => {
                          if (row.kind !== "table") {
                            const changedHere = !!row.steps[j];
                            const dir = row.steps[j]?.direction;
                            return (
                              <td key={j} className={`px-3 py-1.5 font-mono text-xs ${changedHere ? `font-semibold ${dir ? TONE[dir] : "text-foreground"}` : "text-muted-foreground/60"}`}>
                                {changedHere && dir && <span className="mr-1">{dir === "up" ? "▲" : "▼"}</span>}
                                {row.values?.[j]}
                              </td>
                            );
                          }
                          const c = row.steps[j];
                          if (j === 0) {
                            // Where the table started: its range before the first change.
                            const first = row.steps.find((s) => s?.table)?.table;
                            return (
                              <td key={j} className="px-3 py-1.5 font-mono text-xs text-muted-foreground/70">
                                {first ? tableRange(first) : ""}
                              </td>
                            );
                          }
                          if (!c?.table) return <td key={j} className="px-3 py-1.5 text-xs text-muted-foreground/40">·</td>;
                          const p = tablePhrase(c.table);
                          return (
                            <td key={j} className="px-3 py-1.5 text-xs">
                              <button type="button" onClick={() => toggle(row.id)} className={`cursor-pointer text-left font-medium ${TONE[p.tone]}`}>
                                {p.text}
                              </button>
                              <div className="text-[11px] text-muted-foreground">{wherePhrase(c.table)}</div>
                            </td>
                          );
                        })}
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/10">
                          <td colSpan={columns.length + 1} className="px-3 py-2">
                            <div className="sticky left-3 max-w-[calc(100vw-22rem)] space-y-4 pl-4">
                              {row.steps.map((c, j) =>
                                c?.table ? (
                                  <TableDetail key={j} change={c} from={colName(columns[j - 1])} to={colName(columns[j])} />
                                ) : null,
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

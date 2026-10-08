import { useCallback, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, ChevronRightIcon, FileUpIcon, LoaderCircleIcon, SparklesIcon, XIcon } from "lucide-react";
import { readTune, type Tune } from "@/lib/haltech-tune";
import {
  describeChanges,
  diffTunes,
  loadTuneDefs,
  type TableChange,
  type TuneChange,
  type TuneDefs,
  type UnitChoice,
} from "@/lib/tune-diff";
import { loadLastTune, saveLastTune } from "@/lib/tune-store";
import type { UnitSystem } from "@/lib/ecu/types";

interface LoadedTune {
  label: string;
  /** For ordering: the time in the file name, else the file's own date. */
  time: number;
  tune: Tune;
}

interface Step {
  from: string;
  to: string;
  changes: TuneChange[];
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

const fmtDelta = (v: number, dp: number) => `${v > 0 ? "+" : ""}${v.toFixed(dp)}`;

/** The changed corner of a table, cells tinted by how far they moved. */
function TableDelta({ t }: { t: TableChange }) {
  let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1, max = 0;
  t.after.forEach((row, r) =>
    row.forEach((v, c) => {
      const d = v - t.before[r][c];
      if (Math.abs(d) < 1e-9) return;
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
      c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      max = Math.max(max, Math.abs(d));
    }),
  );
  if (r1 < 0) return null;
  // One cell of context around the change, and never a wall of numbers.
  r0 = Math.max(0, r0 - 1); r1 = Math.min(t.rows - 1, r1 + 1, r0 + 15);
  c0 = Math.max(0, c0 - 1); c1 = Math.min(t.cols - 1, c1 + 1, c0 + 15);
  const rows = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
  const cols = Array.from({ length: c1 - c0 + 1 }, (_, i) => c0 + i);

  return (
    <div className="mt-2 overflow-x-auto">
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
                const d = t.after[r][c] - t.before[r][c];
                const k = max > 0 ? Math.abs(d) / max : 0;
                const bg = Math.abs(d) < 1e-9
                  ? "transparent"
                  : d > 0 ? `rgba(56, 189, 248, ${0.15 + 0.55 * k})` : `rgba(251, 113, 133, ${0.15 + 0.55 * k})`;
                return (
                  <td
                    key={c}
                    title={`${t.before[r][c].toFixed(t.dp)} → ${t.after[r][c].toFixed(t.dp)}`}
                    className="rounded-sm px-1 text-right"
                    style={{ backgroundColor: bg }}
                  >
                    {Math.abs(d) < 1e-9 ? <span className="text-muted-foreground/40">·</span> : fmtDelta(d, t.dp)}
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

function ChangeRow({ c }: { c: TuneChange }) {
  const [open, setOpen] = useState(false);
  if (c.kind !== "table" || !c.table) {
    return (
      <div className="flex items-baseline gap-3 py-1 text-sm">
        <span className="min-w-0 flex-1">{c.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{c.before}</span>
        <span className="text-muted-foreground/60">→</span>
        <span className="font-mono text-xs">{c.after}</span>
      </div>
    );
  }
  const t = c.table;
  const span =
    fmtDelta(t.minDelta, t.dp) === fmtDelta(t.maxDelta, t.dp)
      ? fmtDelta(t.minDelta, t.dp)
      : `${fmtDelta(t.minDelta, t.dp)} to ${fmtDelta(t.maxDelta, t.dp)}`;
  const where = [t.rowRange, t.colRange]
    .filter(Boolean)
    .map((r) => `${r!.name} ${r!.from}${r!.from !== r!.to ? `–${r!.to}` : ""}`)
    .join(" · ");
  return (
    <div className="py-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-baseline gap-3 text-left text-sm">
        {open ? <ChevronDownIcon className="size-3.5 shrink-0 self-center text-muted-foreground" /> : <ChevronRightIcon className="size-3.5 shrink-0 self-center text-muted-foreground" />}
        <span className="min-w-0 flex-1">{c.name}</span>
        {t.cellsChanged > 0 && (
          <span className="font-mono text-xs">
            {span}
            {t.unit ? ` ${t.unit}` : ""}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {t.cellsChanged > 0 ? `${t.cellsChanged} of ${t.cells} cells` : "axis only"}
        </span>
      </button>
      <div className="pl-5.5 text-xs text-muted-foreground">
        {where}
        {t.axisChanged ? `${where ? " · " : ""}axis breakpoints changed` : ""}
      </div>
      {open && <div className="pl-5.5"><TableDelta t={t} /></div>}
    </div>
  );
}

function StepView({ step, defaultOpen }: { step: Step; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const groups = useMemo(() => {
    const map = new Map<string, TuneChange[]>();
    for (const c of step.changes) {
      const key = c.group.join(" › ") || "Other";
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map];
  }, [step.changes]);

  return (
    <section className="rounded-lg border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDownIcon className="size-4 text-muted-foreground" /> : <ChevronRightIcon className="size-4 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted-foreground">{step.from}</span>
          <span className="px-2 text-muted-foreground/60">→</span>
          <span className="font-medium">{step.to}</span>
        </span>
        <span className={`text-xs ${step.changes.length ? "text-foreground" : "text-muted-foreground"}`}>
          {step.changes.length === 0 ? "No changes" : `${step.changes.length} change${step.changes.length === 1 ? "" : "s"}`}
        </span>
      </button>
      {open && step.changes.length > 0 && (
        <div className="space-y-3 border-t px-4 py-3">
          {groups.map(([group, changes]) => (
            <div key={group}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
              <div className="divide-y divide-border/40">
                {changes.map((c) => <ChangeRow key={c.id} c={c} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Drop in Haltech .hlgzip files and see what changed in the tune between
 * them — each file against the one before it, in the order they were saved.
 * One file is compared with the last tune this browser saw from the same ECU.
 * Tunes are read here and never uploaded; only the list of changes is sent
 * for the AI summary, and only when asked.
 */
export function TuneCompare() {
  const prefs = useQuery(api.userPreferences.get);
  const summarize = useAction(api.tuneSummary.summarize);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tunes, setTunes] = useState<LoadedTune[]>([]);
  const [defs, setDefs] = useState<TuneDefs | null>(null);
  const [baselineNote, setBaselineNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState<{ text?: string; error?: string; busy?: boolean }>({});

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
    setSummary({});
    setBaselineNote(null);
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
      const serials = new Set(loaded.map((t) => t.tune.meta.serial));
      const models = new Set(loaded.map((t) => `${t.tune.meta.product}/${t.tune.meta.variant}`));
      if (models.size > 1) throw new Error("These files come from different ECU models, so their settings can't be compared.");
      loaded.sort((a, b) => a.time - b.time);

      const first = loaded[0].tune.meta;
      const d = await loadTuneDefs(first);
      if (!d) throw new Error("DragTrace doesn't have the settings list for this ECU yet.");

      // One file: compare with the last tune this browser saw from the ECU.
      if (loaded.length === 1) {
        const last = await loadLastTune(first.serial);
        if (last) {
          loaded.unshift({ label: `${last.label} (last seen)`, time: last.savedAt, tune: last.tune });
        } else {
          setBaselineNote("This is the first tune DragTrace has seen from this ECU in this browser. It is saved now — open the next one to see what changed.");
        }
      }
      const newest = loaded[loaded.length - 1];
      if (serials.size === 1) void saveLastTune(newest.label, newest.tune);
      if (serials.size > 1) {
        setBaselineNote("These files come from more than one ECU of the same model. The changes may include differences between the cars, not only tune edits.");
      }
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

  const steps: Step[] = useMemo(() => {
    if (!defs || tunes.length < 2) return [];
    return tunes.slice(1).map((t, i) => ({
      from: tunes[i].label,
      to: t.label,
      changes: diffTunes(tunes[i].tune, t.tune, defs, units),
    }));
  }, [tunes, defs, units]);

  const totalChanges = steps.reduce((n, s) => n + s.changes.length, 0);
  const meta = tunes[0]?.tune.meta;

  const runSummary = async () => {
    setSummary({ busy: true });
    try {
      const text = await summarize({
        car: meta?.profileName || "Car",
        steps: steps.map((s) => ({ from: s.from, to: s.to, changes: describeChanges(s.changes) })),
      });
      setSummary({ text });
    } catch (e) {
      setSummary({ error: e instanceof Error ? e.message : "The summary failed. Try again." });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">Compare tunes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop Haltech .hlgzip files to see what changed in the tune between them, in the order they were saved.
          The files are read in your browser and never uploaded.
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
        className={`flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-8 text-sm transition-colors ${
          dragging ? "border-primary bg-primary/5" : "hover:bg-muted/40"
        }`}
      >
        {loading ? <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" /> : <FileUpIcon className="size-5 text-muted-foreground" />}
        <span>{loading ? "Reading tunes…" : "Drop .hlgzip files here, or click to choose"}</span>
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
            <span className="text-muted-foreground"> · {defs.name} {meta.firmware.replace(/^0+/, "").replace(/\.0+(\d)/g, ".$1")} · {tunes.length} tune{tunes.length === 1 ? "" : "s"}</span>
          </div>
          {!defs.exact && (
            <p className="text-xs text-amber-400/90">
              No settings list for this exact firmware; using {defs.version}. A few setting names may be wrong.
            </p>
          )}
          {baselineNote && <p className="text-xs text-muted-foreground">{baselineNote}</p>}
        </div>
      )}

      {steps.length > 0 && (
        <>
          {totalChanges > 0 && (
            <section className="rounded-lg border bg-muted/20 px-4 py-3">
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary" />
                <span className="flex-1 text-sm font-medium">Summary</span>
                {!summary.text && (
                  <Button size="sm" variant="outline" disabled={summary.busy} onClick={() => void runSummary()}>
                    {summary.busy ? <LoaderCircleIcon className="mr-1 size-3.5 animate-spin" /> : null}
                    {summary.busy ? "Writing…" : "Summarize the changes"}
                  </Button>
                )}
                {summary.text && (
                  <button type="button" onClick={() => setSummary({})} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Clear summary">
                    <XIcon className="size-4" />
                  </button>
                )}
              </div>
              {summary.text && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{summary.text}</p>}
              {summary.error && <p className="mt-2 text-xs text-destructive">{summary.error}</p>}
              {!summary.text && !summary.error && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sends only the list of changed settings — never the tune files.
                </p>
              )}
            </section>
          )}
          <div className="space-y-2">
            {steps.map((s, i) => (
              <StepView key={`${s.from}-${s.to}-${i}`} step={s} defaultOpen={s.changes.length > 0 && s.changes.length <= 30} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

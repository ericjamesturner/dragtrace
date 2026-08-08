import { useMemo } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { parsePreview, raceWindow, sparklinePath } from "@/lib/preview";
import { PlusIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";

/**
 * A run's outcome in one word. Only `aborted` is derived today — it needs no
 * judgement, just the absence of a recorded ET. The rest (shake, fuel, clean)
 * wait on someone deciding what the thresholds are; the type and the styling
 * are here so adding them is a one-line change.
 */
export type PassOutcome = "clean" | "shake" | "fuel" | "aborted";

const OUTCOME_STYLE: Record<PassOutcome, { label: string; text: string; stroke: string }> = {
  clean: { label: "CLEAN", text: "text-emerald-400", stroke: "stroke-emerald-400" },
  shake: { label: "SHAKE", text: "text-amber-400", stroke: "stroke-amber-400" },
  fuel: { label: "FUEL", text: "text-red-400", stroke: "stroke-red-400" },
  aborted: { label: "ABORT", text: "text-muted-foreground", stroke: "stroke-muted-foreground" },
};

const SPARK_W = 280;
const SPARK_H = 44;

export interface PassCardProps {
  file: Doc<"files">;
  timeslip?: Doc<"timeslips">;
  loaded: boolean;
  active: boolean;
  /** The only pass on the chart — unloading it would leave nothing to draw. */
  isOnlyLoaded?: boolean;
  /** Selected, but its data is still being fetched and parsed. */
  isPending?: boolean;
  onToggle: () => void;
}

export function PassCard({ file, timeslip, loaded, active, isOnlyLoaded, isPending, onToggle }: PassCardProps) {
  const preview = useMemo(() => parsePreview(file.preview), [file.preview]);

  const path = useMemo(() => {
    if (!preview) return "";
    return sparklinePath(raceWindow(preview), SPARK_W, SPARK_H);
  }, [preview]);

  // A run with no elapsed time recorded didn't finish. That's a fact, not a
  // threshold, so it's the one outcome we're willing to state.
  const outcome: PassOutcome | null =
    timeslip && timeslip.et === undefined ? "aborted" : null;
  const style = outcome ? OUTCOME_STYLE[outcome] : null;

  const runLength =
    preview?.raceStart != null && preview.raceEnd != null
      ? preview.raceEnd - preview.raceStart
      : preview?.logDuration ?? null;

  const name = file.fileName.replace(/\.[^.]+$/, "");

  const stats: { label: string; value: string }[] = [];
  if (timeslip?.sixtyFt !== undefined) stats.push({ label: "60ft", value: timeslip.sixtyFt.toFixed(3) });
  if (timeslip?.eighthEt !== undefined) stats.push({ label: "1/8", value: timeslip.eighthEt.toFixed(3) });
  if (timeslip?.et !== undefined) stats.push({ label: "1/4", value: timeslip.et.toFixed(3) });
  if (timeslip?.mph !== undefined) stats.push({ label: "mph", value: timeslip.mph.toFixed(2) });

  return (
    <div
      onClick={isOnlyLoaded ? undefined : onToggle}
      title={isOnlyLoaded ? "The only pass on the chart — add another before removing this one" : undefined}
      className={`group relative rounded-lg border p-3 transition-colors ${
        isOnlyLoaded ? "cursor-default" : "cursor-pointer"
      } ${
        active ? "border-primary/60 bg-muted/40" : "border-border hover:bg-muted/30"
      } ${outcome === "aborted" ? "opacity-60" : ""}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <span className="shrink-0 text-lg font-semibold tabular-nums">
          {timeslip?.et !== undefined ? timeslip.et.toFixed(3) : "—"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className="my-2 h-11 w-full"
        aria-hidden
      >
        {path ? (
          <path
            d={path}
            fill="none"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            className={style?.stroke ?? "stroke-sky-400"}
          />
        ) : null}
      </svg>

      <div className="flex items-end gap-2 text-xs text-muted-foreground">
        {outcome === "aborted" && runLength !== null ? (
          <span className="min-w-0 flex-1 truncate tabular-nums">
            aborted at {runLength.toFixed(1)} s
          </span>
        ) : (
          // The numbers that say what the pass actually was, labelled so they
          // can't be mistaken for each other. Only what the slip recorded is
          // shown, so a partial pass doesn't invent an eighth or a trap speed.
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            {stats.map((s) => (
              <span key={s.label} className="whitespace-nowrap">
                <span className="text-muted-foreground/60">{s.label} </span>
                <span className="tabular-nums text-foreground/80">{s.value}</span>
              </span>
            ))}
          </span>
        )}
        {style && <span className={`shrink-0 font-medium ${style.text}`}>{style.label}</span>}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!isOnlyLoaded) onToggle();
        }}
        disabled={isOnlyLoaded}
        title={
          isOnlyLoaded
            ? "The only pass on the chart — add another before removing this one"
            : loaded
              ? "Remove from chart"
              : "Add to chart"
        }
        className={`absolute right-2 top-2 rounded p-1 transition-opacity ${
          loaded
            ? "text-primary opacity-100"
            : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
        }`}
      >
        {loaded ? <CheckIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
      </button>

      {isPending && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/85 backdrop-blur-[1px] ring-2 ring-inset ring-sky-500/60">
          <LoaderCircleIcon className="size-9 animate-spin text-sky-400" />
          <span className="text-sm font-semibold uppercase tracking-wider text-sky-400">
            Loading
          </span>
        </div>
      )}
    </div>
  );
}

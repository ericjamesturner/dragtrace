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

  return (
    <div
      onClick={isOnlyLoaded ? undefined : onToggle}
      title={isOnlyLoaded ? "The only pass on the chart — add another before removing this one" : undefined}
      className={`group relative rounded-lg border p-3 transition-colors ${
        isOnlyLoaded ? "cursor-default" : "cursor-pointer"
      } ${
        active ? "border-primary/60 bg-muted/40" : "border-border hover:bg-muted/30"
      } ${outcome === "aborted" ? "opacity-60" : ""} ${isPending ? "animate-pulse" : ""}`}
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

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate tabular-nums">
          {outcome === "aborted" && runLength !== null
            ? `aborted at ${runLength.toFixed(1)} s`
            : [
                timeslip?.sixtyFt !== undefined ? `60ft ${timeslip.sixtyFt.toFixed(3)}` : null,
                timeslip?.mph !== undefined ? `${timeslip.mph.toFixed(2)} mph` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
        {style && <span className={`shrink-0 font-medium ${style.text}`}>{style.label}</span>}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!isOnlyLoaded) onToggle();
        }}
        disabled={isOnlyLoaded}
        title={
          isPending
            ? "Loading this pass…"
            : isOnlyLoaded
              ? "The only pass on the chart — add another before removing this one"
              : loaded
                ? "Remove from chart"
                : "Add to chart"
        }
        className={`absolute right-2 top-2 rounded p-1 transition-opacity ${
          isPending
            ? "text-muted-foreground opacity-100"
            : loaded
              ? "text-primary opacity-100"
              : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
        }`}
      >
        {isPending ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : loaded ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <PlusIcon className="size-3.5" />
        )}
      </button>
    </div>
  );
}

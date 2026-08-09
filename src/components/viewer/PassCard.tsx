import { useMemo } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { sparklinePath, type RaceSeries } from "@/lib/preview";
import { PlusIcon, CheckIcon, LoaderCircleIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { LogNotes } from "./LogNotes";
import { Button } from "@/components/ui/button";

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
  /** The run's shape, parsed once by the list. */
  series?: RaceSeries | null;
  /** Time axis shared by every card, so runs are drawn to one scale. */
  spanSeconds?: number;
  /** Loaded, but currently not drawn on the chart. */
  chartHidden?: boolean;
  onToggleVisibility?: () => void;
  /** Seconds from the window start to the launch, for the start marker. */
  leadInSeconds?: number;
  onToggle: () => void;
  /** Given instead of the toggle: show this pass alone, or over what's loaded.
   *  Two verbs beat one checkbox when the card is somewhere you go to choose. */
  onOpen?: () => void;
  onCompare?: () => void;
}

export function PassCard({ file, timeslip, loaded, active, isOnlyLoaded, isPending, series, spanSeconds, chartHidden, onToggleVisibility, leadInSeconds = 1, onToggle, onOpen, onCompare }: PassCardProps) {
  // Three lines tell you what the run did: engine speed, what the driver asked
  // for, and what reached the ground. Each is scaled to its own range, since
  // they share no units — the shapes are the point, not the values.
  const paths = useMemo(() => {
    if (!series) return [];
    const span = spanSeconds ?? series.duration;
    const draw = (values: (number | null)[] | null) =>
      sparklinePath(series.times, values, span, SPARK_W, SPARK_H);
    // The same colours these channels get on a trace, so a card and a chart
    // agree about which line is which.
    return [
      { key: "dsRpm", d: draw(series.dsRpm), className: "stroke-blue-500", width: 1 },
      { key: "tps", d: draw(series.tps), className: "stroke-green-500", width: 1 },
      { key: "rpm", d: draw(series.rpm), className: "stroke-red-500", width: 1.5 },
    ].filter((p) => p.d);
  }, [series, spanSeconds]);

  // Where the launch sits on the shared axis — the same x on every card.
  const launchX = spanSeconds && spanSeconds > 0 ? (leadInSeconds / spanSeconds) * SPARK_W : null;

  // A run with no elapsed time recorded didn't finish. That's a fact, not a
  // threshold, so it's the one outcome we're willing to state.
  const outcome: PassOutcome | null =
    timeslip && timeslip.et === undefined ? "aborted" : null;
  const style = outcome ? OUTCOME_STYLE[outcome] : null;

  const runLength = series ? Math.max(0, series.duration - leadInSeconds) : null;

  const name = file.fileName.replace(/\.[^.]+$/, "");

  // ET@MPH, the way a timeslip prints it, so a card reads the way the paper in
  // your hand does. Speed is omitted rather than faked when the slip didn't
  // record it.
  const etAtMph = (et: number, mph?: number) =>
    mph === undefined ? et.toFixed(3) : `${et.toFixed(3)}@${mph.toFixed(2)}`;

  const stats: { label: string; value: string }[] = [];
  if (timeslip?.sixtyFt !== undefined) stats.push({ label: "60ft", value: timeslip.sixtyFt.toFixed(3) });
  if (timeslip?.eighthEt !== undefined) {
    stats.push({ label: "1/8", value: etAtMph(timeslip.eighthEt, timeslip.eighthMph) });
  }
  if (timeslip?.et !== undefined) {
    stats.push({ label: "1/4", value: etAtMph(timeslip.et, timeslip.mph) });
  } else if (timeslip?.mph !== undefined) {
    stats.push({ label: "mph", value: timeslip.mph.toFixed(2) });
  }

  return (
    <div
      onClick={onOpen ? undefined : isOnlyLoaded ? undefined : onToggle}
      title={!onOpen && isOnlyLoaded ? "The only pass on the chart — add another before removing this one" : undefined}
      className={`group relative rounded-lg border p-3 transition-colors ${
        onOpen || isOnlyLoaded ? "cursor-default" : "cursor-pointer"
      } ${
        active ? "border-primary/60 bg-muted/40" : "border-border hover:bg-muted/30"
      } ${outcome === "aborted" || chartHidden ? "opacity-60" : ""}`}
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
        {launchX !== null && paths.length > 0 ? (
          <line
            x1={launchX}
            x2={launchX}
            y1={0}
            y2={SPARK_H}
            className="stroke-muted-foreground/30"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="2 2"
          />
        ) : null}
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            strokeWidth={p.width}
            vectorEffect="non-scaling-stroke"
            className={p.key === "rpm" ? (style?.stroke ?? p.className) : p.className}
          />
        ))}
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

      {/* Notes are written while you're looking at the run, so they live on the
          loaded pass rather than only on the event dashboard. Clicks stay in the
          field — the card itself unloads the pass. */}
      {/* Notes belong where you dwell, not in a menu you're passing through. */}
      {loaded && !onOpen && (
        <div onClick={(e) => e.stopPropagation()} className="mt-2">
          <LogNotes fileId={file._id} />
        </div>
      )}

      {onOpen && onCompare && (
        <div className="mt-2 flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={onOpen}>
            Open
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-xs"
            disabled={loaded}
            onClick={onCompare}
          >
            {loaded ? "Loaded" : "Compare"}
          </Button>
        </div>
      )}

      {!onOpen && (
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
      )}

      {loaded && onToggleVisibility && !isOnlyLoaded && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          title={chartHidden ? "Show on chart" : "Hide from chart"}
          className="absolute right-9 top-2 rounded p-1 text-muted-foreground transition-opacity hover:text-foreground"
        >
          {chartHidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        </button>
      )}

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

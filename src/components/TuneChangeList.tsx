import { useState } from "react";
import type { Doc } from "../../convex/_generated/dataModel";

/** More in amber, less in sky: which way a setting went reads at a glance. */
const tone = (step: string) =>
  step.startsWith("+") ? "text-amber-300" : step.startsWith("−") || step.startsWith("-") ? "text-sky-300" : "text-foreground";

/** On a pass card, the first few settings; the rest one tap away. */
const CARD_LIMIT = 5;

/**
 * The settings a tune change moved. A few changed cells are listed with
 * their old and new value; a wider change shows its range. Entries written
 * before details were stored fall back to their text lines.
 */
export function TuneChangeList({ change, compact }: { change: Doc<"changes">; compact?: boolean }) {
  const [all, setAll] = useState(false);
  const details = change.details;
  if (!details?.length) {
    return (
      <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
        {(change.items ?? []).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    );
  }
  const shown = compact && !all ? details.slice(0, CARD_LIMIT) : details;
  return (
    <div>
      <div className="divide-y divide-border/50">
        {shown.map((d, i) => {
          const summaryTone = d.direction === "up" ? "text-amber-300" : d.direction === "down" ? "text-sky-300" : "text-foreground";
          const unit = d.unit ? ` ${d.unit}` : "";
          const positioned = d.cells?.some((c) => c.at);
          return (
            <div key={i} className={compact ? "py-2" : "py-2.5"}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-[13px] font-medium leading-tight text-foreground">{d.name}</span>
                {d.where && <span className="text-[11px] text-muted-foreground">{d.where}</span>}
              </div>
              {d.cells?.length ? (
                <div
                  className={`mt-1 grid items-baseline gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums ${
                    positioned ? "grid-cols-[auto_1fr_auto]" : "grid-cols-[1fr_auto]"
                  }`}
                >
                  {d.cells.map((c, j) => (
                    <div key={j} className="contents">
                      {positioned && <span className="text-muted-foreground">{c.at}</span>}
                      <span className="text-foreground/90">
                        {c.from} <span className="text-muted-foreground">→</span> {c.to}
                      </span>
                      <span className={`text-right font-semibold ${tone(c.step)}`}>
                        {c.step}
                        <span className="font-normal opacity-70">{unit}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${summaryTone}`}>{d.change}</div>
              )}
            </div>
          );
        })}
      </div>
      {compact && details.length > CARD_LIMIT && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground"
        >
          {all ? "Show fewer" : `Show ${details.length - CARD_LIMIT} more`}
        </button>
      )}
    </div>
  );
}

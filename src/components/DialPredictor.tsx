import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { correctionFactor } from "@/lib/weather-correction";
import {
  predictDial,
  predictSlip,
  cfPerThousandFt,
  type DialPass,
  type SlipClocks,
} from "@/lib/dial-predictor";
import type { Doc } from "../../convex/_generated/dataModel";

export interface DialAir {
  airTemperatureF?: number;
  humidityPct?: number;
  barometricPressureInHg?: number;
}

/** What the next pass may run, for the predicted card at the end of the gallery. */
export interface PredictedRun {
  clocks: SlipClocks;
  spread?: number;
  basisCount: number;
  scope: "event" | "all";
  air: DialAir;
}

interface AirDraft {
  temp: string;
  humidity: string;
  baro: string;
}

const draftFrom = (air: DialAir | null): AirDraft => ({
  temp: air?.airTemperatureF !== undefined ? String(air.airTemperatureF) : "",
  humidity: air?.humidityPct !== undefined ? String(air.humidityPct) : "",
  baro: air?.barometricPressureInHg !== undefined ? String(air.barometricPressureInHg) : "",
});

const num = (s: string) => {
  const v = Number(s.trim());
  return s.trim() && Number.isFinite(v) ? v : undefined;
};

/**
 * The next-round dial: type in the air now (it starts from the latest slip's
 * weather) and get the car's predicted ET, from its own recent clean passes
 * corrected to that air. Also answers "how much does this car care about the
 * air", once its passes have taught it.
 */
export function DialPredictor({
  eventId,
  distance,
  history,
  latestAir,
  daPoints,
  onPrediction,
  onPickPasses,
}: {
  eventId: string;
  distance: "1/8" | "1/4";
  /** Clean passes with weather, newest first, at `distance`. */
  history: DialPass[];
  /** Weather of the newest slip that has it — the starting point. */
  latestAir: DialAir | null;
  /** The car's slips that carry both D.A. and enough weather for a factor. */
  daPoints: { da: number; cf: number }[];
  onPrediction?: (run: PredictedRun | null) => void;
  /** Opens the dial-in page, to choose which passes it goes from. */
  onPickPasses?: () => void;
}) {
  const storageKey = `dialAir:${eventId}`;
  const [draft, setDraft] = useState<AirDraft>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved) as AirDraft;
    } catch {
      // No stored air; start from the latest slip.
    }
    return draftFrom(latestAir);
  });
  const [touched, setTouched] = useState(false);

  // Until the racer types, follow the newest slip's weather as slips arrive.
  useEffect(() => {
    if (!touched) setDraft((d) => (d.temp || d.baro ? d : draftFrom(latestAir)));
  }, [latestAir, touched]);

  const update = (patch: Partial<AirDraft>) => {
    setTouched(true);
    setDraft((d) => {
      const next = { ...d, ...patch };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage blocked: the air just won't be remembered.
      }
      return next;
    });
  };

  const targetCf = useMemo(
    () =>
      correctionFactor({
        airTemperatureF: num(draft.temp),
        humidityPct: num(draft.humidity),
        barometricPressureInHg: num(draft.baro),
      } as Doc<"timeslips">),
    [draft]
  );
  const prediction = useMemo(
    () => (targetCf !== null ? predictDial(history, targetCf) : null),
    [history, targetCf]
  );
  const perThousand = useMemo(() => cfPerThousandFt(daPoints), [daPoints]);

  useEffect(() => {
    if (!onPrediction) return;
    onPrediction(
      prediction
        ? {
            clocks: predictSlip(prediction),
            spread: prediction.spread,
            basisCount: prediction.basis.length,
            scope: prediction.scope,
            air: {
              airTemperatureF: num(draft.temp),
              humidityPct: num(draft.humidity),
              barometricPressureInHg: num(draft.baro),
            },
          }
        : null
    );
  }, [prediction, draft, onPrediction]);

  const field = (label: string, unit: string, key: keyof AirDraft, width: string) => (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        inputMode="decimal"
        value={draft[key]}
        onChange={(e) => update({ [key]: e.target.value })}
        className={`h-7 ${width} px-2 font-mono text-xs tabular-nums`}
      />
      {unit}
    </label>
  );

  const perDa = (secPerCf: number) => (secPerCf * perThousand).toFixed(3);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Dial-in · {distance}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {field("Air", "°F", "temp", "w-16")}
        {field("Humidity", "%", "humidity", "w-14")}
        {field("Baro", "inHg", "baro", "w-20")}
      </div>
      {prediction ? (
        <>
          <Popover>
            <PopoverTrigger
              openOnHover
              delay={150}
              nativeButton={false}
              render={<div className="cursor-help font-mono tabular-nums" />}
            >
              <span className="text-xl font-semibold text-green-400">{prediction.et.toFixed(3)}</span>
              {prediction.spread !== undefined && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ± {prediction.spread.toFixed(3)}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <DialExplainer
                prediction={prediction}
                targetCf={targetCf!}
                perDa={perDa}
              />
            </PopoverContent>
          </Popover>
          <div className="text-xs text-muted-foreground">
            Air costs this car{" "}
            <span className="font-mono text-foreground">{perDa(prediction.secPerCf)}s</span> per
            1,000 ft D.A.
            {prediction.sensitivity === "learned"
              ? ` · learned from ${prediction.learnedFrom} passes (textbook ${perDa(prediction.textbookSecPerCf)}s)`
              : " · textbook until more passes have weather"}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">
          {targetCf === null ? "Enter air temp and barometer" : "No clean passes with weather yet"}
        </div>
      )}
      {onPickPasses && (
        <button
          type="button"
          onClick={onPickPasses}
          className="ml-auto cursor-pointer text-xs text-muted-foreground hover:text-foreground"
        >
          Pick passes →
        </button>
      )}
    </div>
  );
}

function DialExplainer({
  prediction,
  targetCf,
  perDa,
}: {
  prediction: NonNullable<ReturnType<typeof predictDial>>;
  targetCf: number;
  perDa: (secPerCf: number) => string;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Predicted dial-in
        </div>
        <div className="font-mono text-2xl font-semibold tabular-nums text-green-400">
          {prediction.et.toFixed(3)}
        </div>
        <p className="mt-1 leading-relaxed text-muted-foreground">
          Each recent clean pass, corrected to this air, then averaged. Air now: correction factor{" "}
          <span className="font-mono text-foreground">{targetCf.toFixed(4)}</span>.
        </p>
      </div>
      <div className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono tabular-nums">
        {prediction.basis.map((b) => {
          const delta = b.corrected - b.et;
          return (
            <div key={b.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="truncate text-muted-foreground">{b.label}</span>
              <span>
                {b.et.toFixed(3)}
                <span className="mx-1 text-muted-foreground/60">
                  {delta >= 0 ? "+" : "−"}
                  {Math.abs(delta).toFixed(3)}
                </span>
                <span className="text-amber-300">{b.corrected.toFixed(3)}</span>
              </span>
            </div>
          );
        })}
        <div className="mt-1 flex items-center justify-between border-t border-border/60 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Average
          </span>
          <span className="font-semibold text-green-400">{prediction.et.toFixed(3)}</span>
        </div>
      </div>
      <p className="leading-relaxed text-muted-foreground">
        {prediction.sensitivity === "learned"
          ? `How much the air moves this car — ${perDa(prediction.secPerCf)}s per 1,000 ft — comes from ${prediction.learnedFrom} of its passes. The textbook says ${perDa(prediction.textbookSecPerCf)}s; a car that tunes or boosts through bad air loses less. Changes to the car between those passes blur it.`
          : `How much the air moves this car uses the textbook rule (${perDa(prediction.secPerCf)}s per 1,000 ft) until enough passes with weather can teach it.`}{" "}
        {prediction.scope === "event"
          ? "Passes from this event only."
          : "This event has too few, so recent passes from any event."}{" "}
        Lifted and pedaled passes are left out. ± is how far the corrected passes disagree.
      </p>
    </div>
  );
}

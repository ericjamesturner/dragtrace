import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { Input } from "@/components/ui/input";
import { slipLift } from "./RpmPreview";
import { liftRefs, runAt, type PassLift, type RunAt } from "@/lib/lift-estimate";
import { categoryLabel, isBigChange } from "@/lib/changes";
import { WrenchIcon } from "lucide-react";
import { correctionFactor } from "@/lib/weather-correction";
import {
  airSensitivity,
  cfPerThousandFt,
  correctPicked,
  pickedSensitivity,
  predictSlip,
  textbookCorrected,
  type AirSensitivity,
  type DialPass,
  type SlipClocks,
} from "@/lib/dial-predictor";

/** A round: one or two letters and a number — T1, Q2, E3, R12. */
const ROUND = /^[A-Z]{1,2}\d{1,2}$/i;
/** NSP's download stamp on the end of a file name: "2026-10-08_1244pm_Logs122to123.csv". */
const STAMP = /\s*-?\s*\d{4}-\d{2}-\d{2}_\d{4}[ap]m.*$/i;

interface PassRow {
  id: string;
  label: string;
  eventId: string;
  slip: Doc<"timeslips">;
  /** Null without air temp and barometer: it can't be moved to other air. */
  cf: number | null;
  /**
   * Whether the driver lifted or pedaled before each finish line. Bracket
   * racers lift on purpose, so a pass that lifted after the 1/8 still has a
   * good 1/8.
   */
  liftEighth: PassLift | null;
  liftQuarter: PassLift | null;
}

interface AirDraft {
  temp: string;
  humidity: string;
  baro: string;
}

const num = (s: string) => {
  const v = Number(s.trim());
  return s.trim() && Number.isFinite(v) ? v : undefined;
};

function load<T>(key: string): T | null {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
}

function passLabel(file: Doc<"files">, slip: Doc<"timeslips">): string {
  const round = file.fileName.split(/\s+/).find((w) => ROUND.test(w));
  if (round) return round.toUpperCase();
  if (file.round ?? slip.round) return (file.round ?? slip.round)!;
  return file.fileName.replace(STAMP, "").replace(/\.[a-z0-9]+$/i, "") || "Pass";
}

/**
 * The dial-in, from passes the racer picks: the passes on the current tune,
 * one good run, a whole weekend. Shows what the textbook says next to what
 * this car's own passes say the air is worth.
 */
export function DialPage({ vehicleId }: { vehicleId?: Id<"vehicles"> }) {
  const { goToPredict } = useNav();
  const vehicles = useQuery(api.vehicles.list);
  const carId = vehicleId ?? vehicles?.[0]?._id;

  return (
    <div className="max-w-4xl space-y-5 p-6">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="text-xl font-semibold">Dial-in</h1>
          {vehicles && vehicles.length > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <select
                value={carId ?? ""}
                onChange={(e) => goToPredict(e.target.value as Id<"vehicles">)}
                className="h-7 cursor-pointer rounded-md border bg-background px-1.5 text-sm"
                aria-label="Car"
              >
                {vehicles.map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the passes to go from, type the air now, and compare the textbook with what this car actually does.
        </p>
      </div>
      {vehicles && vehicles.length === 0 && (
        <p className="text-sm text-muted-foreground">Add a car and some passes with weather first.</p>
      )}
      {carId && <DialBody key={carId} vehicleId={carId} />}
    </div>
  );
}

function DialBody({ vehicleId }: { vehicleId: Id<"vehicles"> }) {
  const files = useQuery(api.files.listByVehicle, { vehicleId });
  const slips = useQuery(api.timeslips.listByVehicle, { vehicleId });
  const events = useQuery(api.events.listByVehicle, { vehicleId });
  const changes = useQuery(api.changes.listByVehicle, { vehicleId });

  // Every pass with a slip, newest event first, each event in run order.
  const groups = useMemo(() => {
    if (!files || !slips || !events) return null;
    const slipFor = new Map<string, Doc<"timeslips">>();
    for (const s of slips) if (!slipFor.has(s.fileId)) slipFor.set(s.fileId, s);
    const byEvent = new Map<string, PassRow[]>();
    // Stored order is newest-first; run order reads the weekend as it went.
    const ordered = [...files].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
    for (const f of ordered) {
      const slip = slipFor.get(f._id);
      if (!slip) continue;
      const row: PassRow = {
        id: f._id,
        label: passLabel(f, slip),
        eventId: f.eventId,
        slip,
        cf: correctionFactor(slip),
        liftEighth: slipLift(f.preview, slip.eighthEt),
        liftQuarter: slip.et !== undefined ? slipLift(f.preview, slip.et) : null,
      };
      byEvent.set(f.eventId, [...(byEvent.get(f.eventId) ?? []), row]);
    }
    return [...events]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .filter((e) => byEvent.has(e._id))
      .map((e) => ({ event: e, rows: byEvent.get(e._id)! }));
  }, [files, slips, events]);

  const rows = useMemo(() => groups?.flatMap((g) => g.rows) ?? [], [groups]);
  // Newest first: the last event's last pass leads.
  const newestFirst = useMemo(
    () => groups?.flatMap((g) => [...g.rows].reverse()) ?? [],
    [groups]
  );

  const picksKey = `dialPicks:${vehicleId}`;
  const [storedPicks, setStoredPicks] = useState<string[] | null>(() => load<string[]>(picksKey));
  // Until the racer picks: every clean pass with weather since the last big
  // change (another converter makes another car), else the newest one.
  const picks = useMemo(() => {
    if (storedPicks) return new Set(storedPicks);
    const clean = (r: PassRow) => r.cf !== null && !r.liftEighth && r.slip.eighthEt !== undefined;
    const lastBig = changes?.find(isBigChange);
    if (lastBig && groups) {
      const oldestFirst = [...groups].reverse().flatMap((g) => g.rows.map((r) => ({ r, date: g.event.date })));
      const after = lastBig.afterFileId ? oldestFirst.findIndex(({ r }) => r.id === lastBig.afterFileId) : -1;
      const from = after >= 0 ? after + 1 : oldestFirst.findIndex(({ date }) => date >= lastBig.date);
      const since = from >= 0 ? oldestFirst.slice(from).map(({ r }) => r).filter(clean) : [];
      if (since.length > 0) return new Set(since.map((r) => r.id));
    }
    const first = newestFirst.find(clean);
    return new Set(first ? [first.id] : []);
  }, [storedPicks, newestFirst, changes, groups]);
  const setPicked = (ids: string[], on: boolean) => {
    const next = new Set(picks);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setStoredPicks([...next]);
    save(picksKey, [...next]);
  };
  const toggle = (id: string) => setPicked([id], !picks.has(id));

  const airKey = `dialAir:car:${vehicleId}`;
  const [storedAir, setStoredAir] = useState<AirDraft | null>(() => load<AirDraft>(airKey));
  const air = useMemo<AirDraft>(() => {
    if (storedAir) return storedAir;
    const latest = newestFirst.find((r) => r.cf !== null)?.slip;
    return {
      temp: latest?.airTemperatureF !== undefined ? String(latest.airTemperatureF) : "",
      humidity: latest?.humidityPct !== undefined ? String(latest.humidityPct) : "",
      baro: latest?.barometricPressureInHg !== undefined ? String(latest.barometricPressureInHg) : "",
    };
  }, [storedAir, newestFirst]);
  const updateAir = (patch: Partial<AirDraft>) => {
    const next = { ...air, ...patch };
    setStoredAir(next);
    save(airKey, next);
  };

  const targetCf = correctionFactor({
    airTemperatureF: num(air.temp),
    humidityPct: num(air.humidity),
    barometricPressureInHg: num(air.baro),
  } as Doc<"timeslips">);

  // What each pass ran at each finish: as it ran when flat, projected from
  // its last full-throttle clock when lifted, out when pedaled.
  const runs = useMemo(() => {
    const refs = liftRefs(
      newestFirst.filter((r) => !r.liftEighth && r.slip.eighthEt !== undefined).map((r) => r.slip),
      newestFirst.filter((r) => !r.liftQuarter && r.slip.et !== undefined).map((r) => r.slip)
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          eighth: runAt(r.slip, r.liftEighth, "1/8", refs),
          quarter: r.slip.et !== undefined ? runAt(r.slip, r.liftQuarter, "1/4", refs) : null,
        },
      ])
    );
  }, [rows, newestFirst]);

  const picked = rows.filter((r) => picks.has(r.id) && r.cf !== null && runs.get(r.id)!.eighth.state !== "out");
  // The 1/4 only when every picked pass has one; otherwise the 1/8 they share.
  const distance: "1/8" | "1/4" =
    picked.length > 0 &&
    picked.every((r) => {
      const q = runs.get(r.id)!.quarter;
      return q !== null && q.state !== "out";
    })
      ? "1/4"
      : "1/8";
  const runOf = (r: PassRow): RunAt =>
    (distance === "1/8" ? runs.get(r.id)!.eighth : runs.get(r.id)!.quarter) ?? { state: "out", lift: null, clocks: {} };
  const usable = (r: PassRow) => r.cf !== null && runOf(r).state !== "out";
  const toPass = (r: PassRow): DialPass | null => {
    const run = runOf(r);
    if (r.cf === null || run.et === undefined) return null;
    return { id: r.id, label: r.label, et: run.et, cf: r.cf, thisEvent: false, clocks: run.clocks };
  };
  const pickedPasses = picked.filter(usable).map(toPass).filter((p): p is DialPass => p !== null);
  // The car's clean history, for when the picks alone can't teach the air.
  const history = newestFirst
    .filter(usable)
    .map(toPass)
    .filter((p): p is DialPass => p !== null);
  const perThousand = cfPerThousandFt(
    rows
      .filter((r) => r.cf !== null && r.slip.densityAltitudeFt !== undefined)
      .map((r) => ({ da: r.slip.densityAltitudeFt!, cf: r.cf! }))
  );

  // Cheap enough to work out on every render.
  const result = (() => {
    if (targetCf === null || pickedPasses.length === 0) return null;
    const textbook = correctPicked(pickedPasses, (p) => textbookCorrected(p, targetCf))!;
    const fromPicks = pickedSensitivity(pickedPasses, targetCf);
    const fromHistory = airSensitivity(history, targetCf);
    const own: (AirSensitivity & { source: "picks" | "history" }) | null = fromPicks
      ? { ...fromPicks, source: "picks" }
      : fromHistory.sensitivity === "learned"
        ? { ...fromHistory, source: "history" }
        : null;
    const actual = own
      ? correctPicked(pickedPasses, (p) => p.et + own.secPerCf * (targetCf - p.cf))!
      : null;
    // The textbook's rate near this air, for the picked passes' ET.
    const textbookSecPerCf =
      pickedPasses.reduce((a, p) => a + p.et, 0) / pickedPasses.length / (3 * targetCf);
    return { textbook, own, actual, textbookSecPerCf };
  })();

  if (!groups) return <p className="text-sm text-muted-foreground">Loading passes…</p>;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">This car has no passes with a timeslip yet.</p>;
  }

  const field = (label: string, unit: string, key: keyof AirDraft, width: string) => (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        inputMode="decimal"
        value={air[key]}
        onChange={(e) => updateAir({ [key]: e.target.value })}
        className={`h-7 ${width} px-2 font-mono text-xs tabular-nums`}
      />
      {unit}
    </label>
  );

  const perDa = (secPerCf: number) => (secPerCf * perThousand).toFixed(3);
  const pickedNames =
    pickedPasses.length <= 4 ? pickedPasses.map((p) => p.label).join(", ") : `${pickedPasses.length} picked passes`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-2.5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Air now</div>
        {field("Air", "°F", "temp", "w-16")}
        {field("Humidity", "%", "humidity", "w-14")}
        {field("Baro", "inHg", "baro", "w-20")}
        {targetCf !== null && (
          <span className="text-xs text-muted-foreground">
            Corr. factor <span className="font-mono text-foreground">{targetCf.toFixed(4)}</span>
          </span>
        )}
      </div>

      {targetCf === null ? (
        <p className="text-sm text-muted-foreground">Enter air temp and barometer.</p>
      ) : !result ? (
        <p className="text-sm text-muted-foreground">Pick at least one pass with weather.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <PredictionCard
            title="Textbook"
            et={result.textbook.et}
            spread={result.textbook.spread}
            clocks={predictSlip(result.textbook)}
            distance={distance}
            note={`${perDa(result.textbookSecPerCf)}s per 1,000 ft D.A.`}
          />
          {result.actual && result.own ? (
            <PredictionCard
              title="Actual"
              accent
              et={result.actual.et}
              spread={result.actual.spread}
              clocks={predictSlip(result.actual)}
              distance={distance}
              note={`${perDa(result.own.secPerCf)}s per 1,000 ft D.A. · ${
                result.own.source === "picks"
                  ? `learned from ${pickedNames}`
                  : `learned from ${result.own.learnedFrom} clean passes`
              }`}
            />
          ) : (
            <div className="flex flex-col justify-center rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <div className="text-[10px] font-medium uppercase tracking-wider">Actual</div>
              <p className="mt-1">
                Pick two or more passes on the same tune in different air, and this car&rsquo;s own number shows here.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {groups.map(({ event, rows: eventRows }, groupIndex) => {
          // Big changes made since the event below and on or before this one.
          const changesHere = (changes ?? []).filter(
            (c) =>
              isBigChange(c) &&
              c.date >= event.date &&
              (groupIndex === 0 || c.date < groups[groupIndex - 1].event.date)
          );
          // The whole event at once: on when every usable pass is picked.
          const usableIds = eventRows.filter(usable).map((r) => r.id);
          const pickedCount = usableIds.filter((id) => picks.has(id)).length;
          const all = usableIds.length > 0 && pickedCount === usableIds.length;
          // The event's bests. The 60' and 330' are real on any pass; the
          // finish only on passes the driver ran flat to it.
          const min = (xs: (number | undefined)[]) => {
            const v = xs.filter((x): x is number => x !== undefined && x > 0);
            return v.length ? Math.min(...v) : undefined;
          };
          const flat = eventRows.filter((r) => runOf(r).state === "clean");
          const best = {
            sixtyFt: min(eventRows.map((r) => r.slip.sixtyFt)),
            threeThirty: min(eventRows.map((r) => r.slip.threeThirty)),
            et: min(flat.map((r) => (distance === "1/8" ? r.slip.eighthEt : r.slip.et))),
            mph: (() => {
              const v = flat
                .map((r) => (distance === "1/8" ? r.slip.eighthMph : r.slip.mph))
                .filter((x): x is number => x !== undefined);
              return v.length ? Math.max(...v) : undefined;
            })(),
          };
          const bestPass = flat.find((r) => (distance === "1/8" ? r.slip.eighthEt : r.slip.et) === best.et);
          const green = (v: number | undefined, b: number | undefined) =>
            v !== undefined && v === b ? "text-green-400" : "";
          return (
            <div key={event._id}>
              {changesHere.map((c) => (
                <div
                  key={c._id}
                  className="mb-3 flex items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-xs"
                >
                  <WrenchIcon className="size-4 shrink-0 text-amber-400" />
                  <span className="font-mono tabular-nums text-muted-foreground">{c.date}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-amber-400">
                    {categoryLabel(c.category)}
                  </span>
                  <span className="truncate">{c.title}</span>
                </div>
              ))}
              <label
                className={`mb-1 flex items-center gap-2 pl-3 text-xs ${
                  usableIds.length > 0 ? "cursor-pointer" : "text-muted-foreground/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = pickedCount > 0 && !all;
                  }}
                  disabled={usableIds.length === 0}
                  onChange={() => setPicked(usableIds, !all)}
                  aria-label={`Use every pass from ${event.name}`}
                  className="cursor-pointer accent-green-500"
                />
                <span className="font-medium">{event.name}</span>
                <span className="text-muted-foreground">{event.date}</span>
                <span className="ml-auto hidden pr-3 font-mono tabular-nums text-muted-foreground sm:inline">
                  {best.et !== undefined && (
                    <>
                      best <span className="text-green-400">{best.et.toFixed(3)}</span>
                      {bestPass && (distance === "1/8" ? bestPass.slip.eighthMph : bestPass.slip.mph) !== undefined && (
                        <> @ {(distance === "1/8" ? bestPass.slip.eighthMph : bestPass.slip.mph)!.toFixed(2)}</>
                      )}
                    </>
                  )}
                  {best.sixtyFt !== undefined && <> · 60&apos; <span className="text-green-400">{best.sixtyFt.toFixed(3)}</span></>}
                  {best.threeThirty !== undefined && (
                    <> · 330&apos; <span className="text-green-400">{best.threeThirty.toFixed(3)}</span></>
                  )}
                </span>
              </label>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full table-fixed text-xs tabular-nums">
                  <thead>
                    <tr className="border-b text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                      <th className="w-9 py-1 pl-3 font-medium" />
                      <th className="w-40 py-1 pr-3 font-medium">Round</th>
                      <th className="w-14 py-1 pr-3 text-right font-medium">60&apos;</th>
                      <th className="w-14 py-1 pr-3 text-right font-medium">330&apos;</th>
                      <th className="w-40 py-1 pr-3 font-medium">{distance}</th>
                      <th className="w-20 py-1 pr-3 font-medium">D.A.</th>
                      <th className="py-1 pr-3 text-right font-medium">Textbook</th>
                      <th className="py-1 pr-3 text-right font-medium">Actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventRows.map((r) => {
                      const s = r.slip;
                      const et = distance === "1/8" ? s.eighthEt : s.et;
                      const mph = distance === "1/8" ? s.eighthMph : s.mph;
                      const basisT = result?.textbook.basis.find((b) => b.id === r.id);
                      const basisA = result?.actual?.basis.find((b) => b.id === r.id);
                      const ok = usable(r);
                      const run = runOf(r);
                      const lift = run.lift;
                      const estimated = run.state === "estimated";
                      const on = picks.has(r.id) && ok;
                      const why = !lift
                        ? undefined
                        : estimated
                          ? `Lifted at ${lift.at.toFixed(2)}s. The ${distance} is projected from the ${run.from!.label} (${run.from!.value.toFixed(3)}) with this car's own ratio from its flat passes.`
                          : lift.kind === "pedaled"
                            ? `Pedaled at ${lift.at.toFixed(2)}s before the ${distance}, so this pass is left out.`
                            : `Lifted at ${lift.at.toFixed(2)}s, before any clock to project the ${distance} from, so this pass is left out.`;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => ok && toggle(r.id)}
                          title={why}
                          className={`border-b last:border-b-0 ${
                            ok ? "cursor-pointer hover:bg-muted/40" : "text-muted-foreground/50"
                          } ${on ? "bg-muted/30" : ""}`}
                        >
                          <td className="w-9 py-1.5 pl-3 align-top">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!ok}
                              onChange={() => toggle(r.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Use ${r.label}`}
                              className="cursor-pointer accent-green-500"
                            />
                          </td>
                          <td className="w-40 py-1.5 pr-3 align-top">
                            <div className="truncate font-medium">
                              {r.label}
                              {lift && (
                                <span
                                  className={`ml-1.5 text-[10px] font-normal uppercase tracking-wider ${
                                    estimated ? "text-amber-400" : "text-amber-400/60"
                                  }`}
                                >
                                  {lift.kind} {lift.at.toFixed(2)}s
                                </span>
                              )}
                            </div>
                            {estimated && et !== undefined && (
                              <div className="truncate text-[10px] text-muted-foreground">
                                cost {(et - run.et!).toFixed(3)}s
                                {mph !== undefined && run.mph !== undefined && run.mph > mph && (
                                  <> · dropped {(run.mph - mph).toFixed(1)} mph</>
                                )}
                              </div>
                            )}
                          </td>
                          <td className={`w-14 py-1.5 pr-3 text-right align-top font-mono ${green(s.sixtyFt, best.sixtyFt)}`}>
                            {s.sixtyFt?.toFixed(3) ?? "—"}
                          </td>
                          <td className={`w-14 py-1.5 pr-3 text-right align-top font-mono ${green(s.threeThirty, best.threeThirty)}`}>
                            {s.threeThirty?.toFixed(3) ?? "—"}
                          </td>
                          <td className="w-40 py-1.5 pr-3 align-top font-mono">
                            {estimated ? (
                              <>
                                <div>
                                  ≈{run.et!.toFixed(3)}
                                  {run.mph !== undefined && (
                                    <span className="text-muted-foreground"> @ ≈{run.mph.toFixed(1)}</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  slip {et?.toFixed(3)}
                                  {mph !== undefined && <> @ {mph.toFixed(2)}</>}
                                </div>
                              </>
                            ) : (
                              <>
                                <span className={run.state === "clean" ? green(et, best.et) : ""}>{et?.toFixed(3) ?? "—"}</span>
                                {mph !== undefined && (
                                  <span className={run.state === "clean" && mph === best.mph ? "text-green-400" : "text-muted-foreground"}>
                                    {" "}@ {mph.toFixed(2)}
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="w-20 py-1.5 pr-3 align-top text-muted-foreground">
                            {r.cf === null
                              ? "no weather"
                              : s.densityAltitudeFt !== undefined
                                ? s.densityAltitudeFt.toLocaleString()
                                : `CF ${r.cf.toFixed(3)}`}
                          </td>
                          <td className="py-1.5 pr-3 text-right align-top font-mono text-muted-foreground">
                            {basisT?.corrected.toFixed(3)}
                          </td>
                          <td className="py-1.5 pr-3 text-right align-top font-mono text-green-400">
                            {basisA?.corrected.toFixed(3)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CLOCK_ROWS: { key: keyof SlipClocks; label: string; dp: number; quarter?: boolean }[] = [
  { key: "sixtyFt", label: "60'", dp: 3 },
  { key: "threeThirty", label: "330'", dp: 3 },
  { key: "eighthEt", label: "1/8", dp: 3 },
  { key: "eighthMph", label: "1/8 MPH", dp: 2 },
  { key: "thousandFt", label: "1000'", dp: 3, quarter: true },
  { key: "et", label: "1/4", dp: 3, quarter: true },
  { key: "mph", label: "1/4 MPH", dp: 2, quarter: true },
];

function PredictionCard({
  title,
  et,
  spread,
  clocks,
  distance,
  note,
  accent,
}: {
  title: string;
  et: number;
  spread?: number;
  clocks: SlipClocks;
  distance: "1/8" | "1/4";
  note: string;
  accent?: boolean;
}) {
  const shown = CLOCK_ROWS.filter((c) => (distance === "1/4" || !c.quarter) && clocks[c.key] !== undefined);
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-0.5 font-mono tabular-nums">
        <span className={`text-3xl font-semibold ${accent ? "text-green-400" : ""}`}>{et.toFixed(3)}</span>
        {/* A line fitted through two passes meets both, so a zero spread says nothing. */}
        {spread !== undefined && spread >= 0.0005 && (
          <span className="ml-1.5 text-xs text-muted-foreground">± {spread.toFixed(3)}</span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-xs tabular-nums">
        {shown.map((c) => (
          <div key={c.key} className="contents">
            <span className="text-muted-foreground">{c.label}</span>
            <span className="text-right">{clocks[c.key]!.toFixed(c.dp)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

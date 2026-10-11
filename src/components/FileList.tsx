import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { FileUpload } from "./FileUpload";
import type { CompareSlipRef } from "./SlipCompareDialog";
import { SEGMENTS, segmentTimes, type SegmentKey } from "@/lib/timeslip-segments";
import type { KnobReading } from "@/lib/launch-readings";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { correctionFactor } from "@/lib/weather-correction";
import { isBigChange } from "@/lib/changes";
import { parsePreview } from "@/lib/preview";
import type { PassChecks } from "@/lib/anomalies";
import { bestForAir, type DialPass } from "@/lib/dial-predictor";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, GaugeIcon } from "lucide-react";
import { readLift, type RaceTimingInfo } from "./RpmPreview";
import { roundOf } from "@/lib/tune-changes";
import {
  HIGH_METRICS,
  LOW_METRICS,
  RunSheet,
  type KnobMoves,
  type MetricBests,
  type MetricKey,
  type MetricRanges,
  type PassEstimate,
  type RefDetail,
  type TuneTabChange,
} from "./RunSheet";

/** What one file's slips tell the page: the fastest ETs (kept per distance
 *  so an eighth-mile pass is never compared against a quarter-mile one), and
 *  the furthest split — the slip's own measure of how long the pass ran. */
interface FileSlipStats {
  quarter: number | null;
  eighth: number | null;
  lastSplit: number | null;
  /** This file's best value per metric, across its slips. */
  metrics: MetricBests;
}

export function FileList({
  vehicleId,
  eventId,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
}) {
  const vehicle = useQuery(api.vehicles.get, { id: vehicleId });
  const units = useUnitPreferences(vehicleId);
  const event = useQuery(api.events.get, { id: eventId });
  const filesNewestFirst = useQuery(api.files.listByEvent, { eventId });
  // The car's whole history, for estimation ratios that can reach past this
  // event when the racer asks for "all data".
  const vehicleFiles = useQuery(api.files.listByVehicle, { vehicleId });
  const vehicleSlips = useQuery(api.timeslips.listByVehicle, { vehicleId });
  const vehicleEvents = useQuery(api.events.listByVehicle, { vehicleId });
  const [estScope, setEstScope] = useState<"event" | "all">("event");
  // Stored order is newest-first (uploads land at position 0). The gallery
  // reads like the weekend went: first pass on the left, latest on the right.
  const files = useMemo(
    () => filesNewestFirst && [...filesNewestFirst].reverse(),
    [filesNewestFirst]
  );
  const removeFile = useMutation(api.files.remove);
  const vehicleChanges = useQuery(api.changes.listByVehicle, { vehicleId });
  // The pass each change first ran on. Hardware changes made after a pass
  // start on the next one here and tag its strip; tune and firmware changes
  // read from the logs know their pass and fill its Tune tab.
  // Knobs moved since the car's previous pass, read from both logs' launch.
  const knobMovesAt = useMemo(() => {
    const at = new Map<string, KnobMoves>();
    if (!vehicleFiles || !vehicleEvents) return at;
    const eventDate = new Map(vehicleEvents.map((e) => [e._id as string, e.date]));
    // The car's passes in the order they ran: by event date, then run order.
    const timeline = [...vehicleFiles].sort((a, b) => {
      const da = eventDate.get(a.eventId) ?? "";
      const db = eventDate.get(b.eventId) ?? "";
      if (da !== db) return da < db ? -1 : 1;
      return (b.order ?? 0) - (a.order ?? 0);
    });
    let prev: { file: Doc<"files">; knobs: KnobReading[] } | null = null;
    for (const f of timeline) {
      // Any stored version: an older one simply has no knobs yet.
      const knobs = parsePreview(f.preview)?.knobs;
      if (!knobs?.length) continue;
      if (prev) {
        const moves = knobs.flatMap((k) => {
          const was = prev!.knobs.find((p) => p.name === k.name);
          return was && was.value !== k.value ? [{ name: k.name, from: was.value, to: k.value }] : [];
        });
        if (moves.length) at.set(f._id, { moves, fromLabel: prev.file.round ?? roundOf(prev.file.fileName) });
      }
      prev = { file: f, knobs };
    }
    return at;
  }, [vehicleFiles, vehicleEvents]);

  const { changesAt, tuneAt } = useMemo(() => {
    const changesAt = new Map<string, Doc<"changes">[]>();
    const tuneAt = new Map<string, TuneTabChange[]>();
    if (!vehicleChanges || !files) return { changesAt, tuneAt };
    const byId = new Map((vehicleFiles ?? []).map((f) => [f._id as string, f]));
    for (const c of vehicleChanges) {
      if (!isBigChange(c)) {
        if (!c.toFileId) continue;
        const from = c.afterFileId ? byId.get(c.afterFileId) : undefined;
        const fromLabel = from ? from.round ?? roundOf(from.fileName) : undefined;
        tuneAt.set(c.toFileId, [...(tuneAt.get(c.toFileId) ?? []), { change: c, fromLabel }]);
        continue;
      }
      let id: string | undefined = c.toFileId;
      if (!id && c.afterFileId) {
        const i = files.findIndex((f) => f._id === c.afterFileId);
        if (i >= 0 && i + 1 < files.length) id = files[i + 1]._id;
      }
      if (id) changesAt.set(id, [...(changesAt.get(id) ?? []), c]);
    }
    return { changesAt, tuneAt };
  }, [vehicleChanges, files, vehicleFiles]);
  const reorderFiles = useMutation(api.files.reorder);
  const { goToEvents, goToViewer, goToPredict } = useNav();

  const handleOpenViewer = useCallback((fileId: Id<"files">) => {
    goToViewer(vehicleId, eventId, [fileId]);
  }, [goToViewer, vehicleId, eventId]);

  // The compare dialog's "open both logs" — files can span events; the viewer
  // loads by file id, so this event just hosts the breadcrumb.
  const handleOpenLogs = useCallback((fileIds: Id<"files">[]) => {
    goToViewer(vehicleId, eventId, fileIds);
  }, [goToViewer, vehicleId, eventId]);

  // Alignment: collect race timing info from each file's preview
  const [raceTimings, setRaceTimings] = useState<Record<string, RaceTimingInfo | null>>({});
  const raceTimingsRef = useRef(raceTimings);
  raceTimingsRef.current = raceTimings;

  const handleRaceTiming = useCallback((fileId: string, info: RaceTimingInfo | null) => {
    const prev = raceTimingsRef.current[fileId];
    if (
      prev?.raceStart === info?.raceStart &&
      prev?.raceEnd === info?.raceEnd &&
      prev?.logDuration === info?.logDuration
    ) return;
    setRaceTimings(prev => ({ ...prev, [fileId]: info }));
  }, []);

  // The event's slips per pass. The BEST tag and the shared preview window
  // both come from what each pass's slips say.
  const slipsByFile = useMemo(() => {
    const out = new Map<string, Doc<"timeslips">[]>();
    for (const s of vehicleSlips ?? []) out.set(s.fileId, [...(out.get(s.fileId) ?? []), s]);
    return out;
  }, [vehicleSlips]);

  const slipStats = useMemo(() => {
    const out: Record<string, FileSlipStats> = {};
    for (const f of files ?? []) {
      const slips = slipsByFile.get(f._id) ?? [];
      const quarters = slips.flatMap((t) => (t.et !== undefined ? [t.et] : []));
      const eighths = slips.flatMap((t) => (t.eighthEt !== undefined ? [t.eighthEt] : []));
      // Splits are cumulative, so the furthest one is simply the largest.
      const splits = slips.flatMap((t) =>
        [t.sixtyFt, t.threeThirty, t.eighthEt, t.thousandFt, t.et].filter(
          (x): x is number => x !== undefined && x > 0
        )
      );
      const metrics: MetricBests = {};
      for (const t of slips) {
        for (const k of LOW_METRICS) {
          const val = t[k];
          if (val === undefined || (k === "rt" && val < 0)) continue;
          if (metrics[k] === undefined || val < metrics[k]) metrics[k] = val;
        }
        for (const k of HIGH_METRICS) {
          const val = t[k];
          if (val === undefined) continue;
          if (metrics[k] === undefined || val > metrics[k]) metrics[k] = val;
        }
        const segs = segmentTimes(t);
        for (const seg of SEGMENTS) {
          const val = segs[seg.key];
          if (val !== undefined && (metrics[seg.key] === undefined || val < metrics[seg.key]!)) metrics[seg.key] = val;
        }
      }
      if (!slips.length) continue;
      out[f._id] = {
        quarter: quarters.length ? Math.min(...quarters) : null,
        eighth: eighths.length ? Math.min(...eighths) : null,
        lastSplit: splits.length ? Math.max(...splits) : null,
        metrics,
      };
    }
    return out;
  }, [files, slipsByFile]);

  // Same idea as the viewer's "Fit to pass": launch through the slip's last
  // split, half a second either side. A file with no slip falls back to its
  // race-timer region. The longest pass sets the shared window so the strips
  // stay aligned card to card.
  const PASS_PAD_S = 0.5;

  const alignWindow = useMemo(() => {
    const slipLens: number[] = [];
    const timerLens: number[] = [];
    for (const f of files ?? []) {
      const slipLen = slipStats[f._id]?.lastSplit ?? null;
      if (slipLen !== null && slipLen > 0) {
        slipLens.push(slipLen);
      } else {
        const timing = raceTimings[f._id];
        if (timing && timing.raceEnd > timing.raceStart) {
          timerLens.push(timing.raceEnd - timing.raceStart);
        }
      }
    }
    // A slip knows exactly how long its pass ran; the race timer often keeps
    // counting long after the stripe. So when the event has any slip at all,
    // the slips set the window and slipless passes ride along — one long
    // timer region must not stretch every strip.
    const lengths = slipLens.length > 0 ? slipLens : timerLens;
    if (lengths.length === 0) return undefined;
    return { preRace: PASS_PAD_S, postRace: Math.max(...lengths) + PASS_PAD_S };
  }, [files, slipStats, raceTimings]);

  // An eighth-mile event: every slip is 1/8 only, so the quarter-mile rows
  // would be nothing but dashes. Until a slip exists, keep the full layout.
  const eighthOnly = useMemo(() => {
    if (!files || !vehicleSlips) return false;
    const ids = new Set<string>(files.map((f) => f._id));
    const slips = vehicleSlips.filter((s) => ids.has(s.fileId));
    return (
      slips.length > 0 &&
      slips.every((s) => s.et === undefined && s.mph === undefined && s.thousandFt === undefined)
    );
  }, [files, vehicleSlips]);

  // The car's clean passes with weather, newest first (events by date, then
  // the event's own pass order), at the distance this event runs — what the
  // best-for-air tag weighs this event's passes with.
  const dialDistance: "1/8" | "1/4" = eighthOnly ? "1/8" : "1/4";
  const dialData = useMemo(() => {
    if (!vehicleFiles || !vehicleSlips || !vehicleEvents) return null;
    const eventDate = new Map(vehicleEvents.map((e) => [e._id as string, e.date]));
    const eventName = new Map(vehicleEvents.map((e) => [e._id as string, e.name]));
    const slipFor = new Map<string, Doc<"timeslips">>();
    for (const s of vehicleSlips) if (!slipFor.has(s.fileId)) slipFor.set(s.fileId, s);
    const ordered = [...vehicleFiles].sort((a, b) => {
      const da = eventDate.get(a.eventId) ?? "";
      const db = eventDate.get(b.eventId) ?? "";
      if (da !== db) return da < db ? 1 : -1;
      return (a.order ?? 0) - (b.order ?? 0);
    });
    // This event's own files first, in their pass order, so "latest" means
    // the latest pass here even if another event shares the date.
    ordered.sort((a, b) => Number(b.eventId === eventId) - Number(a.eventId === eventId));
    const history: DialPass[] = [];
    for (const f of ordered) {
      const s = slipFor.get(f._id);
      if (!s || f.excluded) continue;
      const cf = correctionFactor(s);
      if (cf === null) continue;
      const et = dialDistance === "1/8" ? s.eighthEt : s.et;
      if (et === undefined || et <= 0) continue;
      const lastSplit = Math.max(
        ...[s.sixtyFt, s.threeThirty, s.eighthEt, s.thousandFt, s.et].filter(
          (x): x is number => x !== undefined && x > 0
        )
      );
      const lift = readLift(f.preview, lastSplit);
      if (lift && (lift.finalLift !== null || lift.pedals.length > 0)) continue;
      const here = f.eventId === eventId;
      const round = f.round ?? s.round ?? "Pass";
      history.push({
        id: f._id,
        label: here ? round : `${round} · ${eventName.get(f.eventId) ?? ""}`,
        et,
        cf,
        thisEvent: here,
        clocks: {
          sixtyFt: s.sixtyFt,
          threeThirty: s.threeThirty,
          eighthEt: s.eighthEt,
          eighthMph: s.eighthMph,
          thousandFt: s.thousandFt,
          et: s.et,
          mph: s.mph,
        },
      });
    }
    return { history };
  }, [vehicleFiles, vehicleSlips, vehicleEvents, eventId, dialDistance]);


  // The pass that was best for its conditions: quickest once every clean pass
  // here is moved to the same air. Only worth a tag when it isn't simply the
  // quickest pass.
  const airBest = useMemo(
    () => (dialData ? bestForAir(dialData.history) : null),
    [dialData]
  );

  const bestFileId = useMemo(() => {
    if (!files) return null;
    const ids = new Set<string>(files.filter((f) => !f.excluded).map((f) => f._id));
    let bestQuarter: [string, number] | null = null;
    let bestEighth: [string, number] | null = null;
    for (const [id, v] of Object.entries(slipStats)) {
      if (!ids.has(id)) continue;
      if (v.quarter !== null && (bestQuarter === null || v.quarter < bestQuarter[1]))
        bestQuarter = [id, v.quarter];
      if (v.eighth !== null && (bestEighth === null || v.eighth < bestEighth[1]))
        bestEighth = [id, v.eighth];
    }
    return (bestQuarter ?? bestEighth)?.[0] ?? null;
  }, [slipStats, files]);

  // What a lifted pass was on for, from the car's own flat passes. Those
  // give the ratio from a mid-track clock to the final number (ET ÷ 1000'
  // time, trap MPH ÷ 1/8 MPH); applying it to the lifted pass's last clean
  // split projects the run it clicked off. The racer picks the reference
  // pool: this event's flat passes, or the car's recent flat passes from
  // any event. Estimated off the slips, not measured — projections only
  // come from splits the car passed at full throttle, and 60'/330' are too
  // early to project from at all.
  const MAX_REFS = 8;

  const estimates = useMemo(() => {
    if (!vehicleFiles || !vehicleSlips) return {};

    const slipsByFile = new Map<string, Doc<"timeslips">[]>();
    for (const s of vehicleSlips) {
      const arr = slipsByFile.get(s.fileId);
      if (arr) arr.push(s);
      else slipsByFile.set(s.fileId, [s]);
    }

    // Per file: its slips' best per metric, and whether it ran flat.
    const infoFor = (f: Doc<"files">) => {
      const slips = slipsByFile.get(f._id);
      if (!slips || slips.length === 0) return null;
      const metrics: MetricBests = {};
      for (const t of slips) {
        for (const k of LOW_METRICS) {
          const val = t[k];
          if (val === undefined || (k === "rt" && val < 0)) continue;
          if (metrics[k] === undefined || val < metrics[k]) metrics[k] = val;
        }
        for (const k of HIGH_METRICS) {
          const val = t[k];
          if (val === undefined) continue;
          if (metrics[k] === undefined || val > metrics[k]) metrics[k] = val;
        }
      }
      const splits = slips.flatMap(t =>
        [t.sixtyFt, t.threeThirty, t.eighthEt, t.thousandFt, t.et].filter(
          (x): x is number => x !== undefined && x > 0
        )
      );
      const lift = readLift(f.preview, splits.length ? Math.max(...splits) : null);
      return { metrics, lift };
    };

    const infos = new Map<string, NonNullable<ReturnType<typeof infoFor>>>();
    for (const f of vehicleFiles) {
      const info = infoFor(f);
      if (info) infos.set(f._id, info);
    }

    // The reference pool: flat passes, newest first (listByVehicle order),
    // scoped to this event or the whole history, capped so ancient combos
    // don't drag on today's math.
    const refInfos = vehicleFiles
      .filter(f => (estScope === "event" ? f.eventId === eventId : true))
      .map(f => infos.get(f._id))
      .filter((i): i is NonNullable<typeof i> =>
        i !== undefined && i.lift !== null && i.lift.finalLift === null
      )
      .slice(0, MAX_REFS);
    if (refInfos.length === 0) return {};

    const avg = (vals: number[]) =>
      vals.reduce((a, b) => a + b, 0) / vals.length;
    const SPLIT_LABELS = { thousandFt: "1000'", eighthEt: "1/8", threeThirty: "330'" } as const;
    const ratioFor = (
      num: "et" | "eighthEt",
      den: "thousandFt" | "eighthEt" | "threeThirty"
    ) => {
      const refs: RefDetail[] = refInfos.flatMap(i => {
        const n = i.metrics[num];
        const d = i.metrics[den];
        return n !== undefined && d !== undefined
          ? [{ final: n, split: d, ratio: n / d }]
          : [];
      });
      return refs.length ? { ratio: avg(refs.map(r => r.ratio)), refs } : null;
    };
    const mphRefs: RefDetail[] = refInfos.flatMap(i => {
      const n = i.metrics.mph;
      const d = i.metrics.eighthMph;
      return n !== undefined && d !== undefined
        ? [{ final: n, split: d, ratio: n / d }]
        : [];
    });
    const mphRatio = mphRefs.length
      ? { ratio: avg(mphRefs.map(r => r.ratio)), refs: mphRefs }
      : null;

    // Every pass of the car gets a projection, not just this event's — the
    // compare dialog reaches across events.
    const out: Record<string, PassEstimate> = {};
    for (const f of vehicleFiles) {
      const info = infos.get(f._id);
      if (!info || info.lift === null || info.lift.finalLift === null) continue;
      const finalLift = info.lift.finalLift;
      const m = info.metrics;
      const est: PassEstimate = { scope: estScope };
      // The slip's own fields say the race distance: a quarter slip has an
      // ET, an eighth slip stops at the 660.
      const targets: { finalKey: "et" | "eighthEt"; splits: readonly ("thousandFt" | "eighthEt" | "threeThirty")[] } =
        m.et !== undefined || m.thousandFt !== undefined
          ? { finalKey: "et", splits: ["thousandFt", "eighthEt"] }
          : { finalKey: "eighthEt", splits: ["threeThirty"] };
      for (const k of targets.splits) {
        const split = m[k];
        if (split === undefined || split > finalLift) continue;
        const r = ratioFor(targets.finalKey, k);
        if (r === null) continue;
        const e = split * r.ratio;
        // A projection slower than the slip means the lift cost nothing —
        // there is no run to estimate.
        const actual = m[targets.finalKey];
        if (actual === undefined || e < actual) {
          est.et = {
            value: e,
            splitLabel: SPLIT_LABELS[k],
            splitValue: split,
            ratio: r.ratio,
            refs: r.refs,
          };
        }
        break;
      }
      // Trap-speed projection needs an earlier trap, which only a quarter
      // slip has (the 1/8 lights).
      if (
        targets.finalKey === "et" &&
        mphRatio !== null &&
        m.eighthMph !== undefined &&
        m.eighthEt !== undefined &&
        m.eighthEt <= finalLift
      ) {
        const e = m.eighthMph * mphRatio.ratio;
        if (m.mph === undefined || e > m.mph) {
          est.mph = {
            value: e,
            eighthMph: m.eighthMph,
            ratio: mphRatio.ratio,
            refs: mphRatio.refs,
          };
        }
      }
      if (est.et !== undefined || est.mph !== undefined) out[f._id] = est;
    }
    return out;
  }, [vehicleFiles, vehicleSlips, estScope, eventId]);

  // Every slip the car has, named well enough to stand outside its own event —
  // the compare dialog's menu of opponents, projections riding along.
  const slipRefs = useMemo<CompareSlipRef[]>(() => {
    if (!vehicleSlips || !vehicleFiles || !vehicleEvents) return [];
    const fileById = new Map(vehicleFiles.map((f) => [f._id, f] as const));
    const eventById = new Map(vehicleEvents.map((e) => [e._id, e] as const));
    const entries = vehicleSlips.flatMap((slip) => {
      const f = fileById.get(slip.fileId);
      if (!f) return [];
      return [{ slip, file: f, ev: eventById.get(f.eventId) }];
    });
    // Newest event first; inside an event, the order the weekend ran. Stored
    // file order is newest-first, so run order reads it backwards.
    entries.sort((x, y) => {
      const byDate = (y.ev?.date ?? "").localeCompare(x.ev?.date ?? "");
      if (byDate !== 0) return byDate;
      return (
        (y.file.order ?? -Infinity) - (x.file.order ?? -Infinity) ||
        x.file.uploadedAt - y.file.uploadedAt
      );
    });
    return entries.map(({ slip, file: f, ev }) => ({
      slip,
      passName: f.fileName.replace(/\.[^.]+$/, ""),
      round: f.round ?? slip.round,
      eventName: ev?.name ?? "Unknown event",
      eventDate: ev?.date ?? "",
      estEt: estimates[f._id]?.et?.value,
      estMph: estimates[f._id]?.mph?.value,
    }));
  }, [vehicleSlips, vehicleFiles, vehicleEvents, estimates]);

  // The vehicle's counted passes' pressure and battery levels: what the
  // anomaly check calls usual. Every event the car has run, not just this one.
  // Every pass's slip across the vehicle's events: the 60' the spin check compares with.
  const slipsByVehicleFile = useMemo(() => {
    const out = new Map<string, Doc<"timeslips">>();
    for (const s of vehicleSlips ?? []) if (!out.has(s.fileId)) out.set(s.fileId, s);
    return out;
  }, [vehicleSlips]);
  const levelPool = useMemo(() => {
    const out = new Map<string, PassChecks>();
    for (const f of vehicleFiles ?? []) {
      if (f.excluded) continue;
      const p = parsePreview(f.preview);
      if (p?.levels?.length || p?.cylinders?.length || p?.boost || p?.limiter || p?.driveshaft?.length) {
        out.set(f._id, {
          levels: p.levels ?? [],
          cylinders: p.cylinders ?? [],
          boost: p.boost,
          limiter: p.limiter,
          faults: p.faults,
          driveshaft: p.driveshaft,
          sixtyFt: slipsByVehicleFile.get(f._id)?.sixtyFt,
          slip: p.slip,
          injectors: p.injectors,
        });
      }
    }
    return out;
  }, [vehicleFiles, slipsByVehicleFile]);

  // The event's best value per metric, drawn in green on whichever card
  // holds it. With a single slip in the event everything would be "best",
  // which says nothing — so it needs at least two.
  const eventBests = useMemo<MetricBests>(() => {
    if (!files) return {};
    const ids = new Set<string>(files.filter((f) => !f.excluded).map((f) => f._id));
    const stats = Object.entries(slipStats).filter(
      ([id, v]) => ids.has(id) && Object.keys(v.metrics).length > 0
    );
    if (stats.length < 2) return {};
    const out: MetricBests = {};
    for (const [, v] of stats) {
      // Segments are times too — lower is quicker, same as the clocks.
      for (const k of [...LOW_METRICS, ...SEGMENTS.map((s) => s.key)]) {
        const val = v.metrics[k];
        if (val !== undefined && (out[k] === undefined || val < out[k])) out[k] = val;
      }
      for (const k of HIGH_METRICS) {
        const val = v.metrics[k];
        if (val !== undefined && (out[k] === undefined || val > out[k])) out[k] = val;
      }
    }
    return out;
  }, [slipStats, files]);

  // Best-to-worst spread per metric, for shading every result on the cards.
  // A pass the driver pedaled or lifted on says nothing about the car, so it
  // doesn't set the scale — its slow numbers just land at the grey end.
  const eventRanges = useMemo<MetricRanges>(() => {
    if (!files) return {};
    const ids = new Set<string>();
    for (const f of files) {
      if (f.excluded) continue;
      const lift = readLift(f.preview, slipStats[f._id]?.lastSplit ?? null);
      if (lift && (lift.finalLift !== null || lift.pedals.length > 0)) continue;
      ids.add(f._id);
    }
    const out: MetricRanges = {};
    const add = (k: MetricKey | SegmentKey, val: number | undefined, lowIsBest: boolean) => {
      if (val === undefined || (k === "rt" && val < 0)) return;
      const r = out[k];
      if (!r) {
        out[k] = { best: val, worst: val, count: 1 };
        return;
      }
      r.count++;
      if (lowIsBest ? val < r.best : val > r.best) r.best = val;
      if (lowIsBest ? val > r.worst : val < r.worst) r.worst = val;
    };
    for (const [id, v] of Object.entries(slipStats)) {
      if (!ids.has(id)) continue;
      for (const k of [...LOW_METRICS, ...SEGMENTS.map((s) => s.key)]) add(k, v.metrics[k], true);
      for (const k of HIGH_METRICS) add(k, v.metrics[k], false);
    }
    return out;
  }, [slipStats, files]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => goToEvents(vehicleId)}
          className="mb-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeftIcon className="size-4" />
          {vehicle?.name ?? "..."}
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{event?.name ?? "..."}</h2>
          {event?.date && (
            <span className="text-sm text-muted-foreground">
              — {event.track && `${event.track} · `}
              {event.date}{event.endDate && event.endDate !== event.date && ` → ${event.endDate}`}
            </span>
          )}
          {files && files.length > 0 && (
            <span className="text-sm text-muted-foreground">
              · {files.length} {files.length === 1 ? "pass" : "passes"}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => goToPredict(vehicleId)}
          >
            <GaugeIcon />
            Dial-in
          </Button>
        </div>
        {event?.notes && (
          <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p>
        )}
      </div>

      <FileUpload vehicleId={vehicleId} eventId={eventId} compact={!!files?.length} />

      {files === undefined ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading...
        </p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No files yet. Upload datalogs above.
        </p>
      ) : (
        <RunSheet
          files={files}
          slipsByFile={slipsByFile}
          eighthOnly={eighthOnly}
          raceWeightLb={vehicle?.raceWeightLb}
          unitSystem={units.unitSystem}
          unitOverrides={units.resolved}
          bestFileId={bestFileId}
          airBest={airBest}
          eventBests={eventBests}
          eventRanges={eventRanges}
          estimates={estimates}
          estScope={estScope}
          onEstScopeChange={setEstScope}
          alignWindow={alignWindow}
          onRaceTiming={handleRaceTiming}
          changesAt={changesAt}
          tuneAt={tuneAt}
          knobMovesAt={knobMovesAt}
          levelPool={levelPool}
          slipRefs={slipRefs}
          onOpenViewer={handleOpenViewer}
          onOpenLogs={handleOpenLogs}
          onDelete={(file) => {
            if (window.confirm(`Delete "${file.fileName}"?`)) void removeFile({ id: file._id });
          }}
          onMove={(from, to) => {
            const reordered = [...files];
            const [moved] = reordered.splice(from, 1);
            reordered.splice(to > from ? to - 1 : to, 0, moved);
            // Back to the stored newest-first direction before saving.
            void reorderFiles({ ids: reordered.map((f) => f._id).reverse() });
          }}
        />
      )}
    </div>
  );
}

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { FileUpload } from "./FileUpload";
import { TimeslipForm } from "./TimeslipForm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronLeftIcon,
  DownloadIcon,
  TrashIcon,
  PlusIcon,
  PencilIcon,
  MoreVerticalIcon,
  GripHorizontalIcon,
} from "lucide-react";
import {
  RpmPreview,
  parsePreviewPayload,
  detectLift,
  type RaceTimingInfo,
} from "./RpmPreview";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Where lower is quicker. `rt` only counts non-negative lights — a red
 *  light is a foul, not a good reaction. */
const LOW_METRICS = ["rt", "sixtyFt", "threeThirty", "eighthEt", "thousandFt", "et"] as const;
/** Where higher is faster. */
const HIGH_METRICS = ["eighthMph", "mph"] as const;
type MetricKey = (typeof LOW_METRICS)[number] | (typeof HIGH_METRICS)[number];
type MetricBests = Partial<Record<MetricKey, number>>;

/** One flat pass's contribution to a ratio: its finish clock, the earlier
 *  split it is divided by, and the ratio those two make. */
interface RefDetail {
  final: number;
  split: number;
  ratio: number;
}

/** A lifted pass's projected finish, with the full working behind each
 *  number so the card can teach the math in a popover. */
interface PassEstimate {
  scope: "event" | "all";
  et?: {
    value: number;
    splitLabel: string;
    splitValue: number;
    ratio: number;
    refs: RefDetail[];
  };
  mph?: {
    value: number;
    eighthMph: number;
    ratio: number;
    refs: RefDetail[];
  };
}

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
  const event = useQuery(api.events.get, { id: eventId });
  const filesNewestFirst = useQuery(api.files.listByEvent, { eventId });
  // The car's whole history, for estimation ratios that can reach past this
  // event when the racer asks for "all data".
  const vehicleFiles = useQuery(api.files.listByVehicle, { vehicleId });
  const vehicleSlips = useQuery(api.timeslips.listByVehicle, { vehicleId });
  const [estScope, setEstScope] = useState<"event" | "all">("event");
  // Stored order is newest-first (uploads land at position 0). The gallery
  // reads like the weekend went: first pass on the left, latest on the right.
  const files = useMemo(
    () => filesNewestFirst && [...filesNewestFirst].reverse(),
    [filesNewestFirst]
  );
  const removeFile = useMutation(api.files.remove);
  const reorderFiles = useMutation(api.files.reorder);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  // Dragging only starts from a card's grip bar; the card arms its wrapper
  // on the grip's mousedown and everything else on the card stays inert —
  // selecting text in the rename input no longer picks the card up.
  const [armedIdx, setArmedIdx] = useState<number | null>(null);
  const armDrag = useCallback((i: number) => {
    setArmedIdx(i);
    window.addEventListener("mouseup", () => setArmedIdx(null), { once: true });
  }, []);
  const { goToEvents, goToViewer } = useNav();

  // Cards flow left-to-right and wrap, so the insertion point considers the
  // row (Y) first, then the position within the row (X).
  const getDropIdx = useCallback((e: React.DragEvent<HTMLElement>) => {
    const children = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-file-idx]")
    );
    let closest = 0;
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      const after =
        e.clientY > rect.bottom ||
        (e.clientY >= rect.top && e.clientX > rect.left + rect.width / 2);
      if (after) closest = Number(child.dataset.fileIdx) + 1;
    }
    return closest;
  }, []);

  const handleOpenViewer = useCallback((fileId: Id<"files">) => {
    goToViewer(vehicleId, eventId, [fileId]);
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

  // Each card reports what its slips say. The BEST tag and the shared
  // preview window both come from these.
  const [slipStats, setSlipStats] = useState<Record<string, FileSlipStats>>({});
  const slipStatsRef = useRef(slipStats);
  slipStatsRef.current = slipStats;

  const handleSlipStats = useCallback((fileId: string, info: FileSlipStats) => {
    const prev = slipStatsRef.current[fileId];
    if (
      prev?.quarter === info.quarter &&
      prev?.eighth === info.eighth &&
      prev?.lastSplit === info.lastSplit &&
      [...LOW_METRICS, ...HIGH_METRICS].every(
        (k) => prev.metrics[k] === info.metrics[k]
      )
    ) return;
    setSlipStats(prev => ({ ...prev, [fileId]: info }));
  }, []);

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

  const bestFileId = useMemo(() => {
    if (!files) return null;
    const ids = new Set<string>(files.map(f => f._id));
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
    if (!files || !vehicleFiles || !vehicleSlips) return {};

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
      const payload = parsePreviewPayload(f.preview);
      const lift = payload
        ? detectLift(payload, splits.length ? Math.max(...splits) : null)
        : null;
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

    const out: Record<string, PassEstimate> = {};
    for (const f of files) {
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
  }, [files, vehicleFiles, vehicleSlips, estScope, eventId]);

  // The event's best value per metric, drawn in green on whichever card
  // holds it. With a single slip in the event everything would be "best",
  // which says nothing — so it needs at least two.
  const eventBests = useMemo<MetricBests>(() => {
    if (!files) return {};
    const ids = new Set<string>(files.map(f => f._id));
    const stats = Object.entries(slipStats).filter(
      ([id, v]) => ids.has(id) && Object.keys(v.metrics).length > 0
    );
    if (stats.length < 2) return {};
    const out: MetricBests = {};
    for (const [, v] of stats) {
      for (const k of LOW_METRICS) {
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
              — {event.date}{event.endDate && event.endDate !== event.date && ` → ${event.endDate}`}
            </span>
          )}
          {files && files.length > 0 && (
            <span className="text-sm text-muted-foreground">
              · {files.length} {files.length === 1 ? "pass" : "passes"}
            </span>
          )}
        </div>
        {event?.notes && (
          <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p>
        )}
      </div>

      <FileUpload vehicleId={vehicleId} eventId={eventId} />

      {files === undefined ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading...
        </p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No files yet. Upload datalogs above.
        </p>
      ) : (
        <div
          className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropIdx(getDropIdx(e));
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDropIdx(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const target = getDropIdx(e);
            const from = dragIdxRef.current;
            if (from !== null && target !== from && target !== from + 1) {
              const reordered = [...files];
              const [moved] = reordered.splice(from, 1);
              const insertAt = target > from ? target - 1 : target;
              reordered.splice(insertAt, 0, moved);
              // Back to the stored newest-first direction before saving.
              void reorderFiles({ ids: reordered.map((f) => f._id).reverse() });
            }
            setDragIdx(null);
            setDropIdx(null);
          }}
        >
          {files.map((file, i) => {
            const showBar =
              dropIdx !== null &&
              dragIdx !== null &&
              dropIdx !== dragIdx &&
              dropIdx !== dragIdx + 1;
            return (
              <div
                key={file._id}
                data-file-idx={i}
                draggable={armedIdx === i}
                onDragStart={(e) => {
                  setDragIdx(i);
                  dragIdxRef.current = i;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setArmedIdx(null);
                  setDragIdx(null);
                  setDropIdx(null);
                  dragIdxRef.current = null;
                }}
                className={`relative transition-opacity ${dragIdx === i ? "opacity-30" : ""}`}
              >
                {/* Drop indicator in the gap before this card */}
                {showBar && dropIdx === i && (
                  <div className="absolute -left-[7px] top-0 bottom-0 w-0.5 rounded-full bg-primary" />
                )}
                {/* ...and after the last card, for a drop at the end */}
                {showBar && i === files.length - 1 && dropIdx === files.length && (
                  <div className="absolute -right-[7px] top-0 bottom-0 w-0.5 rounded-full bg-primary" />
                )}
                <PassCard
                  file={file}
                  passNumber={i + 1}
                  onArmDrag={() => armDrag(i)}
                  isBest={file._id === bestFileId}
                  eventBests={eventBests}
                  estimate={estimates[file._id]}
                  onEstScopeChange={setEstScope}
                  onDelete={() => {
                    if (window.confirm(`Delete "${file.fileName}"?`)) {
                      void removeFile({ id: file._id });
                    }
                  }}
                  onRaceTiming={(info) => handleRaceTiming(file._id, info)}
                  onSlipStats={handleSlipStats}
                  alignWindow={alignWindow}
                  onOpenViewer={() => handleOpenViewer(file._id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PassCard({
  file,
  passNumber,
  isBest,
  eventBests,
  estimate,
  onEstScopeChange,
  onArmDrag,
  onDelete,
  onRaceTiming,
  onSlipStats,
  alignWindow,
  onOpenViewer,
}: {
  file: Doc<"files">;
  passNumber: number;
  isBest: boolean;
  eventBests: MetricBests;
  estimate?: PassEstimate;
  onEstScopeChange: (scope: "event" | "all") => void;
  onArmDrag: () => void;
  onDelete: () => void;
  onRaceTiming?: (info: RaceTimingInfo | null) => void;
  onSlipStats: (fileId: string, info: FileSlipStats) => void;
  alignWindow?: { preRace: number; postRace: number };
  onOpenViewer: () => void;
}) {
  const url = useQuery(api.files.getUrl, { fileId: file._id });
  const timeslips = useQuery(api.timeslips.listByFile, { fileId: file._id });
  const updateNotes = useMutation(api.files.updateNotes);
  const updateRound = useMutation(api.files.updateRound);
  const renameFile = useMutation(api.files.rename);
  const removeTimeslip = useMutation(api.timeslips.remove);
  const [editingName, setEditingName] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fileName, setFileName] = useState(file.fileName);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(file.notes ?? "");
  const [editingRound, setEditingRound] = useState(false);
  const [roundDraft, setRoundDraft] = useState("");
  const [showTimeslipForm, setShowTimeslipForm] = useState(false);
  const [editingTimeslip, setEditingTimeslip] = useState<Doc<"timeslips"> | null>(null);

  useEffect(() => {
    if (!timeslips) return;
    const quarters = timeslips.filter(t => t.et !== undefined).map(t => t.et as number);
    const eighths = timeslips.filter(t => t.eighthEt !== undefined).map(t => t.eighthEt as number);
    // Splits are cumulative, so the furthest one is simply the largest.
    const splits = timeslips.flatMap(t =>
      [t.sixtyFt, t.threeThirty, t.eighthEt, t.thousandFt, t.et].filter(
        (x): x is number => x !== undefined && x > 0
      )
    );
    const metrics: MetricBests = {};
    for (const t of timeslips) {
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
    onSlipStats(file._id, {
      quarter: quarters.length ? Math.min(...quarters) : null,
      eighth: eighths.length ? Math.min(...eighths) : null,
      lastSplit: splits.length ? Math.max(...splits) : null,
      metrics,
    });
  }, [timeslips, file._id, onSlipStats]);

  /**
   * Opening the signed URL hands back a storage-id filename, and a browser will
   * often render a CSV in the tab instead of saving it. Pull the blob and save
   * it under the name the racer uploaded.
   */
  const downloadFile = async () => {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = file.fileName.endsWith(".csv")
        ? file.fileName
        : `${file.fileName}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Big logs on a bad connection are the usual cause; the tab fallback
      // still gets the file even if it lands with the storage id as its name.
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  const handleSaveNotes = async () => {
    await updateNotes({ id: file._id, notes: notes.trim() || undefined });
    setEditingNotes(false);
  };

  // The card's headline numbers come from its first slip: full ET when the
  // slip has one, otherwise the eighth-mile pair.
  const firstSlip = timeslips?.[0];
  // The round lives on the file so it exists before any slip; slips entered
  // before that field existed carry it as a fallback.
  const passRound = file.round ?? firstSlip?.round;
  let heroKind: "quarter" | "eighth" | null = null;
  let heroEt: number | undefined;
  let heroMph: number | undefined;
  if (firstSlip) {
    if (firstSlip.et !== undefined || firstSlip.mph !== undefined) {
      heroKind = "quarter";
      heroEt = firstSlip.et;
      heroMph = firstSlip.mph;
    } else if (firstSlip.eighthEt !== undefined || firstSlip.eighthMph !== undefined) {
      heroKind = "eighth";
      heroEt = firstSlip.eighthEt;
      heroMph = firstSlip.eighthMph;
    }
  }
  // Where the throttle came out of it during the pass, read off the stored
  // preview. The pass length comes from the slip's furthest split.
  const passLen = useMemo(() => {
    const splits = (timeslips ?? []).flatMap(t =>
      [t.sixtyFt, t.threeThirty, t.eighthEt, t.thousandFt, t.et].filter(
        (x): x is number => x !== undefined && x > 0
      )
    );
    return splits.length ? Math.max(...splits) : null;
  }, [timeslips]);

  const lift = useMemo(() => {
    const payload = parsePreviewPayload(file.preview);
    return payload ? detectLift(payload, passLen) : null;
  }, [file.preview, passLen]);

  // Ran under the dial — a breakout reads red, like it costs you the round.
  const heroBreakout =
    firstSlip?.dialIn !== undefined &&
    heroEt !== undefined &&
    heroEt < firstSlip.dialIn;
  const heroEtBest =
    heroEt !== undefined &&
    heroEt === eventBests[heroKind === "quarter" ? "et" : "eighthEt"];
  const heroMphBest =
    heroMph !== undefined &&
    heroMph === eventBests[heroKind === "quarter" ? "mph" : "eighthMph"];

  return (
    <>
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-lg border bg-card ${
        isBest
          ? "border-green-500/60 shadow-[0_0_18px_-4px_rgba(34,197,94,0.45)]"
          : ""
      }`}
    >
      {/* The only place a drag can start. */}
      <div
        className="flex h-4 shrink-0 cursor-grab items-center justify-center border-b bg-muted/40 text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        onMouseDown={onArmDrag}
        title="Drag to reorder"
      >
        <GripHorizontalIcon className="size-3.5" />
      </div>

      {/* RPM trace strip — race-aligned across the event's passes.
          Clicking it opens the log, same as the button at the bottom. */}
      <div
        className="h-16 shrink-0 cursor-pointer border-b bg-muted/20 transition-colors hover:bg-muted/40"
        onClick={onOpenViewer}
        title="Open the log"
      >
        <RpmPreview
          file={file}
          height={62}
          onRaceTiming={onRaceTiming}
          alignWindow={alignWindow}
        />
      </div>

      {/* Header: pass number, headline numbers, card menu */}
      <div className="flex items-start gap-2 px-3 pt-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Pass {passNumber}
            </span>
            {editingRound ? (
              <input
                className="w-14 border-b border-primary bg-transparent font-mono text-[10px] font-semibold uppercase outline-none"
                value={roundDraft}
                autoFocus
                placeholder="Q1"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRoundDraft(e.target.value.toUpperCase())}
                onBlur={() => {
                  void updateRound({
                    id: file._id,
                    round: roundDraft.trim().toUpperCase() || undefined,
                  });
                  setEditingRound(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingRound(false);
                }}
              />
            ) : (
              passRound && (
                <span
                  className="cursor-text font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground/90 hover:underline decoration-muted-foreground/50"
                  title="Click to change the round"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRoundDraft(passRound);
                    setEditingRound(true);
                  }}
                >
                  {passRound}
                </span>
              )
            )}
            {isBest && (
              // The win light: solid green, black text, like the bulb at the stripe.
              <span className="rounded-sm bg-green-500 px-1 text-[9px] font-bold uppercase tracking-wider text-black">
                Best
              </span>
            )}
          </div>
          {heroKind === null ? (
            // Keeps the header the same height as a card with numbers.
            <div className="font-mono text-xl font-semibold leading-tight tabular-nums text-muted-foreground/30">
              —
            </div>
          ) : (
            <div className="font-mono text-xl font-semibold leading-tight tabular-nums">
              <span
                className={
                  heroBreakout
                    ? "text-red-400"
                    : heroEtBest || isBest
                      ? "text-green-400"
                      : ""
                }
              >
                {heroEt !== undefined ? String(heroEt) : "—"}
              </span>
              {heroMph !== undefined && (
                <span
                  className={`text-sm font-normal ${
                    heroMphBest ? "text-green-400" : "text-muted-foreground"
                  }`}
                >
                  {" @ "}{String(heroMph)}
                </span>
              )}
              {heroKind === "eighth" && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground/70">1/8</span>
              )}
            </div>
          )}
          {editingName ? (
            <input
              className="w-full bg-transparent text-[11px] border-b border-primary outline-none"
              value={fileName}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setFileName(e.target.value)}
              onBlur={() => {
                let trimmed = fileName.trim();
                if (trimmed) {
                  const origExt = file.fileName.match(/\.[^.]+$/)?.[0];
                  if (origExt && !trimmed.endsWith(origExt)) {
                    trimmed += origExt;
                  }
                }
                if (trimmed && trimmed !== file.fileName) {
                  setFileName(trimmed);
                  void renameFile({ id: file._id, fileName: trimmed });
                } else {
                  setFileName(file.fileName);
                }
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setFileName(file.fileName);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <div
              className="truncate text-[11px] text-muted-foreground cursor-text hover:underline decoration-muted-foreground/50"
              onClick={(e) => {
                e.stopPropagation();
                setFileName(file.fileName.replace(/\.[^.]+$/, ""));
                setEditingName(true);
              }}
              title={`${file.fileName} — click to rename`}
            >
              {file.fileName.replace(/\.[^.]+$/, "")}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground/60">
            {new Date(file.uploadedAt).toLocaleDateString()} · {formatFileSize(file.fileSize)}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              />
            }
          >
            <MoreVerticalIcon className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-auto min-w-44"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setRoundDraft(passRound ?? "");
                // After the menu closes — it hands focus back to its trigger,
                // which would blur the editor shut the moment it mounts.
                setTimeout(() => setEditingRound(true), 120);
              }}
            >
              <PencilIcon />
              Set round
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setFileName(file.fileName.replace(/\.[^.]+$/, ""));
                setTimeout(() => setEditingName(true), 120);
              }}
            >
              <PencilIcon />
              Rename pass
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setNotes(file.notes ?? "");
                setTimeout(() => setEditingNotes(true), 120);
              }}
            >
              <PencilIcon />
              Edit note
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!url || downloading}
              onClick={(e) => {
                e.stopPropagation();
                void downloadFile();
              }}
            >
              <DownloadIcon />
              {downloading ? "Downloading…" : "Download log"}
            </DropdownMenuItem>
            {firstSlip ? (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingTimeslip(firstSlip);
                    setShowTimeslipForm(true);
                  }}
                >
                  <PencilIcon />
                  Edit timeslip
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Delete this timeslip?")) {
                      void removeTimeslip({ id: firstSlip._id });
                    }
                  }}
                >
                  <TrashIcon />
                  Delete timeslip
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTimeslip(null);
                  setShowTimeslipForm(true);
                }}
              >
                <PlusIcon />
                Add timeslip
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <TrashIcon />
              Delete file
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Timeslip lines */}
      <div className="flex-1 px-3 pb-1 pt-2 font-mono text-sm">
        {timeslips === undefined ? null : timeslips.length === 0 ? (
          // A ghost slip keeps this card the same height as its neighbours;
          // the button floats over it as the empty state's one action.
          <div className="relative">
            <div className="pointer-events-none opacity-30" aria-hidden>
              <SlipLines ts={EMPTY_SLIP} bests={{}} />
              <Separator className="my-1.5" />
              <TimeslipLine label="LIFT B4 1/4" value={undefined} />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTimeslip(null);
                  setShowTimeslipForm(true);
                }}
              >
                <PlusIcon />
                Add timeslip
              </Button>
            </div>
          </div>
        ) : (
          timeslips.map((ts, idx) => (
            <div key={ts._id}>
              {idx > 0 && <Separator className="my-2" />}
              <SlipLines ts={ts} bests={eventBests} />
              {idx === timeslips.length - 1 && lift !== null && passLen !== null && (
                <>
                  <Separator className="my-1.5" />
                  {/* How long before the stripe the throttle came out.
                      No lift is a non-event — the whole row fades back. */}
                  <TimeslipLine
                    label={
                      ts.et !== undefined
                        ? "LIFT B4 1/4"
                        : ts.eighthEt !== undefined
                          ? "LIFT B4 1/8"
                          : "LIFT"
                    }
                    value={
                      lift.finalLift !== null
                        ? `${Math.max(0, passLen - lift.finalLift).toFixed(2)}s`
                        : "none"
                    }
                    valueClassName={
                      lift.finalLift !== null ? "text-amber-300/90" : undefined
                    }
                    rowClassName={lift.finalLift === null ? "opacity-35" : undefined}
                  />
                  {lift.pedals.length > 0 && (
                    <TimeslipLine
                      label="PEDAL"
                      value={`${lift.pedals[0].toFixed(1)}s${
                        lift.pedals.length > 1 ? ` ×${lift.pedals.length}` : ""
                      }`}
                      valueClassName="text-red-400"
                    />
                  )}
                  {estimate && lift.finalLift !== null && (
                    <>
                      <div className="mb-0.5 mt-2 flex items-baseline justify-between">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                          Estimations
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                className="font-sans text-[10px] text-muted-foreground/60 transition-colors hover:text-foreground"
                                onClick={(e) => e.stopPropagation()}
                              />
                            }
                          >
                            {estimate.scope === "event" ? "This event" : "All data"} ▾
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenuItem onClick={() => onEstScopeChange("event")}>
                              This event
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEstScopeChange("all")}>
                              All data
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {estimate.et && (
                        <EstimateLine
                          line={
                            <TimeslipLine
                              label="E.T."
                              value={`≈ ${estimate.et.value.toFixed(3)}`}
                            />
                          }
                        >
                          <EstimateExplainer
                            title={`Estimated E.T. ≈ ${estimate.et.value.toFixed(3)}`}
                            intro={`The driver lifted ${(passLen - lift.finalLift).toFixed(2)}s before the finish, so the final clock reads slower than the car was running. This rebuilds the finish from the ${estimate.et.splitLabel} — the last clock the car passed at full throttle.`}
                            ratioIntro={`On flat passes, this car's finish E.T. is a steady multiple of its ${estimate.et.splitLabel} time:`}
                            refs={estimate.et.refs}
                            ratio={estimate.et.ratio}
                            applyIntro={`This pass clocked ${estimate.et.splitValue} at the ${estimate.et.splitLabel}. Apply the ratio:`}
                            calc={`${estimate.et.splitValue} × ${estimate.et.ratio.toFixed(4)} ≈ ${estimate.et.value.toFixed(3)}`}
                            scope={estimate.scope}
                          />
                        </EstimateLine>
                      )}
                      {estimate.mph && (
                        <EstimateLine
                          line={
                            <TimeslipLine
                              label="MPH"
                              value={`≈ ${estimate.mph.value.toFixed(2)}`}
                            />
                          }
                        >
                          <EstimateExplainer
                            title={`Estimated MPH ≈ ${estimate.mph.value.toFixed(2)}`}
                            intro="The lift killed the charge to the stripe, so the trap speed reads slow. This rebuilds it from the 1/8-mile speed, trapped before the lift."
                            ratioIntro="On flat passes, this car's finish speed is a steady multiple of its 1/8-mile speed:"
                            refs={estimate.mph.refs}
                            ratio={estimate.mph.ratio}
                            applyIntro={`This pass trapped ${estimate.mph.eighthMph} at the 1/8. Apply the ratio:`}
                            calc={`${estimate.mph.eighthMph} × ${estimate.mph.ratio.toFixed(4)} ≈ ${estimate.mph.value.toFixed(2)}`}
                            scope={estimate.scope}
                          />
                        </EstimateLine>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Notes footer */}
      <div className="px-3 py-2">
        {editingNotes ? (
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Run notes, observations..."
            rows={2}
            autoFocus
            className="text-xs"
            onClick={(e) => e.stopPropagation()}
            onBlur={() => void handleSaveNotes()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
              if (e.key === "Escape") {
                setNotes(file.notes ?? "");
                setEditingNotes(false);
              }
            }}
          />
        ) : (
          <p
            className={`whitespace-pre-wrap text-xs ${file.notes ? "text-muted-foreground" : "text-muted-foreground/40"}`}
            onClick={(e) => {
              e.stopPropagation();
              setNotes(file.notes ?? "");
              setEditingNotes(true);
            }}
            title="Click to edit notes"
          >
            {file.notes || "Add a note"}
          </p>
        )}
      </div>

      {/* The way in, spelled out. The trace strip up top does the same. */}
      <div className="px-3 pb-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onOpenViewer}
        >
          Open Log
        </Button>
      </div>
    </div>

    {/* Outside the card so the portaled dialog's clicks don't bubble into
        the card's click handlers. */}
    <TimeslipForm
      open={showTimeslipForm}
      onOpenChange={setShowTimeslipForm}
      fileId={file._id}
      round={passRound}
      timeslip={editingTimeslip ?? undefined}
      onDone={() => {
        setShowTimeslipForm(false);
        setEditingTimeslip(null);
      }}
    />
    </>
  );
}

/** An estimation row that opens its math lesson on hover or click. */
function EstimateLine({
  line,
  children,
}: {
  line: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        nativeButton={false}
        render={<div className="cursor-help" onClick={(e) => e.stopPropagation()} />}
      >
        {line}
      </PopoverTrigger>
      <PopoverContent align="end" onClick={(e) => e.stopPropagation()}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** The full working behind one estimated number, spelled out step by step. */
function EstimateExplainer({
  title,
  intro,
  ratioIntro,
  refs,
  ratio,
  applyIntro,
  calc,
  scope,
}: {
  title: string;
  intro: string;
  ratioIntro: string;
  refs: RefDetail[];
  ratio: number;
  applyIntro: string;
  calc: string;
  scope: "event" | "all";
}) {
  const SHOW = 4;
  return (
    <div className="space-y-2.5">
      <p className="font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{intro}</p>
      <div className="text-xs">
        <p className="mb-1">{ratioIntro}</p>
        <div className="space-y-0.5 rounded-md bg-muted/50 p-2 font-mono">
          {refs.slice(0, SHOW).map((r, i) => (
            <div key={i}>
              {r.final} ÷ {r.split} = {r.ratio.toFixed(4)}
            </div>
          ))}
          {refs.length > SHOW && (
            <div className="text-muted-foreground">
              …and {refs.length - SHOW} more
            </div>
          )}
          <div className="mt-1 border-t border-border/60 pt-1">
            average → {ratio.toFixed(4)}
          </div>
        </div>
      </div>
      <div className="text-xs">
        <p className="mb-1">{applyIntro}</p>
        <div className="rounded-md bg-muted/50 p-2 font-mono">{calc}</div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {scope === "event"
          ? `Ratios come from ${refs.length} flat ${refs.length === 1 ? "pass" : "passes"} at this event.`
          : `Ratios come from this car's last ${refs.length} flat ${refs.length === 1 ? "pass" : "passes"}, any event.`}{" "}
        It is an estimate — the car, the air and the track decide the real
        number.
      </p>
    </div>
  );
}

/** A slip with nothing on it, for the empty state's ghost lines. */
const EMPTY_SLIP = {} as Doc<"timeslips">;

/** The classic slip layout, dotted leaders and all. */
function SlipLines({
  ts,
  bests,
}: {
  ts: Doc<"timeslips">;
  bests: MetricBests;
}) {
  const redLight = ts.rt !== undefined && ts.rt < 0;
  const breakout =
    ts.dialIn !== undefined && ts.et !== undefined && ts.et < ts.dialIn;
  // On an eighth-mile slip the dial is an eighth dial, so the 1/8 line is
  // the one that can break out.
  const eighthBreakout =
    ts.dialIn !== undefined &&
    ts.et === undefined &&
    ts.eighthEt !== undefined &&
    ts.eighthEt < ts.dialIn;

  // The event's best of this metric lives on this slip — draw it green.
  const bestClass = (k: MetricKey) =>
    ts[k] !== undefined && ts[k] === bests[k] ? "text-green-400" : undefined;

  // Every line always renders — empty shows as "—" — so the slips line up
  // row for row across the whole gallery.
  return (
    <div className="space-y-0.5">
      <TimeslipLine label="DIAL" value={ts.dialIn} valueClassName="text-amber-300/90" />
      <TimeslipLine label="BOX" value={ts.delayBox} />
      <TimeslipLine
        label="R.T."
        value={ts.rt}
        valueClassName={redLight ? "text-red-400" : bestClass("rt")}
      />

      <Separator className="my-1.5" />

      <TimeslipLine label="60'" value={ts.sixtyFt} valueClassName={bestClass("sixtyFt")} />
      <TimeslipLine label="330'" value={ts.threeThirty} valueClassName={bestClass("threeThirty")} />

      <Separator className="my-1.5" />

      <TimeslipLine
        label="1/8"
        value={ts.eighthEt}
        valueClassName={eighthBreakout ? "text-red-400" : bestClass("eighthEt")}
      />
      <TimeslipLine label="MPH" value={ts.eighthMph} valueClassName={bestClass("eighthMph")} />

      <Separator className="my-1.5" />

      <TimeslipLine label="1000'" value={ts.thousandFt} valueClassName={bestClass("thousandFt")} />

      <Separator className="my-1.5" />

      <TimeslipLine
        label="1/4"
        value={ts.et}
        bold
        valueClassName={breakout ? "text-red-400" : bestClass("et")}
      />
      <TimeslipLine label="MPH" value={ts.mph} bold valueClassName={bestClass("mph")} />
    </div>
  );
}

function TimeslipLine({
  label,
  value,
  bold,
  valueClassName,
  rowClassName,
}: {
  label: string;
  value: number | string | undefined;
  bold?: boolean;
  valueClassName?: string;
  rowClassName?: string;
}) {
  const display = value !== undefined ? String(value) : "—";
  return (
    <div className={`flex items-baseline gap-0 ${rowClassName ?? ""}`}>
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      <span className="flex-1 overflow-hidden text-muted-foreground/40 mx-1 select-none" aria-hidden>
        {"...................................................................................."}
      </span>
      <span className={`shrink-0 ${bold ? "font-bold" : ""} ${valueClassName ?? ""}`}>
        {display}
      </span>
    </div>
  );
}

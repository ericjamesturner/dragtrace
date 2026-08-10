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
} from "lucide-react";
import {
  RpmPreview,
  parsePreviewPayload,
  detectLift,
  type RaceTimingInfo,
} from "./RpmPreview";
import { Tip } from "@/components/ui/tooltip";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What one file's slips tell the page: the fastest ETs (kept per distance
 *  so an eighth-mile pass is never compared against a quarter-mile one), and
 *  the furthest split — the slip's own measure of how long the pass ran. */

/** Where lower is quicker. `rt` only counts non-negative lights — a red
 *  light is a foul, not a good reaction. */
const LOW_METRICS = ["rt", "sixtyFt", "threeThirty", "eighthEt", "thousandFt", "et"] as const;
/** Where higher is faster. */
const HIGH_METRICS = ["eighthMph", "mph"] as const;
type MetricKey = (typeof LOW_METRICS)[number] | (typeof HIGH_METRICS)[number];
type MetricBests = Partial<Record<MetricKey, number>>;

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
    const lengths: number[] = [];
    for (const f of files ?? []) {
      const slipLen = slipStats[f._id]?.lastSplit ?? null;
      const timing = raceTimings[f._id];
      const len = slipLen ?? (timing ? timing.raceEnd - timing.raceStart : null);
      if (len !== null && len > 0) lengths.push(len);
    }
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

  // What a lifted pass was on for, from the car's own flat passes at this
  // event. Those give the ratio from a mid-track clock to the final number
  // (ET ÷ 1000' time, trap MPH ÷ 1/8 MPH); applying it to the lifted pass's
  // last clean split projects the run it clicked off. Estimated off the
  // slips, not measured — projections only come from splits the car passed
  // at full throttle, and 60'/330' are too early to project from at all.
  const estimates = useMemo(() => {
    if (!files) return {};
    const lifts: Record<string, ReturnType<typeof detectLift>> = {};
    for (const f of files) {
      const payload = parsePreviewPayload(f.preview);
      lifts[f._id] = payload
        ? detectLift(payload, slipStats[f._id]?.lastSplit ?? null)
        : null;
    }
    // Every flat pass teaches the car's ratios, whatever distance it raced.
    const flat = files.filter(f => {
      const l = lifts[f._id];
      return l !== null && l !== undefined && l.finalLift === null;
    });
    if (flat.length === 0) return {};
    const avg = (vals: number[]) =>
      vals.reduce((a, b) => a + b, 0) / vals.length;
    const ratioFor = (
      num: "et" | "eighthEt",
      den: "thousandFt" | "eighthEt" | "threeThirty"
    ) => {
      const vals = flat.flatMap(f => {
        const m = slipStats[f._id]?.metrics;
        const n = m?.[num];
        const d = m?.[den];
        return n !== undefined && d !== undefined ? [n / d] : [];
      });
      return vals.length ? avg(vals) : null;
    };
    const mphVals = flat.flatMap(f => {
      const m = slipStats[f._id]?.metrics;
      return m?.mph !== undefined && m.eighthMph !== undefined
        ? [m.mph / m.eighthMph]
        : [];
    });
    const mphRatio = mphVals.length ? avg(mphVals) : null;

    const out: Record<string, { et?: number; mph?: number }> = {};
    for (const f of files) {
      const l = lifts[f._id];
      const m = slipStats[f._id]?.metrics;
      if (!l || l.finalLift === null || !m) continue;
      const est: { et?: number; mph?: number } = {};
      // The slip's own fields say the race distance: a quarter slip has an
      // ET, an eighth slip stops at the 660.
      const targets: { finalKey: "et" | "eighthEt"; splits: readonly ("thousandFt" | "eighthEt" | "threeThirty")[] } =
        m.et !== undefined || m.thousandFt !== undefined
          ? { finalKey: "et", splits: ["thousandFt", "eighthEt"] }
          : { finalKey: "eighthEt", splits: ["threeThirty"] };
      for (const k of targets.splits) {
        const split = m[k];
        if (split === undefined || split > l.finalLift) continue;
        const r = ratioFor(targets.finalKey, k);
        if (r === null) continue;
        const e = split * r;
        // A projection slower than the slip means the lift cost nothing —
        // there is no run to estimate.
        const actual = m[targets.finalKey];
        if (actual === undefined || e < actual) est.et = e;
        break;
      }
      // Trap-speed projection needs an earlier trap, which only a quarter
      // slip has (the 1/8 lights).
      if (
        targets.finalKey === "et" &&
        mphRatio !== null &&
        m.eighthMph !== undefined &&
        m.eighthEt !== undefined &&
        m.eighthEt <= l.finalLift
      ) {
        const e = m.eighthMph * mphRatio;
        if (m.mph === undefined || e > m.mph) est.mph = e;
      }
      if (est.et !== undefined || est.mph !== undefined) out[f._id] = est;
    }
    return out;
  }, [files, slipStats]);

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
                draggable
                onDragStart={(e) => {
                  const tag = (e.target as HTMLElement).tagName;
                  if (tag === "INPUT" || tag === "TEXTAREA") {
                    e.preventDefault();
                    return;
                  }
                  setDragIdx(i);
                  dragIdxRef.current = i;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
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
                  isBest={file._id === bestFileId}
                  eventBests={eventBests}
                  estimate={estimates[file._id]}
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
  estimate?: { et?: number; mph?: number };
  onDelete: () => void;
  onRaceTiming?: (info: RaceTimingInfo | null) => void;
  onSlipStats: (fileId: string, info: FileSlipStats) => void;
  alignWindow?: { preRace: number; postRace: number };
  onOpenViewer: () => void;
}) {
  const url = useQuery(api.files.getUrl, { fileId: file._id });
  const timeslips = useQuery(api.timeslips.listByFile, { fileId: file._id });
  const updateNotes = useMutation(api.files.updateNotes);
  const renameFile = useMutation(api.files.rename);
  const removeTimeslip = useMutation(api.timeslips.remove);
  const [editingName, setEditingName] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fileName, setFileName] = useState(file.fileName);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(file.notes ?? "");
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
      className={`group/card relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border bg-card transition-colors ${
        isBest
          ? "border-green-500/60 shadow-[0_0_18px_-4px_rgba(34,197,94,0.45)] hover:border-green-400"
          : "hover:border-primary/50"
      }`}
      onClick={onOpenViewer}
      title="Open in viewer"
    >
      {/* RPM trace strip — race-aligned across the event's passes */}
      <div className="h-16 shrink-0 border-b bg-muted/20">
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
            {firstSlip?.round && (
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground/90">
                {firstSlip.round}
              </span>
            )}
            {isBest && (
              // The win light: solid green, black text, like the bulb at the stripe.
              <span className="rounded-sm bg-green-500 px-1 text-[9px] font-bold uppercase tracking-wider text-black">
                Best
              </span>
            )}
          </div>
          {heroKind !== null && (
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
                size="icon-xs"
                className="opacity-0 group-hover/card:opacity-100"
                onClick={(e) => e.stopPropagation()}
              />
            }
          >
            <MoreVerticalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
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
          <Button
            variant="outline"
            size="sm"
            className="mb-2 opacity-60 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setEditingTimeslip(null);
              setShowTimeslipForm(true);
            }}
          >
            <PlusIcon />
            Add timeslip
          </Button>
        ) : (
          timeslips.map((ts, idx) => (
            <div key={ts._id}>
              {idx > 0 && <Separator className="my-2" />}
              <SlipLines ts={ts} bests={eventBests} />
              {idx === timeslips.length - 1 && lift !== null && passLen !== null && (
                <>
                  <Separator className="my-1.5" />
                  {/* How long before the stripe the throttle came out. */}
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
                      lift.finalLift !== null
                        ? "text-amber-300/90"
                        : "text-muted-foreground/70"
                    }
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
                      <div className="mb-0.5 mt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                        Estimations
                      </div>
                      {estimate.et !== undefined && (
                        <TimeslipLine label="E.T." value={`≈ ${estimate.et.toFixed(3)}`} />
                      )}
                      {estimate.mph !== undefined && (
                        <TimeslipLine label="MPH" value={`≈ ${estimate.mph.toFixed(1)}`} />
                      )}
                    </>
                  )}
                </>
              )}
              <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100">
                <Tip content="Edit timeslip">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTimeslip(ts);
                      setShowTimeslipForm(true);
                    }}
                  >
                    <PencilIcon />
                  </Button>
                </Tip>
                <Tip content="Delete timeslip">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Delete this timeslip?")) {
                        void removeTimeslip({ id: ts._id });
                      }
                    }}
                  >
                    <TrashIcon className="text-destructive" />
                  </Button>
                </Tip>
              </div>
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
    </div>

    {/* Outside the card so the portaled dialog's clicks don't bubble into
        the card's open-viewer handler. */}
    <TimeslipForm
      open={showTimeslipForm}
      onOpenChange={setShowTimeslipForm}
      fileId={file._id}
      timeslip={editingTimeslip ?? undefined}
      onDone={() => {
        setShowTimeslipForm(false);
        setEditingTimeslip(null);
      }}
    />
    </>
  );
}

/**
 * The classic slip layout, dotted leaders and all. The pair already shown
 * big in the card header (`heroPair`) is left out so the numbers only
 * appear once per card.
 */
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
      <TimeslipLine
        label="E.T."
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
}: {
  label: string;
  value: number | string | undefined;
  bold?: boolean;
  valueClassName?: string;
}) {
  const display = value !== undefined ? String(value) : "—";
  return (
    <div className="flex items-baseline gap-0">
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

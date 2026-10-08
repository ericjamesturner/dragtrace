import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQueries, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  TrophyIcon,
  XIcon,
} from "lucide-react";
import { useNav } from "../Layout";
import { useTimeslips } from "@/hooks/useTimeslips";
import { usePassPreviews, LEAD_IN_SECONDS } from "@/hooks/usePassPreviews";
import { sparklinePath, type RaceSeries } from "@/lib/preview";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return "";
  const year = new Date().getFullYear();
  const suffix = +m[1] !== year ? ` '${m[1].slice(2)}` : "";
  return `${MONTHS[+m[2] - 1]} ${+m[3]}${suffix}`;
}

/**
 * What a racer calls a run. The file name carries the upload stamp on the end
 * ("… 2026-07-25_0654pm_Logs643to646"), which identifies nothing you'd say out
 * loud — the useful part is everything before it.
 */
function shortPassName(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, "");
  const stamped = name.search(/\s\d{4}-\d{2}-\d{2}/);
  return (stamped > 0 ? name.slice(0, stamped) : name).trim();
}

/** Name, then the three numbers off the slip. */
const PASS_ROW = "grid grid-cols-[1fr_3.5rem_6.5rem_6.5rem] items-baseline gap-2";

/** ET@MPH the way the timeslip prints it; a run that didn't record one says so. */
function etAtMph(et: number | undefined, mph: number | undefined): string {
  if (et === undefined) return "—";
  return mph === undefined ? et.toFixed(3) : `${et.toFixed(3)}@${mph.toFixed(2)}`;
}

// Tall enough to read the shape of a pull, not just that there was one.
const SPARK_W = 640;
const SPARK_H = 88;

/**
 * The run's shape under its numbers: engine speed, what the driver asked for,
 * and what reached the ground — the same three lines, and the same colours,
 * the traces use. Drawn to the axis every pass in the event shares, so two
 * cards are comparable at a glance.
 */
function PassSpark({ series, spanSeconds }: { series: RaceSeries | null; spanSeconds: number }) {
  const paths = useMemo(() => {
    if (!series) return [];
    const span = spanSeconds || series.duration;
    const draw = (values: (number | null)[] | null) =>
      sparklinePath(series.times, values, span, SPARK_W, SPARK_H);
    return [
      { key: "dsRpm", d: draw(series.dsRpm), className: "stroke-blue-500" },
      { key: "tps", d: draw(series.tps), className: "stroke-green-500" },
      { key: "rpm", d: draw(series.rpm), className: "stroke-red-500" },
    ].filter((p) => p.d);
  }, [series, spanSeconds]);

  if (paths.length === 0) return null;
  const launchX = spanSeconds > 0 ? (LEAD_IN_SECONDS / spanSeconds) * SPARK_W : null;

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="mt-1.5 h-22 w-full"
      aria-hidden
    >
      {launchX !== null && (
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
      )}
      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          fill="none"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className={p.className}
        />
      ))}
    </svg>
  );
}

/** Each file's record, fetched by id — loaded runs can come from any event. */
function useFileDocs(fileIds: Id<"files">[]): Map<string, Doc<"files">> {
  const queries = useMemo(() => {
    const q: Record<string, { query: typeof api.files.get; args: { id: Id<"files"> } }> = {};
    fileIds.forEach((id, i) => (q[`f${i}`] = { query: api.files.get, args: { id } }));
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(",")]);
  const results = useQueries(queries);
  return useMemo(() => {
    const map = new Map<string, Doc<"files">>();
    fileIds.forEach((id, i) => {
      const r = results[`f${i}`];
      if (r && !(r instanceof Error)) map.set(id as string, r as Doc<"files">);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(","), results]);
}

/**
 * What to call each run on its chip. One run gets its name; several get the
 * first word that tells them apart — "T1", "T2" — since the rest of the name
 * is usually the same weekend, and the chips have to sit side by side.
 */
function chipNames(names: string[]): string[] {
  if (names.length <= 1) return names;
  const tokens = names.map((n) => n.trim().split(/\s+/).filter(Boolean));
  const depth = Math.min(4, Math.max(0, ...tokens.map((t) => t.length)));
  for (let i = 0; i < depth; i++) {
    const candidate = tokens.map((t) => t[i] ?? "");
    if (candidate.every(Boolean) && new Set(candidate).size === candidate.length) return candidate;
  }
  return names;
}

/** One run on the chart: its colour, its name, its time, and what you can do to it. */
function RunChip({
  color,
  name,
  fullName,
  slip,
  hidden,
  pending,
  canRemove,
  onToggleVisibility,
  onRemove,
}: {
  color?: string;
  name: string;
  fullName: string;
  slip?: Doc<"timeslips">;
  hidden: boolean;
  pending: boolean;
  canRemove: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-xs transition-opacity ${
        hidden ? "opacity-50" : ""
      }`}
    >
      {pending ? (
        <LoaderCircleIcon className="size-3 animate-spin text-sky-400" />
      ) : (
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color ?? "#888" }} />
      )}
      <Tip content={fullName}>
        <span className="max-w-64 truncate font-medium">{name}</span>
      </Tip>
      {slip?.et !== undefined && (
        <span className="font-mono tabular-nums text-muted-foreground">{etAtMph(slip.et, slip.mph)}</span>
      )}
      {!pending && (
        <>
          <Tip content={hidden ? "Show on the chart" : "Hide from the chart"}>
            <button
              type="button"
              onClick={onToggleVisibility}
              className="flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
            </button>
          </Tip>
          {canRemove && (
            <Tip content="Take off the chart">
              <button
                type="button"
                onClick={onRemove}
                className="flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <XIcon className="size-3.5" />
              </button>
            </Tip>
          )}
        </>
      )}
    </div>
  );
}

interface PanelActions {
  loaded: Set<string>;
  pending: Set<string>;
  logColors: Record<string, string>;
  /** Only one run left: it can't come off, the chart needs something to draw. */
  lastOne: boolean;
  onToggle: (fileId: Id<"files">) => void;
  onOnly: (eventId: Id<"events">, fileId: Id<"files">) => void;
}

/** One weekend's runs, with their numbers and their shape. */
function EventRuns({
  event,
  expanded,
  onToggleExpanded,
  search,
  actions,
}: {
  event: { _id: Id<"events">; name: string; date: string; bestEt?: number; bestMph?: number };
  expanded: boolean;
  onToggleExpanded: () => void;
  search: string;
  actions: PanelActions;
}) {
  const files = useQuery(api.files.listByEvent, expanded ? { eventId: event._id } : "skip");
  const fileIds = useMemo(() => (files ?? []).map((f) => f._id), [files]);
  const timeslips = useTimeslips(fileIds, expanded);
  const { seriesByFile, spanSeconds } = usePassPreviews(files ?? [], timeslips);

  const bestId = useMemo(() => {
    let best: { id: string; et: number } | null = null;
    for (const f of files ?? []) {
      const et = timeslips.get(f._id)?.[0]?.et;
      if (et !== undefined && (!best || et < best.et)) best = { id: f._id, et };
    }
    return best?.id;
  }, [files, timeslips]);

  const q = search.trim().toLowerCase();
  const shown = (files ?? []).filter((f) => {
    if (!q) return true;
    const slip = timeslips.get(f._id)?.[0];
    return f.fileName.toLowerCase().includes(q) || (slip?.et !== undefined && slip.et.toFixed(3).includes(q));
  });
  if (q && expanded && files && shown.length === 0) return null;

  return (
    <section className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="flex-1 truncate text-sm font-medium">{event.name}</span>
        {event.bestEt !== undefined && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {etAtMph(event.bestEt, event.bestMph)}
          </span>
        )}
        <span className="w-14 text-right text-xs text-muted-foreground">{shortDate(event.date)}</span>
      </button>

      {expanded && (
        <div className="space-y-1 px-2 pb-2">
          {files === undefined && (
            <p className="px-2 py-3 text-xs text-muted-foreground">Loading runs…</p>
          )}
          {files?.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">No runs in this event.</p>
          )}
          {shown.length > 0 && (
            <div className={`${PASS_ROW} px-2 pl-7 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>
              <span>Run</span>
              <span className="text-right">60 ft</span>
              <span className="text-right">1/8</span>
              <span className="text-right">1/4</span>
            </div>
          )}
          {shown.map((file) => {
            const id = file._id as string;
            const isLoaded = actions.loaded.has(id);
            const isPending = actions.pending.has(id);
            const slip = timeslips.get(file._id)?.[0];
            const locked = isLoaded && actions.lastOne;
            return (
              <div
                key={file._id}
                role="button"
                tabIndex={0}
                aria-pressed={isLoaded}
                onClick={() => !locked && !isPending && actions.onToggle(file._id)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !locked && !isPending) {
                    e.preventDefault();
                    actions.onToggle(file._id);
                  }
                }}
                className={`group rounded-md border px-2 py-1.5 transition-colors ${
                  locked || isPending ? "cursor-default" : "cursor-pointer"
                } ${isLoaded ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/50"}`}
              >
                <div className="flex items-center gap-2">
                  {/* The run's own colour once it's on the chart; an empty ring
                      until then — the same switch the chips are. */}
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {isPending ? (
                      <LoaderCircleIcon className="size-3.5 animate-spin text-sky-400" />
                    ) : isLoaded ? (
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: actions.logColors[id] ?? "#888" }}
                      />
                    ) : (
                      <span className="size-2.5 rounded-full border border-muted-foreground/50" />
                    )}
                  </span>
                  <div className={`${PASS_ROW} min-w-0 flex-1 text-sm`}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate" title={file.fileName}>{shortPassName(file.fileName)}</span>
                      {id === bestId && (
                        <Tip content="Quickest run of the event">
                          <TrophyIcon className="size-3 shrink-0 text-amber-400" />
                        </Tip>
                      )}
                    </span>
                    <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {slip?.sixtyFt?.toFixed(3) ?? "—"}
                    </span>
                    <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {etAtMph(slip?.eighthEt, slip?.eighthMph)}
                    </span>
                    <span className="text-right font-mono text-xs font-medium tabular-nums">
                      {etAtMph(slip?.et, slip?.mph)}
                    </span>
                  </div>
                </div>
                <div className="relative pl-6">
                  <PassSpark series={seriesByFile.get(file._id) ?? null} spanSeconds={spanSeconds} />
                  {!isPending && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.onOnly(event._id, file._id);
                      }}
                      className="absolute right-0 top-1.5 hidden cursor-pointer rounded border bg-background/90 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground group-hover:block"
                    >
                      Only this
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Where runs come onto the chart. Docked over the right edge rather than in a
 * menu: it stays open while you add and drop runs and watch the chart change,
 * and nothing behind it is dimmed or blocked.
 */
function AddRunsPanel({
  vehicleId,
  eventId,
  onClose,
  actions,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  onClose: () => void;
  actions: PanelActions;
}) {
  const vehicles = useQuery(api.vehicles.list, {});
  const [scopeVehicleId, setScopeVehicleId] = useState(vehicleId);
  const events = useQuery(api.events.listByVehicle, { vehicleId: scopeVehicleId });
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([eventId as string]));

  // A different car opens on its most recent weekend.
  useEffect(() => {
    if (scopeVehicleId === vehicleId || !events || events.length === 0) return;
    setExpanded(new Set([events[0]._id as string]));
  }, [events, scopeVehicleId, vehicleId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // This weekend first, then the rest newest first.
  const ordered = useMemo(() => {
    const list = [...(events ?? [])];
    const here = list.findIndex((e) => e._id === eventId);
    if (here > 0) list.unshift(...list.splice(here, 1));
    return list;
  }, [events, eventId]);

  // Quick picks from this weekend: its quickest run, and the run before the
  // one you're looking at.
  const hereFiles = useQuery(api.files.listByEvent, { eventId });
  const hereIds = useMemo(() => (hereFiles ?? []).map((f) => f._id), [hereFiles]);
  const hereSlips = useTimeslips(hereIds);
  const best = useMemo(() => {
    let out: { file: Doc<"files">; et: number } | null = null;
    for (const f of hereFiles ?? []) {
      const et = hereSlips.get(f._id)?.[0]?.et;
      if (et !== undefined && (!out || et < out.et)) out = { file: f, et };
    }
    return out?.file;
  }, [hereFiles, hereSlips]);
  const previous = useMemo(() => {
    const files = hereFiles ?? [];
    const first = files.findIndex((f) => actions.loaded.has(f._id as string));
    return first > 0 ? files[first - 1] : undefined;
  }, [hereFiles, actions.loaded]);

  const quick = [
    { label: "Quickest run", file: best },
    { label: "Run before", file: previous },
  ].filter((x): x is { label: string; file: Doc<"files"> } => !!x.file && !actions.loaded.has(x.file._id as string));

  return createPortal(
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-[min(30rem,100vw)] flex-col border-l bg-background shadow-2xl"
      aria-label="Add runs to the chart"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className="flex-1 text-sm font-semibold">Runs</span>
        {(vehicles?.length ?? 0) > 1 && (
          <select
            value={scopeVehicleId}
            onChange={(e) => setScopeVehicleId(e.target.value as Id<"vehicles">)}
            className="h-7 cursor-pointer rounded-md border bg-background px-2 text-xs"
            aria-label="Car"
          >
            {vehicles!.map((v) => (
              <option key={v._id} value={v._id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="space-y-2 border-b px-3 py-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a run by name or time"
            className="h-8 w-full rounded-md border bg-input/30 pl-7 pr-2 text-sm outline-none focus:border-ring"
          />
        </div>
        {scopeVehicleId === vehicleId && quick.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quick.map(({ label, file }) => (
              <button
                key={label}
                type="button"
                onClick={() => actions.onToggle(file._id)}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
              >
                <PlusIcon className="size-3" />
                <span className="text-muted-foreground">{label}</span>
                <span className="max-w-40 truncate">{shortPassName(file.fileName)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Click a run to put it on the chart or take it off.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {events === undefined && <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>}
        {ordered.map((event) => (
          <EventRuns
            key={event._id}
            event={event}
            expanded={!!search.trim() || expanded.has(event._id as string)}
            onToggleExpanded={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(event._id as string)) next.delete(event._id as string);
                else next.add(event._id as string);
                return next;
              })
            }
            search={search}
            actions={actions}
          />
        ))}
      </div>
    </aside>,
    document.body,
  );
}

/**
 * The viewer's top bar: where you are on the left — car, then weekend, both
 * real links — and what's on the chart beside it, one chip per run in the
 * colour its lines are drawn. Runs come on and off through the Runs panel.
 */
export function ViewerBreadcrumb({
  vehicleId,
  eventId,
  loadedFileIds,
  pendingFileIds,
  logColors = {},
  onOpen,
  onCompare,
  onRemove,
  hiddenLogIds,
  onToggleVisibility,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  loadedFileIds: Id<"files">[];
  /** Chosen but still being fetched and parsed — a multi-megabyte log is not
   *  instant, and without this the run just sits there. */
  pendingFileIds?: Id<"files">[];
  /** Each loaded run's line colour, by file id, so a chip matches its lines. */
  logColors?: Record<string, string>;
  /** Show this pass on its own, replacing what's loaded. */
  onOpen: (vehicleId: Id<"vehicles">, eventId: Id<"events">, fileId: Id<"files">) => void;
  /** Lay this pass over what's already loaded. */
  onCompare: (fileId: Id<"files">) => void;
  /** Take this pass back off the chart. */
  onRemove: (fileId: Id<"files">) => void;
  /** Loaded but not drawn — kept out of the way without unloading it. */
  hiddenLogIds: string[];
  onToggleVisibility: (fileId: Id<"files">) => void;
}) {
  const { goToEvents, goToFiles } = useNav();
  const vehicles = useQuery(api.vehicles.list, {});
  const events = useQuery(api.events.listByVehicle, { vehicleId });
  const vehicle = vehicles?.find((v) => v._id === vehicleId);
  const event = events?.find((e) => e._id === eventId);
  const [panelOpen, setPanelOpen] = useState(false);

  // Chips for everything on the chart and everything on its way.
  const chipIds = useMemo(() => {
    const ids = [...loadedFileIds];
    for (const id of pendingFileIds ?? []) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [loadedFileIds, pendingFileIds]);
  const docs = useFileDocs(chipIds);
  const slips = useTimeslips(chipIds);
  const fullNames = chipIds.map((id) => shortPassName(docs.get(id as string)?.fileName ?? "…"));
  const names = chipNames(fullNames);

  const loaded = useMemo(() => new Set(loadedFileIds as string[]), [loadedFileIds]);
  const pending = useMemo(() => new Set((pendingFileIds ?? []) as string[]), [pendingFileIds]);
  const actions: PanelActions = {
    loaded,
    pending,
    logColors,
    lastOne: loadedFileIds.length <= 1,
    onToggle: (fileId) => (loaded.has(fileId as string) ? onRemove(fileId) : onCompare(fileId)),
    onOnly: (evId, fileId) => {
      setPanelOpen(false);
      onOpen(vehicleId, evId, fileId);
    },
  };

  const crumb = "h-7 shrink-0 whitespace-nowrap px-1.5 text-sm font-normal text-muted-foreground hover:text-foreground";

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" className={crumb} onClick={() => goToEvents(vehicleId)}>
        {vehicle?.name ?? "Car"}
      </Button>
      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/40" />
      <Button variant="ghost" size="sm" className={crumb} onClick={() => goToFiles(vehicleId, eventId)}>
        {event?.name ?? "Event"}
      </Button>

      <span className="mx-2 h-5 w-px shrink-0 bg-border" />

      <div className="flex items-center gap-1.5">
        {chipIds.map((id, i) => (
          <RunChip
            key={id}
            color={logColors[id as string]}
            name={names[i]}
            fullName={docs.get(id as string)?.fileName.replace(/\.[^.]+$/, "") ?? ""}
            slip={slips.get(id)?.[0]}
            hidden={hiddenLogIds.includes(id as string)}
            pending={pending.has(id as string) && !loaded.has(id as string)}
            canRemove={loaded.has(id as string) && loadedFileIds.length > 1}
            onToggleVisibility={() => onToggleVisibility(id)}
            onRemove={() => onRemove(id)}
          />
        ))}
        <Button
          variant={panelOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-xs"
          onClick={() => setPanelOpen((o) => !o)}
        >
          <PlusIcon className="size-3.5" />
          Add run
        </Button>
      </div>

      {panelOpen && (
        <AddRunsPanel
          vehicleId={vehicleId}
          eventId={eventId}
          onClose={() => setPanelOpen(false)}
          actions={actions}
        />
      )}
    </div>
  );
}

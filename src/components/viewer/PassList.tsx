import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useTimeslips } from "@/hooks/useTimeslips";
import { PassCard } from "./PassCard";
import { parsePreview, raceSeries, type RaceSeries } from "@/lib/preview";
import { ChevronRightIcon } from "lucide-react";

/**
 * Every run for this car, grouped the way a season actually happened — by
 * weekend. The event you're working in starts open and the rest stay folded, so
 * the list is short by default but a comparison against last month is two
 * clicks away rather than a dialog.
 */
/** Lead-in before the launch, and a little room past the finish line. */
const LEAD_IN_SECONDS = 1;
const FINISH_TAIL_SECONDS = 0.5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse a YYYY-MM-DD date without letting the timezone shift it a day. */
function parseDay(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}

/**
 * Compact date for an event header: "Mar 11–14", or across months
 * "Mar 30 – Apr 2". The year only appears when it isn't the current one, which
 * is exactly when you need it — scrolling back through past seasons.
 */
function formatEventDate(date: string, endDate?: string): string {
  const a = parseDay(date);
  if (!a) return "";
  const b = endDate ? parseDay(endDate) : null;
  const year = new Date().getFullYear();
  const suffix = a.y !== year ? ` '${String(a.y).slice(2)}` : "";

  if (!b || (b.y === a.y && b.m === a.m && b.d === a.d)) {
    return `${MONTHS[a.m]} ${a.d}${suffix}`;
  }
  if (b.y === a.y && b.m === a.m) {
    return `${MONTHS[a.m]} ${a.d}–${b.d}${suffix}`;
  }
  return `${MONTHS[a.m]} ${a.d} – ${MONTHS[b.m]} ${b.d}${suffix}`;
}

export function PassList({
  vehicleId,
  eventId,
  loadedFileIds,
  pendingFileIds,
  onAddFile,
  onRemoveFile,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  loadedFileIds: Id<"files">[];
  pendingFileIds?: Id<"files">[];
  onAddFile: (fileId: Id<"files">) => void;
  onRemoveFile: (fileId: Id<"files">) => void;
}) {
  const [search, setSearch] = useState("");
  // Passes from another car can be pulled onto the same chart. Defaults to the
  // one you're in, which is the comparison people want almost every time.
  const [scopeVehicleId, setScopeVehicleId] = useState<Id<"vehicles">>(vehicleId);
  // Only what the user has explicitly toggled; everything else is derived, so
  // groups don't need resetting when the data changes underneath them.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const vehicles = useQuery(api.vehicles.list, {});
  const files = useQuery(api.files.listByVehicle, { vehicleId: scopeVehicleId });
  const events = useQuery(api.events.listByVehicle, { vehicleId: scopeVehicleId });

  const query = search.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!files || !events) return [];
    const byEvent = new Map<string, Doc<"files">[]>();
    for (const f of files) {
      if (query && !f.fileName.toLowerCase().includes(query)) continue;
      const list = byEvent.get(f.eventId) ?? [];
      list.push(f);
      byEvent.set(f.eventId, list);
    }
    // events arrives sorted by date descending, which is the order we want.
    return events
      .filter((e) => byEvent.has(e._id))
      .map((e) => ({ event: e, files: byEvent.get(e._id)! }));
  }, [files, events, query]);

  // Parsed once here rather than per card.
  const seriesByFile = useMemo(() => {
    const map = new Map<string, RaceSeries | null>();
    for (const g of groups) {
      for (const f of g.files) {
        const preview = parsePreview(f.preview);
        map.set(f._id, preview ? raceSeries(preview) : null);
      }
    }
    return map;
  }, [groups]);

  const fileIds = useMemo(() => groups.flatMap((g) => g.files.map((f) => f._id)), [groups]);
  const timeslips = useTimeslips(fileIds);

  // Each card is trimmed to its own run. The race timer keeps counting past the
  // stripe, so how much log follows a pass says nothing about the pass — left
  // alone it makes near-identical runs look wildly different. The elapsed time
  // off the slip is the only thing that actually marks the finish.
  const trimmedSeries = useMemo(() => {
    const out = new Map<string, RaceSeries | null>();
    for (const [fileId, series] of seriesByFile) {
      const slip = timeslips.get(fileId as Id<"files">)?.[0];
      const et = slip?.et ?? slip?.eighthEt;
      if (!series || et === undefined) {
        out.set(fileId, series);
        continue;
      }
      const cutoff = LEAD_IN_SECONDS + et + FINISH_TAIL_SECONDS;
      let end = series.times.length;
      for (let i = 0; i < series.times.length; i++) {
        if (series.times[i] > cutoff) { end = i; break; }
      }
      out.set(
        fileId,
        end > 1
          ? {
              times: series.times.slice(0, end),
              rpm: series.rpm.slice(0, end),
              tps: series.tps ? series.tps.slice(0, end) : null,
              dsRpm: series.dsRpm ? series.dsRpm.slice(0, end) : null,
              duration: series.times[end - 1],
            }
          : series,
      );
    }
    return out;
  }, [seriesByFile, timeslips]);

  // One time axis for every card, so equal time is equal width and the launch
  // sits at the same place on each.
  const spanSeconds = useMemo(() => {
    let longestEt = 0;
    for (const [, slips] of timeslips) {
      const t = slips[0];
      const et = t?.et ?? t?.eighthEt;
      if (et !== undefined && et > longestEt) longestEt = et;
    }
    if (longestEt > 0) return LEAD_IN_SECONDS + longestEt + FINISH_TAIL_SECONDS;
    // No slips entered yet: fall back to the longest recorded window.
    let longest = 0;
    for (const [, s] of seriesByFile) if (s && s.duration > longest) longest = s.duration;
    return longest || 1;
  }, [timeslips, seriesByFile]);
  const loaded = useMemo(() => new Set(loadedFileIds), [loadedFileIds]);
  const pending = useMemo(() => new Set(pendingFileIds ?? []), [pendingFileIds]);

  // Open the event being viewed; failing that the most recent one. A search
  // opens everything it matched, since a hit inside a folded group is invisible.
  const defaultOpenId =
    scopeVehicleId === vehicleId && groups.some((g) => g.event._id === eventId)
      ? eventId
      : groups[0]?.event._id;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(vehicles?.length ?? 0) > 1 && (
        <div className="px-2 pb-2">
          <select
            value={scopeVehicleId}
            onChange={(e) => setScopeVehicleId(e.target.value as Id<"vehicles">)}
            className="w-full cursor-pointer rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {(vehicles ?? []).map((v) => (
              <option key={v._id} value={v._id}>
                {v.name}
                {v._id === vehicleId ? " (this car)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="px-2 pb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search passes…"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map(({ event, files: eventFiles }) => {
          const open = toggled[event._id] ?? (query ? true : event._id === defaultOpenId);
          return (
            <div key={event._id} className="mb-1">
              <button
                onClick={() =>
                  setToggled((prev) => ({ ...prev, [event._id]: !open }))
                }
                className="flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left hover:bg-muted/50"
              >
                <ChevronRightIcon
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                    open ? "rotate-90" : ""
                  }`}
                />
                <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wider">
                  {event.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatEventDate(event.date, event.endDate)}
                </span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {eventFiles.length}
                </span>
              </button>

              {open && (
                <div className="mt-1 ml-3 space-y-2 border-l border-border/40 pl-2">
                  {eventFiles.map((file) => {
                    const isLoaded = loaded.has(file._id);
                    return (
                      <PassCard
                        key={file._id}
                        file={file}
                        timeslip={timeslips.get(file._id)?.[0]}
                        loaded={isLoaded}
                        active={isLoaded}
                        isOnlyLoaded={isLoaded && loadedFileIds.length === 1}
                        isPending={pending.has(file._id)}
                        series={trimmedSeries.get(file._id) ?? null}
                        spanSeconds={spanSeconds}
                        onToggle={() =>
                          isLoaded ? onRemoveFile(file._id) : onAddFile(file._id)
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {groups.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            {query ? `No passes match “${search}”.` : "No passes yet."}
          </p>
        )}
      </div>
    </div>
  );
}

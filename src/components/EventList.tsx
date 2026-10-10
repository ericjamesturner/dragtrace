import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { EventForm } from "./EventForm";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PlusIcon,
  MoreVerticalIcon,
  PencilIcon,
  TrashIcon,
  CalendarIcon,
  ChevronRightIcon,
  WrenchIcon,
} from "lucide-react";
import { categoryLabel, isBigChange } from "@/lib/changes";

/**
 * One labelled number in an event's stat strip. The width is fixed so the
 * columns line up down the list even when an event is missing a number.
 */
function Stat({
  label,
  value,
  width,
  strong,
  secondary,
}: {
  label: string;
  value: string | undefined;
  width: string;
  strong?: boolean;
  /** Dropped on a narrow screen, where the event name needs the room. */
  secondary?: boolean;
}) {
  return (
    <div
      className={`${width} text-right ${secondary ? "hidden md:block" : ""}`}
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {value === undefined ? " " : label}
      </div>
      <div
        className={`font-mono text-sm tabular-nums ${
          strong ? "font-semibold" : "text-muted-foreground"
        }`}
      >
        {value ?? " "}
      </div>
    </div>
  );
}

export function EventList({ vehicleId }: { vehicleId: Id<"vehicles"> }) {
  const vehicle = useQuery(api.vehicles.get, { id: vehicleId });
  const events = useQuery(api.events.listByVehicle, { vehicleId });
  const removeEvent = useMutation(api.events.remove);
  const { goToFiles, goToChanges } = useNav();
  const changes = useQuery(api.changes.listByVehicle, { vehicleId });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<Id<"events"> | null>(null);

  const files = useQuery(api.files.listByVehicle, { vehicleId });
  const slips = useQuery(api.timeslips.listByVehicle, { vehicleId });

  // The air each event ran in, from its slips' weather.
  const air = useMemo(() => {
    if (!files || !slips) return null;
    const eventOf = new Map(files.map((f) => [f._id as string, f.eventId as string]));
    const perEvent = new Map<string, { das: number[]; temps: number[] }>();
    for (const s of slips) {
      const eventId = eventOf.get(s.fileId);
      if (!eventId) continue;
      const e = perEvent.get(eventId) ?? { das: [], temps: [] };
      perEvent.set(eventId, e);
      if (s.densityAltitudeFt !== undefined) e.das.push(s.densityAltitudeFt);
      if (s.airTemperatureF !== undefined) e.temps.push(s.airTemperatureF);
    }
    return perEvent;
  }, [files, slips]);

  const range = (xs: number[], fmt: (x: number) => string) => {
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  };

  const editingEvent = editingId
    ? events?.find((e) => e._id === editingId)
    : null;

  // The car's personal best across every event, which is the number an owner
  // wants to see first.
  type EventRow = NonNullable<typeof events>[number];
  const pb = (events ?? []).reduce<EventRow | null>(
    (best, e) =>
      e.bestEt !== undefined &&
      (best === null || best.bestEt === undefined || e.bestEt < best.bestEt)
        ? e
        : best,
    null
  );

  return (
    <div className="max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h2 className="whitespace-nowrap text-lg font-semibold">{vehicle?.name ?? "..."}</h2>
        {(vehicle?.year || vehicle?.make || vehicle?.model) && (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            — {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
          </span>
        )}
        {vehicle?.raceWeightLb && (
          <span className="shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            {vehicle.raceWeightLb.toLocaleString()} lb
          </span>
        )}
        {pb?.bestEt !== undefined && (
          <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Best
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {pb.bestEt.toFixed(3)}
              {pb.bestMph !== undefined && (
                <span className="text-muted-foreground">
                  {" @ "}
                  {pb.bestMph.toFixed(2)}
                </span>
              )}
            </span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => goToChanges(vehicleId)}>
            <WrenchIcon />
            Changes
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
          >
            <PlusIcon />
            Add Event
          </Button>
        </div>
      </div>

      {vehicle?.description && (
        <p className="-mt-4 mb-6 text-sm text-muted-foreground">
          {vehicle.description}
        </p>
      )}

      {events === undefined ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading...
        </p>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No races yet. Add one, then upload your logs into it.
          </p>
          <Button
            size="sm"
            className="mt-4"
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
          >
            <PlusIcon />
            Add Event
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event, i) => (
            <Fragment key={event._id}>
            {/* Big changes made after the previous event in the list's
                timeline (the one above) and on or before this one. */}
            {(changes ?? [])
              .filter(
                (c) =>
                  isBigChange(c) &&
                  c.date >= event.date &&
                  (i === 0 || c.date < events[i - 1].date)
              )
              .map((c) => (
                <div
                  key={c._id}
                  onClick={() => goToChanges(vehicleId)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-2 text-xs transition-colors hover:bg-muted/50"
                >
                  <WrenchIcon className="size-4 shrink-0 text-amber-400" />
                  <span className="font-mono tabular-nums text-muted-foreground">{c.date}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-amber-400">
                    {categoryLabel(c.category)}
                  </span>
                  <span className="truncate">{c.title}</span>
                </div>
              ))}
            <div
              key={event._id}
              className="group flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => goToFiles(vehicleId, event._id)}
            >
              <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{event.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {event.track && `${event.track} · `}
                  {event.date}{event.endDate && event.endDate !== event.date && ` → ${event.endDate}`}
                  {event.notes && ` — ${event.notes}`}
                </div>
                {(() => {
                  const e = air?.get(event._id);
                  const parts = [
                    e && e.das.length > 0 && `D.A. ${range(e.das, (x) => x.toLocaleString())} ft`,
                    e && e.temps.length > 0 && `${range(e.temps, (x) => String(Math.round(x)))} °F`,
                  ].filter(Boolean);
                  return parts.length > 0 ? (
                    <div className="truncate text-xs text-muted-foreground">{parts.join(" · ")}</div>
                  ) : null;
                })()}
              </div>
              {event.timeslipCount === 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground/60">
                  No timeslips
                </span>
              ) : (
                <div className="flex shrink-0 items-start gap-4">
                  <Stat
                    label="60 ft"
                    width="w-12"
                    secondary
                    value={event.bestSixtyFt?.toFixed(3)}
                  />
                  <Stat
                    label="1/8"
                    width="w-12"
                    secondary
                    value={event.bestEighthEt?.toFixed(3)}
                  />
                  <Stat
                    label="Best ET"
                    width="w-32"
                    strong
                    value={
                      event.bestEt === undefined
                        ? undefined
                        : event.bestMph === undefined
                          ? event.bestEt.toFixed(3)
                          : `${event.bestEt.toFixed(3)} @ ${event.bestMph.toFixed(2)}`
                    }
                  />
                  {/* Only worth a number when a different pass went faster. */}
                  <Stat
                    label="Top MPH"
                    width="w-14"
                    secondary
                    value={
                      event.topMph !== undefined && event.topMph !== event.bestMph
                        ? event.topMph.toFixed(2)
                        : undefined
                    }
                  />
                </div>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                >
                  <MoreVerticalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(event._id);
                      setShowForm(true);
                    }}
                  >
                    <PencilIcon />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          `Delete "${event.name}" and all its files?`
                        )
                      ) {
                        void removeEvent({ id: event._id });
                      }
                    }}
                  >
                    <TrashIcon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </div>
            </Fragment>
          ))}
          {/* Big changes older than every event. */}
          {(changes ?? [])
            .filter((c) => isBigChange(c) && events.length > 0 && c.date < events[events.length - 1].date)
            .map((c) => (
              <div
                key={c._id}
                onClick={() => goToChanges(vehicleId)}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-2 text-xs transition-colors hover:bg-muted/50"
              >
                <WrenchIcon className="size-4 shrink-0 text-amber-400" />
                <span className="font-mono tabular-nums text-muted-foreground">{c.date}</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-400">
                  {categoryLabel(c.category)}
                </span>
                <span className="truncate">{c.title}</span>
              </div>
            ))}
        </div>
      )}

      <EventForm
        open={showForm}
        onOpenChange={setShowForm}
        vehicleId={vehicleId}
        event={editingEvent ?? undefined}
        onDone={() => {
          setShowForm(false);
          setEditingId(null);
        }}
      />
    </div>
  );
}

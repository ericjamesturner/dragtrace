import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon, ChevronRightIcon, CheckIcon } from "lucide-react";
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

/** Name, then the three numbers off the slip, then the two things you can do. */
const PASS_ROW = "grid grid-cols-[1fr_4rem_6.5rem_6.5rem_9.5rem] gap-3";

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

/**
 * Where you are, and how to go somewhere else: car, then weekend, then the
 * runs from it. A pass can be opened on its own or laid over what's already
 * loaded, which is the whole question anyone has about a second run.
 */
export function ViewerBreadcrumb({
  vehicleId,
  eventId,
  loadedFileIds,
  onOpen,
  onCompare,
  onGoToEvent,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  loadedFileIds: Id<"files">[];
  /** Show this pass on its own, replacing what's loaded. */
  onOpen: (vehicleId: Id<"vehicles">, eventId: Id<"events">, fileId: Id<"files">) => void;
  /** Lay this pass over what's already loaded. */
  onCompare: (fileId: Id<"files">) => void;
  /** No pass chosen yet — go to the event's file list. */
  onGoToEvent: (vehicleId: Id<"vehicles">, eventId: Id<"events">) => void;
}) {
  const vehicles = useQuery(api.vehicles.list, {});
  const events = useQuery(api.events.listByVehicle, { vehicleId });
  const files = useQuery(api.files.listByEvent, { eventId });
  const fileIds = useMemo(() => (files ?? []).map((f) => f._id), [files]);
  const timeslips = useTimeslips(fileIds);
  const { seriesByFile, spanSeconds } = usePassPreviews(files ?? [], timeslips);

  const vehicle = vehicles?.find((v) => v._id === vehicleId);
  const event = events?.find((e) => e._id === eventId);

  const loaded = useMemo(() => new Set(loadedFileIds as string[]), [loadedFileIds]);

  // Names are short and they are the label — no reason to clip them.
  const crumb = "h-7 shrink-0 gap-1 whitespace-nowrap px-2 text-sm font-normal";

  return (
    <div className="flex items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className={crumb}>
              <span>{vehicle?.name ?? "Vehicle"}</span>
              <ChevronDownIcon className="size-3.5 opacity-50" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-max">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Vehicles</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {(vehicles ?? []).map((v) => (
            <DropdownMenuItem
              key={v._id}
              onClick={() => {
                if (v._id === vehicleId) return;
                // A different car means a different set of weekends; its own
                // event list is the only sensible next question.
                onGoToEvent(v._id, eventId);
              }}
            >
              {v._id === vehicleId ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <span className="size-3.5" />
              )}
              <span className="whitespace-nowrap">{v.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/40" />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className={crumb}>
              <span>{event?.name ?? "Event"}</span>
              <ChevronDownIcon className="size-3.5 opacity-50" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-max">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Events</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {(events ?? []).map((e) => (
            <DropdownMenuItem
              key={e._id}
              onClick={() => {
                if (e._id === eventId) return;
                onGoToEvent(vehicleId, e._id);
              }}
            >
              {e._id === eventId ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <span className="size-3.5" />
              )}
              <span className="flex-1 whitespace-nowrap">{e.name}</span>
              {e.bestEt !== undefined && (
                <span className="pl-6 font-mono text-xs tabular-nums text-foreground/80">
                  {e.bestEt.toFixed(3)}
                  {e.bestMph !== undefined ? `@${e.bestMph.toFixed(2)}` : ""}
                </span>
              )}
              <span className="pl-4 text-xs text-muted-foreground">{shortDate(e.date)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/40" />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className={crumb}>
              Passes
              <span className="tabular-nums text-muted-foreground">
                {loadedFileIds.length > 0 ? loadedFileIds.length : ""}
              </span>
              <ChevronDownIcon className="size-3.5 opacity-50" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-[44rem] p-0">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-baseline justify-between px-3 pt-2.5">
              <span>Passes in this event</span>
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {files?.length ?? 0}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>

          {(files?.length ?? 0) > 0 && (
            <div className={`${PASS_ROW} border-b px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>
              <span>Run</span>
              <span className="text-right">60 ft</span>
              <span className="text-right">1/8</span>
              <span className="text-right">1/4</span>
              <span />
            </div>
          )}

          <div className="space-y-1.5 p-1.5">
            {(files ?? []).map((file) => {
              const isLoaded = loaded.has(file._id as string);
              const slip = timeslips.get(file._id)?.[0];
              return (
                <div
                  key={file._id}
                  className={`rounded-md border px-2 py-1.5 transition-colors ${
                    isLoaded ? "border-primary/50 bg-primary/10" : "hover:bg-muted/50"
                  }`}
                >
                  <div className={`${PASS_ROW} items-center text-sm`}>
                  <span className="min-w-0 truncate" title={file.fileName}>
                    {isLoaded && (
                      <span className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" />
                    )}
                    {file.fileName.replace(/\.[^.]+$/, "")}
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">
                    {slip?.sixtyFt?.toFixed(3) ?? "—"}
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">
                    {etAtMph(slip?.eighthEt, slip?.eighthMph)}
                  </span>
                  <span className="text-right font-mono font-medium tabular-nums">
                    {etAtMph(slip?.et, slip?.mph)}
                  </span>
                  <span className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => onOpen(vehicleId, eventId, file._id)}
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      disabled={isLoaded}
                      onClick={() => onCompare(file._id)}
                    >
                      {isLoaded ? "Loaded" : "Compare"}
                    </Button>
                  </span>
                  </div>
                  <PassSpark
                    series={seriesByFile.get(file._id) ?? null}
                    spanSeconds={spanSeconds}
                  />
                </div>
              );
            })}
            {(files?.length ?? 0) === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No passes in this event.
              </p>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

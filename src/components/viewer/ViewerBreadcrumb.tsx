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
import { PassCard } from "./PassCard";
import { usePassPreviews, LEAD_IN_SECONDS } from "@/hooks/usePassPreviews";
import { useTimeslips } from "@/hooks/useTimeslips";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return "";
  const year = new Date().getFullYear();
  const suffix = +m[1] !== year ? ` '${m[1].slice(2)}` : "";
  return `${MONTHS[+m[2] - 1]} ${+m[3]}${suffix}`;
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

  const crumb = "h-7 gap-1 px-2 text-sm font-normal";

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className={crumb}>
              <span className="max-w-[14ch] truncate">{vehicle?.name ?? "Vehicle"}</span>
              <ChevronDownIcon className="size-3.5 opacity-50" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
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
              {v.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/40" />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className={crumb}>
              <span className="max-w-[18ch] truncate">{event?.name ?? "Event"}</span>
              <ChevronDownIcon className="size-3.5 opacity-50" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
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
              <span className="flex-1 truncate">{e.name}</span>
              <span className="text-xs text-muted-foreground">{shortDate(e.date)}</span>
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
        <DropdownMenuContent align="start" className="max-h-[32rem] w-[24rem] overflow-y-auto">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Passes in this event</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <div className="space-y-2 p-1">
            {(files ?? []).map((file) => {
              const isLoaded = loaded.has(file._id as string);
              return (
                <PassCard
                  key={file._id}
                  file={file}
                  timeslip={timeslips.get(file._id)?.[0]}
                  loaded={isLoaded}
                  active={isLoaded}
                  series={seriesByFile.get(file._id) ?? null}
                  spanSeconds={spanSeconds}
                  leadInSeconds={LEAD_IN_SECONDS}
                  onToggle={() => onCompare(file._id)}
                  onOpen={() => onOpen(vehicleId, eventId, file._id)}
                  onCompare={() => onCompare(file._id)}
                />
              );
            })}
          </div>
          {(files?.length ?? 0) === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No passes in this event.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

import { useState } from "react";
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
} from "lucide-react";

export function EventList({ vehicleId }: { vehicleId: Id<"vehicles"> }) {
  const vehicle = useQuery(api.vehicles.get, { id: vehicleId });
  const events = useQuery(api.events.listByVehicle, { vehicleId });
  const removeEvent = useMutation(api.events.remove);
  const { goToFiles } = useNav();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<Id<"events"> | null>(null);

  const editingEvent = editingId
    ? events?.find((e) => e._id === editingId)
    : null;

  return (
    <div className="max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-2">
        <h2 className="text-lg font-semibold">{vehicle?.name ?? "..."}</h2>
        {vehicle?.description && (
          <span className="text-sm text-muted-foreground">
            — {vehicle.description}
          </span>
        )}
        <div className="ml-auto">
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

      {events === undefined ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading...
        </p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No events yet. Create one to start organizing your datalogs.
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event._id}
              className="group flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => goToFiles(vehicleId, event._id)}
            >
              <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{event.name}</div>
                <div className="text-xs text-muted-foreground">
                  {event.date}{event.endDate && event.endDate !== event.date && ` → ${event.endDate}`}
                  {event.notes && ` — ${event.notes}`}
                </div>
              </div>
              <div className="text-xs text-muted-foreground text-right shrink-0">
                {event.fileCount > 0 && (
                  <div>{event.fileCount} {event.fileCount === 1 ? "log" : "logs"}</div>
                )}
                {event.timeslipCount > 0 && (
                  <div>{event.timeslipCount} {event.timeslipCount === 1 ? "slip" : "slips"}</div>
                )}
              </div>
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

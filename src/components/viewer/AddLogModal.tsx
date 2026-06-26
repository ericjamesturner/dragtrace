import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, FileIcon, PlusIcon } from "lucide-react";

type PickerView =
  | { step: "vehicles" }
  | { step: "events"; vehicleId: Id<"vehicles">; vehicleName: string }
  | { step: "files"; vehicleId: Id<"vehicles">; vehicleName: string; eventId: Id<"events">; eventName: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentVehicleId: Id<"vehicles">;
  loadedFileIds: Id<"files">[];
  onAddFile: (fileId: Id<"files">) => void;
}

export function AddLogModal({ open, onOpenChange, currentVehicleId, loadedFileIds, onAddFile }: Props) {
  const [view, setView] = useState<PickerView>({
    step: "events",
    vehicleId: currentVehicleId,
    vehicleName: "",
  });

  // Reset to current vehicle's events when opened
  const handleOpenChange = (o: boolean) => {
    if (o) {
      setView({ step: "events", vehicleId: currentVehicleId, vehicleName: "" });
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Log</DialogTitle>
        </DialogHeader>
        {view.step === "vehicles" && (
          <VehiclePicker
            onSelect={(id, name) => setView({ step: "events", vehicleId: id, vehicleName: name })}
          />
        )}
        {view.step === "events" && (
          <EventPicker
            vehicleId={view.vehicleId}
            vehicleName={view.vehicleName}
            onBack={() => setView({ step: "vehicles" })}
            onSelect={(eventId, eventName) =>
              setView({
                step: "files",
                vehicleId: view.vehicleId,
                vehicleName: view.vehicleName,
                eventId,
                eventName,
              })
            }
          />
        )}
        {view.step === "files" && (
          <FilePicker
            eventId={view.eventId}
            eventName={view.eventName}
            vehicleName={view.vehicleName}
            loadedFileIds={loadedFileIds}
            onBack={() =>
              setView({
                step: "events",
                vehicleId: view.vehicleId,
                vehicleName: view.vehicleName,
              })
            }
            onSelect={(fileId) => {
              onAddFile(fileId);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function VehiclePicker({ onSelect }: { onSelect: (id: Id<"vehicles">, name: string) => void }) {
  const vehicles = useQuery(api.vehicles.list);

  return (
    <div className="space-y-1 max-h-80 overflow-y-auto">
      <p className="text-xs text-muted-foreground mb-2">Select a vehicle</p>
      {vehicles === undefined ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
      ) : vehicles.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No vehicles found</p>
      ) : (
        vehicles.map((v) => (
          <button
            key={v._id}
            onClick={() => onSelect(v._id, v.name)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm hover:bg-muted cursor-pointer text-left"
          >
            <span className="flex-1">{v.name}</span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </button>
        ))
      )}
    </div>
  );
}

function EventPicker({
  vehicleId,
  vehicleName,
  onBack,
  onSelect,
}: {
  vehicleId: Id<"vehicles">;
  vehicleName: string;
  onBack: () => void;
  onSelect: (eventId: Id<"events">, eventName: string) => void;
}) {
  const vehicle = useQuery(api.vehicles.get, { id: vehicleId });
  const events = useQuery(api.events.listByVehicle, { vehicleId });
  const displayName = vehicleName || vehicle?.name || "...";

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 cursor-pointer"
      >
        <ChevronLeftIcon className="size-3" />
        All Vehicles
      </button>
      <p className="text-sm font-medium mb-2">{displayName}</p>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {events === undefined ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No events</p>
        ) : (
          events.map((ev) => (
            <button
              key={ev._id}
              onClick={() => onSelect(ev._id, ev.name)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm hover:bg-muted cursor-pointer text-left"
            >
              <div className="flex-1 min-w-0">
                <div>{ev.name}</div>
                {ev.date && (
                  <div className="text-xs text-muted-foreground">{ev.date}</div>
                )}
              </div>
              <ChevronRightIcon className="size-4 text-muted-foreground shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function FilePicker({
  eventId,
  eventName,
  vehicleName,
  loadedFileIds,
  onBack,
  onSelect,
}: {
  eventId: Id<"events">;
  eventName: string;
  vehicleName: string;
  loadedFileIds: Id<"files">[];
  onBack: () => void;
  onSelect: (fileId: Id<"files">) => void;
}) {
  const files = useQuery(api.files.listByEvent, { eventId });

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 cursor-pointer"
      >
        <ChevronLeftIcon className="size-3" />
        {vehicleName || "Back"}
      </button>
      <p className="text-sm font-medium mb-2">{eventName}</p>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {files === undefined ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No files</p>
        ) : (
          files.map((f) => {
            const isLoaded = loadedFileIds.includes(f._id);
            return (
              <div
                key={f._id}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                  isLoaded ? "opacity-50" : "hover:bg-muted cursor-pointer"
                }`}
                onClick={isLoaded ? undefined : () => onSelect(f._id)}
              >
                <FileIcon className="size-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{f.fileName.replace(/\.[^.]+$/, "")}</span>
                {isLoaded ? (
                  <span className="text-xs text-muted-foreground">Loaded</span>
                ) : (
                  <PlusIcon className="size-4 text-muted-foreground" />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

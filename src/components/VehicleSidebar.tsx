import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { VehicleForm } from "./VehicleForm";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlusIcon, MoreVerticalIcon, PencilIcon, TrashIcon, CarIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

export function VehicleSidebar({ onSelect }: { onSelect?: () => void }) {
  const vehicles = useQuery(api.vehicles.list);
  const removeVehicle = useMutation(api.vehicles.remove);
  const { nav, goToEvents } = useNav();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<Id<"vehicles"> | null>(null);

  const selectedId = "vehicleId" in nav ? nav.vehicleId : null;

  const editingVehicle = editingId
    ? vehicles?.find((v) => v._id === editingId)
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">
          Vehicles
        </span>
        <Tip content="Add vehicle">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
          >
            <PlusIcon />
          </Button>
        </Tip>
      </div>

      <ScrollArea className="flex-1">
        {vehicles === undefined ? (
          <p className="px-4 py-2 text-xs text-muted-foreground">Loading...</p>
        ) : vehicles.length === 0 ? (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            No vehicles yet. Add one above.
          </p>
        ) : (
          <div className="px-2">
            {vehicles.map((vehicle) => (
              <div
                key={vehicle._id}
                className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer ${
                  selectedId === vehicle._id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => {
                  goToEvents(vehicle._id);
                  onSelect?.();
                }}
              >
                <CarIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{vehicle.name}</span>
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
                        setEditingId(vehicle._id);
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
                            `Delete "${vehicle.name}" and all its events and files?`
                          )
                        ) {
                          void removeVehicle({ id: vehicle._id });
                        }
                      }}
                    >
                      <TrashIcon />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <VehicleForm
        open={showForm}
        onOpenChange={setShowForm}
        vehicle={editingVehicle ?? undefined}
        onDone={() => {
          setShowForm(false);
          setEditingId(null);
        }}
      />
    </div>
  );
}

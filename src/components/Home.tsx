import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { VehicleForm } from "./VehicleForm";
import { Button } from "@/components/ui/button";
import { CarIcon, ChevronRightIcon, PlusIcon } from "lucide-react";

/**
 * The main area when no car is picked. A brand-new account gets a welcome with
 * one obvious next step; an account with cars gets clickable cards — which also
 * makes the app usable on a phone, where the sidebar is behind the menu.
 */
export function Home() {
  const vehicles = useQuery(api.vehicles.list);
  const { goToEvents } = useNav();
  const [showForm, setShowForm] = useState(false);

  if (vehicles === undefined) return null;

  const vehicleDetails = (vehicle: Doc<"vehicles">) => {
    const identity = [vehicle.year, vehicle.make, vehicle.model]
      .filter((part) => part !== undefined && part !== "")
      .join(" ");
    const weight = vehicle.raceWeightLb
      ? `${vehicle.raceWeightLb.toLocaleString()} lb race weight`
      : "";
    return [identity, weight, vehicle.description].filter(Boolean).join(" · ");
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      {vehicles.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <CarIcon className="size-7 text-muted-foreground" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight">
            Welcome to DragTrace
          </h2>
          <p className="mt-2 max-w-sm text-muted-foreground">
            Start by adding your car. Then create a race and upload your first
            log.
          </p>
          <Button className="mt-6" onClick={() => setShowForm(true)}>
            <PlusIcon />
            Add your car
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between pt-2">
            <h2 className="text-lg font-semibold">Your cars</h2>
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              <PlusIcon />
              Add a car
            </Button>
          </div>
          <div className="space-y-2">
            {vehicles.map((v) => (
              <button
                key={v._id}
                onClick={() => goToEvents(v._id)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <CarIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {v.name}
                  </span>
                  {vehicleDetails(v) && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {vehicleDetails(v)}
                    </span>
                  )}
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </>
      )}

      <VehicleForm
        open={showForm}
        onOpenChange={setShowForm}
        onDone={(createdId) => {
          setShowForm(false);
          // Straight into the new car — no hunting for what just happened.
          if (createdId) goToEvents(createdId);
        }}
      />
    </div>
  );
}

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useNav } from "./Layout";
import { UnitsPanel } from "./UnitsPanel";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Account-wide display settings, plus the per-vehicle exceptions to them. Both
 * live on one page because the whole point is seeing what a vehicle changes
 * relative to your defaults.
 */
export function Preferences() {
  const { goToVehicles } = useNav();
  const vehicles = useQuery(api.vehicles.list, {});
  const [scope, setScope] = useState<Id<"vehicles"> | null>(null);

  const activeVehicle = vehicles?.find((v) => v._id === scope);

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={goToVehicles}>
          <ArrowLeftIcon />
        </Button>
        <h2 className="text-lg font-semibold">Preferences</h2>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r p-2">
          <button
            onClick={() => setScope(null)}
            className={`w-full rounded px-2 py-1.5 text-left text-sm ${
              scope === null ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"
            }`}
          >
            My defaults
          </button>
          <div className="mt-3 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Per vehicle
          </div>
          {(vehicles ?? []).map((v) => (
            <button
              key={v._id}
              onClick={() => setScope(v._id)}
              className={`mt-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                scope === v._id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <span className="flex-1 truncate">{v.name}</span>
              {v.unitOverrides && v.unitOverrides !== "{}" && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                  title="Has overrides"
                />
              )}
            </button>
          ))}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl space-y-4">
            <div>
              <h3 className="text-base font-semibold">
                {scope === null ? "Units" : `Units — ${activeVehicle?.name ?? ""}`}
              </h3>
              <p className="text-sm text-muted-foreground">
                {scope === null
                  ? "How values are displayed everywhere, unless a vehicle overrides them."
                  : "Only what differs for this vehicle. Everything else follows your defaults."}
              </p>
            </div>
            <UnitsPanel
              key={scope ?? "user"}
              vehicleId={scope ?? undefined}
              vehicleName={activeVehicle?.name}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

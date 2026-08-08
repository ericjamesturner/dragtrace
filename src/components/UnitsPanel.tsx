import { useMemo, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { quantitiesWithChoices, resolveUnitKey, type UnitSystem } from "@/lib/units";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Unit picker for one quantity per row, following the convention Haltech users
 * already know: Metric/Imperial are presets that set everything at once, and
 * individual quantities are then adjusted on top.
 *
 * With a vehicle, edits are scoped to that vehicle and inherited values are
 * labelled — so a methanol car can differ on AFR alone without restating every
 * other unit.
 */
export function UnitsPanel({
  vehicleId,
  vehicleName,
}: {
  vehicleId?: Id<"vehicles">;
  vehicleName?: string;
}) {
  const prefs = useUnitPreferences(vehicleId);
  const [filter, setFilter] = useState("");
  const scope: "user" | "vehicle" = vehicleId ? "vehicle" : "user";

  const quantities = useMemo(() => {
    const all = quantitiesWithChoices().sort((a, b) => a.name.localeCompare(b.name));
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter(
      (q) =>
        q.name.toLowerCase().includes(f) ||
        q.alternates.some((a) => a.label.toLowerCase().includes(f)),
    );
  }, [filter]);

  if (prefs.loading) {
    return <p className="text-sm text-muted-foreground">Loading units…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {vehicleId ? `Overrides for ${vehicleName ?? "this vehicle"}` : "Preset"}
        </span>
        {!vehicleId && (
          <>
            {(["metric", "imperial"] as UnitSystem[]).map((system) => (
              <Button
                key={system}
                size="sm"
                variant={prefs.unitSystem === system ? "default" : "outline"}
                onClick={() => prefs.setUserSystem(system)}
              >
                {system === "metric" ? "Metric" : "Imperial"}
              </Button>
            ))}
          </>
        )}
        {vehicleId && Object.keys(prefs.vehicleOverrides).length > 0 && (
          <Button size="sm" variant="outline" onClick={() => prefs.setVehicleOverrides({})}>
            Reset all to inherited
          </Button>
        )}
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter quantities…"
          className="ml-auto h-8 w-48"
        />
      </div>

      {vehicleId && (
        <p className="text-xs text-muted-foreground">
          Anything left on “Inherit” follows your account preferences.
        </p>
      )}

      <div className="divide-y rounded-md border">
        {quantities.map((q) => {
          const overridden = scope === "vehicle" && q.slug in prefs.vehicleOverrides;
          const effective = resolveUnitKey(q.slug, prefs.unitSystem, prefs.resolved);
          // Within a quantity the vendor sometimes lists the same label twice;
          // showing it twice in a dropdown is just confusing.
          const seen = new Set<string>();
          const options = q.alternates.filter((a) => {
            if (seen.has(a.label)) return false;
            seen.add(a.label);
            return true;
          });

          return (
            <div key={q.slug} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1 truncate text-sm">{q.name}</span>
              {overridden && (
                <button
                  onClick={() => prefs.clearVehicleQuantity(q.slug)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  inherit
                </button>
              )}
              <select
                value={overridden || scope === "user" ? effective : "__inherit__"}
                onChange={(e) => {
                  if (e.target.value === "__inherit__") prefs.clearVehicleQuantity(q.slug);
                  else prefs.setQuantity(q.slug, e.target.value, scope);
                }}
                className="h-8 min-w-40 rounded-md border bg-background px-2 text-sm"
              >
                {scope === "vehicle" && (
                  <option value="__inherit__">
                    Inherit ({q.alternates.find((a) => a.key === effective)?.label.trim() ?? "—"})
                  </option>
                )}
                {options.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label.trim() || "raw"}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        {quantities.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No quantities match “{filter}”.
          </p>
        )}
      </div>
    </div>
  );
}

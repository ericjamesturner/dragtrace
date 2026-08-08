import { useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { UnitSystem, UnitOverrides } from "@/lib/units";

function parseOverrides(raw: string | undefined | null): UnitOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as UnitOverrides;
    }
  } catch {
    // A corrupt preference blob shouldn't stop the viewer rendering.
  }
  return {};
}

export interface UnitPreferences {
  /** The baseline preset the user's unset quantities fall back to. */
  unitSystem: UnitSystem;
  /** What the user chose, before this vehicle's overrides. */
  userOverrides: UnitOverrides;
  /** What this vehicle overrides on top. */
  vehicleOverrides: UnitOverrides;
  /** The two merged — what the viewer should actually display in. */
  resolved: UnitOverrides;
  loading: boolean;
  setUserSystem: (system: UnitSystem) => void;
  setUserOverrides: (overrides: UnitOverrides) => void;
  setVehicleOverrides: (overrides: UnitOverrides) => void;
  /** Change one quantity at whichever level the user is working in. */
  setQuantity: (slug: string, alternateKey: string, scope: "user" | "vehicle") => void;
  /** Drop a vehicle's override so the quantity inherits again. */
  clearVehicleQuantity: (slug: string) => void;
}

/**
 * Display units resolved for a vehicle: the user's preferences, with that
 * vehicle's overrides on top. Pass no vehicle to work with user-level only.
 */
export function useUnitPreferences(vehicleId?: Id<"vehicles">): UnitPreferences {
  const prefs = useQuery(api.userPreferences.get, {});
  const vehicle = useQuery(api.vehicles.get, vehicleId ? { id: vehicleId } : "skip");

  const setUnits = useMutation(api.userPreferences.setUnits);
  const setVehicleUnits = useMutation(api.vehicles.setUnitOverrides);

  const unitSystem = (prefs?.unitSystem as UnitSystem | undefined) ?? "imperial";
  const userOverrides = useMemo(() => parseOverrides(prefs?.unitOverrides), [prefs?.unitOverrides]);
  const vehicleOverrides = useMemo(
    () => parseOverrides(vehicle?.unitOverrides),
    [vehicle?.unitOverrides],
  );
  const resolved = useMemo(
    () => ({ ...userOverrides, ...vehicleOverrides }),
    [userOverrides, vehicleOverrides],
  );

  const setUserSystem = useCallback(
    (system: UnitSystem) => {
      // Switching preset means "show me imperial", so per-quantity choices made
      // against the old preset are cleared rather than silently surviving it.
      void setUnits({ unitSystem: system, unitOverrides: "{}" });
    },
    [setUnits],
  );

  const setUserOverrides = useCallback(
    (overrides: UnitOverrides) => {
      void setUnits({ unitOverrides: JSON.stringify(overrides) });
    },
    [setUnits],
  );

  const setVehicleOverrides = useCallback(
    (overrides: UnitOverrides) => {
      if (!vehicleId) return;
      void setVehicleUnits({ id: vehicleId, unitOverrides: JSON.stringify(overrides) });
    },
    [setVehicleUnits, vehicleId],
  );

  const setQuantity = useCallback(
    (slug: string, alternateKey: string, scope: "user" | "vehicle") => {
      if (scope === "vehicle") {
        setVehicleOverrides({ ...vehicleOverrides, [slug]: alternateKey });
      } else {
        setUserOverrides({ ...userOverrides, [slug]: alternateKey });
      }
    },
    [setVehicleOverrides, setUserOverrides, vehicleOverrides, userOverrides],
  );

  const clearVehicleQuantity = useCallback(
    (slug: string) => {
      const next = { ...vehicleOverrides };
      delete next[slug];
      setVehicleOverrides(next);
    },
    [setVehicleOverrides, vehicleOverrides],
  );

  return {
    unitSystem,
    userOverrides,
    vehicleOverrides,
    resolved,
    loading: prefs === undefined || (vehicleId !== undefined && vehicle === undefined),
    setUserSystem,
    setUserOverrides,
    setVehicleOverrides,
    setQuantity,
    clearVehicleQuantity,
  };
}

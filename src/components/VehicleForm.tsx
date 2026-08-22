import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface VehicleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle?: Doc<"vehicles">;
  /** Receives the new vehicle id on create, so callers can jump straight in. */
  onDone: (createdId?: Id<"vehicles">) => void;
}

export function VehicleForm({
  open,
  onOpenChange,
  vehicle,
  onDone,
}: VehicleFormProps) {
  // Mounting the form only while the dialog is open gives every edit a fresh
  // draft without synchronizing local form state from an effect.
  if (!open) return null;
  return (
    <OpenVehicleForm
      open={open}
      onOpenChange={onOpenChange}
      vehicle={vehicle}
      onDone={onDone}
    />
  );
}

function OpenVehicleForm({
  open,
  onOpenChange,
  vehicle,
  onDone,
}: VehicleFormProps) {
  const createVehicle = useMutation(api.vehicles.create);
  const updateVehicle = useMutation(api.vehicles.update);
  const [name, setName] = useState(vehicle?.name ?? "");
  const [year, setYear] = useState(
    vehicle?.year !== undefined ? String(vehicle.year) : ""
  );
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [raceWeightLb, setRaceWeightLb] = useState(
    vehicle?.raceWeightLb !== undefined ? String(vehicle.raceWeightLb) : ""
  );
  const [description, setDescription] = useState(vehicle?.description ?? "");

  const isEdit = !!vehicle;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const details = {
      year: year.trim() ? Number(year) : undefined,
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      raceWeightLb: raceWeightLb.trim() ? Number(raceWeightLb) : undefined,
    };
    if (isEdit) {
      await updateVehicle({
        id: vehicle._id,
        name: name.trim(),
        ...details,
        description: description.trim() || undefined,
      });
      onDone();
    } else {
      const createdId = await createVehicle({
        name: name.trim(),
        ...details,
        description: description.trim() || undefined,
      });
      onDone(createdId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Vehicle" : "Add Vehicle"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="vehicle-name">Name</Label>
            <Input
              id="vehicle-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sonoma Truck"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_1fr_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="vehicle-year">Year</Label>
              <Input
                id="vehicle-year"
                type="number"
                min={1886}
                max={new Date().getFullYear() + 1}
                step={1}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="1970"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vehicle-make">Make</Label>
              <Input
                id="vehicle-make"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="Chevrolet"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vehicle-model">Model</Label>
              <Input
                id="vehicle-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Nova"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vehicle-race-weight">Race weight (lb)</Label>
            <Input
              id="vehicle-race-weight"
              type="number"
              min={1}
              max={100000}
              step="any"
              value={raceWeightLb}
              onChange={(e) => setRaceWeightLb(e.target.value)}
              placeholder="e.g. 3,450"
            />
            <p className="text-xs text-muted-foreground">
              Total as-raced weight, including the driver, fuel, and ballast.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vehicle-desc">Description (optional)</Label>
            <Textarea
              id="vehicle-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mods, setup notes, etc."
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              {isEdit ? "Save" : "Add Vehicle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

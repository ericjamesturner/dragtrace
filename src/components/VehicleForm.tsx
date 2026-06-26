import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
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
  onDone: () => void;
}

export function VehicleForm({
  open,
  onOpenChange,
  vehicle,
  onDone,
}: VehicleFormProps) {
  const createVehicle = useMutation(api.vehicles.create);
  const updateVehicle = useMutation(api.vehicles.update);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const isEdit = !!vehicle;

  useEffect(() => {
    if (open) {
      setName(vehicle?.name ?? "");
      setDescription(vehicle?.description ?? "");
    }
  }, [open, vehicle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (isEdit) {
      await updateVehicle({
        id: vehicle._id,
        name: name.trim(),
        description: description.trim() || undefined,
      });
    } else {
      await createVehicle({
        name: name.trim(),
        description: description.trim() || undefined,
      });
    }
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
              placeholder="e.g. 2018 Miata ND2"
              autoFocus
            />
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

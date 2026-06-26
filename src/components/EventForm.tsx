import { useState, useEffect } from "react";
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

interface EventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: Id<"vehicles">;
  event?: Doc<"events">;
  onDone: () => void;
}

function daysFromDates(start: string, end: string | undefined): string {
  if (!end || !start) return "1";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
  return days > 1 ? String(days) : "1";
}

function addDays(start: string, days: number): string {
  const d = new Date(start);
  d.setDate(d.getDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

export function EventForm({
  open,
  onOpenChange,
  vehicleId,
  event,
  onDone,
}: EventFormProps) {
  const createEvent = useMutation(api.events.create);
  const updateEvent = useMutation(api.events.update);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [days, setDays] = useState("1");
  const [notes, setNotes] = useState("");

  const isEdit = !!event;

  useEffect(() => {
    if (open) {
      setName(event?.name ?? "");
      setDate(event?.date ?? new Date().toISOString().slice(0, 10));
      setDays(event ? daysFromDates(event.date, event.endDate) : "1");
      setNotes(event?.notes ?? "");
    }
  }, [open, event]);

  const daysNum = parseInt(days) || 1;
  const endDate = daysNum > 1 && date ? addDays(date, daysNum) : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date) return;
    if (isEdit) {
      await updateEvent({
        id: event._id,
        name: name.trim(),
        date,
        endDate,
        notes: notes.trim() || undefined,
      });
    } else {
      await createEvent({
        vehicleId,
        name: name.trim(),
        date,
        endDate,
        notes: notes.trim() || undefined,
      });
    }
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Event" : "Add Event"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="event-name">Name</Label>
            <Input
              id="event-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Track Day at Laguna Seca"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="event-days">Event Length (days)</Label>
              <Input
                id="event-days"
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
          </div>
          {endDate && (
            <p className="text-xs text-muted-foreground -mt-2">
              {date} → {endDate}
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="event-notes">Notes (optional)</Label>
            <Textarea
              id="event-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Weather, tire pressures, setup changes..."
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || !date}>
              {isEdit ? "Save" : "Add Event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

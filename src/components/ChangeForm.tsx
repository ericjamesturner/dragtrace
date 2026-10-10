import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHANGE_CATEGORIES } from "@/lib/changes";
import { runLabel } from "@/lib/tune-changes";

const selectClass = "h-9 w-full cursor-pointer rounded-md border bg-background px-2 text-sm";

/**
 * Log or edit a change to the car. "After pass" pins a change made between
 * rounds to the pass it followed; without one, the date places it.
 */
export function ChangeForm({
  open,
  onOpenChange,
  vehicleId,
  change,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: Id<"vehicles">;
  change?: Doc<"changes">;
}) {
  const create = useMutation(api.changes.create);
  const update = useMutation(api.changes.update);
  const files = useQuery(api.files.listByVehicle, open ? { vehicleId } : "skip");
  const events = useQuery(api.events.listByVehicle, open ? { vehicleId } : "skip");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("converter");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [afterFileId, setAfterFileId] = useState("");

  useEffect(() => {
    if (!open) return;
    setDate(change?.date ?? new Date().toISOString().slice(0, 10));
    setCategory(change?.category ?? "converter");
    setTitle(change?.title ?? "");
    setNotes(change?.notes ?? "");
    setAfterFileId(change?.afterFileId ?? "");
  }, [open, change]);

  // The car's passes by event, newest event first, each in run order.
  const passGroups = useMemo(() => {
    if (!files || !events) return [];
    return [...events]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .map((e) => ({
        event: e,
        files: files.filter((f) => f.eventId === e._id).sort((a, b) => (b.order ?? 0) - (a.order ?? 0)),
      }))
      .filter((g) => g.files.length > 0);
  }, [files, events]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    const fields = {
      date,
      category,
      title: title.trim(),
      notes: notes.trim() || undefined,
      afterFileId: (afterFileId || undefined) as Id<"files"> | undefined,
    };
    if (change) await update({ id: change._id, ...fields });
    else await create({ vehicleId, ...fields });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{change ? "Edit change" : "Log a change"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="change-date">Date</Label>
              <Input id="change-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="change-category">What</Label>
              <select
                id="change-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={selectClass}
              >
                {CHANGE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="change-title">Change</Label>
            <Input
              id="change-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Looser converter, 300 rpm more flash"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="change-after">After pass (optional)</Label>
            <select
              id="change-after"
              value={afterFileId}
              onChange={(e) => setAfterFileId(e.target.value)}
              className={selectClass}
            >
              <option value="">Between events</option>
              {passGroups.map(({ event, files: eventFiles }) => (
                <optgroup key={event._id} label={`${event.name} · ${event.date}`}>
                  {eventFiles.map((f) => (
                    <option key={f._id} value={f._id}>
                      {f.round ?? runLabel(f.fileName)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="change-notes">Notes (optional)</Label>
            <Textarea id="change-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!title.trim() || !date}>
              {change ? "Save" : "Log change"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

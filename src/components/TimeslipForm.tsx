import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CameraIcon, Loader2Icon } from "lucide-react";

interface TimeslipFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: Id<"files">;
  timeslip?: Doc<"timeslips">;
  onDone: () => void;
}

type FieldKey = "dialIn" | "rt" | "sixtyFt" | "threeThirty" | "eighthEt" | "eighthMph" | "thousandFt" | "et" | "mph";

const fieldKeys: FieldKey[] = ["dialIn", "rt", "sixtyFt", "threeThirty", "eighthEt", "eighthMph", "thousandFt", "et", "mph"];

export function TimeslipForm({
  open,
  onOpenChange,
  fileId,
  timeslip,
  onDone,
}: TimeslipFormProps) {
  const createTimeslip = useMutation(api.timeslips.create);
  const updateTimeslip = useMutation(api.timeslips.update);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const parseTimeslipImage = useAction(api.timeslips.parseTimeslipImage);
  const [values, setValues] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const isEdit = !!timeslip;

  const handleScan = useCallback(
    async (file: File) => {
      setScanning(true);
      try {
        // Upload image to Convex storage
        const uploadUrl = await generateUploadUrl();
        const uploadResult = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const { storageId } = await uploadResult.json();

        // Call Claude to parse the timeslip
        const parsed = await parseTimeslipImage({ storageId });

        // Pre-fill form with parsed values
        setValues((prev) => {
          const next = { ...prev };
          for (const [key, val] of Object.entries(parsed)) {
            if (typeof val === "number") {
              next[key] = String(val);
            }
          }
          return next;
        });
      } finally {
        setScanning(false);
        if (scanInputRef.current) scanInputRef.current.value = "";
      }
    },
    [generateUploadUrl, parseTimeslipImage]
  );

  useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const key of fieldKeys) {
        const val = timeslip?.[key];
        initial[key] = val !== undefined ? String(val) : "";
      }
      setValues(initial);
    }
  }, [open, timeslip]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed: Record<string, number | undefined> = {};
    for (const key of fieldKeys) {
      const v = values[key]?.trim();
      parsed[key] = v ? parseFloat(v) : undefined;
    }
    if (isEdit) {
      await updateTimeslip({
        id: timeslip._id,
        ...parsed,
      } as Parameters<typeof updateTimeslip>[0]);
    } else {
      await createTimeslip({
        fileId,
        ...parsed,
      } as Parameters<typeof createTimeslip>[0]);
    }
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Timeslip" : "Add Timeslip"}</DialogTitle>
        </DialogHeader>
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleScan(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={scanning}
          onClick={() => scanInputRef.current?.click()}
        >
          {scanning ? (
            <>
              <Loader2Icon className="animate-spin" />
              Reading timeslip...
            </>
          ) : (
            <>
              <CameraIcon />
              Scan timeslip photo
            </>
          )}
        </Button>
        <form onSubmit={handleSubmit}>
          <div className="rounded-md border bg-muted/30 px-4 py-3 font-mono text-sm space-y-1">
            <TimeslipField
              label="DIAL"
              id="ts-dialIn"
              value={values.dialIn ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, dialIn: v }))}
            />

            <TimeslipField
              label="R.T."
              id="ts-rt"
              value={values.rt ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, rt: v }))}
            />

            <Separator className="my-2" />

            <TimeslipField
              label="60'"
              id="ts-sixtyFt"
              value={values.sixtyFt ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, sixtyFt: v }))}
            />
            <TimeslipField
              label="330'"
              id="ts-threeThirty"
              value={values.threeThirty ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, threeThirty: v }))}
            />

            <Separator className="my-2" />

            <TimeslipField
              label="1/8"
              id="ts-eighthEt"
              value={values.eighthEt ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, eighthEt: v }))}
            />
            <TimeslipField
              label="MPH"
              id="ts-eighthMph"
              value={values.eighthMph ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, eighthMph: v }))}
            />

            <Separator className="my-2" />

            <TimeslipField
              label="1000'"
              id="ts-thousandFt"
              value={values.thousandFt ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, thousandFt: v }))}
            />

            <Separator className="my-2" />

            <TimeslipField
              label="E.T."
              id="ts-et"
              value={values.et ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, et: v }))}
              bold
            />
            <TimeslipField
              label="MPH"
              id="ts-mph"
              value={values.mph ?? ""}

              onChange={(v) => setValues((p) => ({ ...p, mph: v }))}
              bold
            />
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit">{isEdit ? "Save" : "Add Timeslip"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimeslipField({
  label,
  id,
  value,
  onChange,
  bold,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className={`text-xs text-muted-foreground shrink-0 w-10 ${bold ? "font-bold" : ""}`}>
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-24 text-right font-mono ${bold ? "font-bold" : ""}`}
      />
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  /** The pass's current round — lives on the file, not the slip. */
  round?: string;
  timeslip?: Doc<"timeslips">;
  onDone: () => void;
}

type FieldKey =
  | "dialIn"
  | "delayBox"
  | "rt"
  | "sixtyFt"
  | "threeThirty"
  | "eighthEt"
  | "eighthMph"
  | "thousandFt"
  | "et"
  | "mph"
  | "airTemperatureF"
  | "trackTemperatureF"
  | "humidityPct"
  | "barometricPressureInHg"
  | "densityAltitudeFt"
  | "windSpeedMph";

const fieldKeys: FieldKey[] = [
  "dialIn",
  "delayBox",
  "rt",
  "sixtyFt",
  "threeThirty",
  "eighthEt",
  "eighthMph",
  "thousandFt",
  "et",
  "mph",
  "airTemperatureF",
  "trackTemperatureF",
  "humidityPct",
  "barometricPressureInHg",
  "densityAltitudeFt",
  "windSpeedMph",
];

export function TimeslipForm({
  open,
  onOpenChange,
  fileId,
  round,
  timeslip,
  onDone,
}: TimeslipFormProps) {
  const createTimeslip = useMutation(api.timeslips.create);
  const updateTimeslip = useMutation(api.timeslips.update);
  const updateRound = useMutation(api.files.updateRound);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const claimTempUpload = useMutation(api.timeslips.claimTempUpload);
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

        // Record ownership of the scratch object before the action reads it.
        await claimTempUpload({ storageId });

        // Call Claude to parse the timeslip
        const parsed = await parseTimeslipImage({ storageId });

        // Pre-fill form with parsed values
        setValues((prev) => {
          const next = { ...prev };
          for (const [key, val] of Object.entries(parsed)) {
            if (typeof val === "number") {
              next[key] = String(val);
            } else if (
              key === "round" &&
              typeof val === "string" &&
              val.trim()
            ) {
              next.round = val.trim().toUpperCase();
            }
          }
          return next;
        });
      } finally {
        setScanning(false);
        if (scanInputRef.current) scanInputRef.current.value = "";
      }
    },
    [generateUploadUrl, claimTempUpload, parseTimeslipImage],
  );

  useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const key of fieldKeys) {
        const val = timeslip?.[key];
        initial[key] = val !== undefined ? String(val) : "";
      }
      initial.round = round ?? timeslip?.round ?? "";
      initial.lane = timeslip?.lane ?? "";
      initial.windDirection = timeslip?.windDirection ?? "";
      setValues(initial);
    }
  }, [open, timeslip, round]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed: Record<string, number | undefined> = {};
    for (const key of fieldKeys) {
      const v = values[key]?.trim();
      const number = v ? Number(v) : undefined;
      parsed[key] =
        number !== undefined && Number.isFinite(number) ? number : undefined;
    }
    const conditions = {
      lane:
        values.lane === "left" || values.lane === "right"
          ? values.lane
          : undefined,
      windDirection: values.windDirection?.trim() || undefined,
    } as const;
    // The round belongs to the pass, not the slip.
    await updateRound({
      id: fileId,
      round: values.round?.trim()
        ? values.round.trim().toUpperCase()
        : undefined,
    });
    if (isEdit) {
      await updateTimeslip({
        id: timeslip._id,
        ...parsed,
        ...conditions,
      } as Parameters<typeof updateTimeslip>[0]);
    } else {
      await createTimeslip({
        fileId,
        ...parsed,
        ...conditions,
      } as Parameters<typeof createTimeslip>[0]);
    }
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border bg-muted/30 px-4 py-3 font-mono text-sm space-y-1">
              <div className="mb-2 font-sans text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Timeslip
              </div>
              {/* The round is free text — T1, Q2, E3, whatever the track calls it. */}
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="ts-round"
                  className="text-xs text-muted-foreground shrink-0 w-10"
                >
                  ROUND
                </Label>
                <Input
                  id="ts-round"
                  type="text"
                  placeholder="Q1"
                  value={values.round ?? ""}
                  onChange={(e) =>
                    setValues((p) => ({
                      ...p,
                      round: e.target.value.toUpperCase(),
                    }))
                  }
                  className="w-24 text-right font-mono uppercase"
                />
              </div>

              <Separator className="my-2" />

              <TimeslipField
                label="DIAL"
                id="ts-dialIn"
                value={values.dialIn ?? ""}
                onChange={(v) => setValues((p) => ({ ...p, dialIn: v }))}
              />
              <TimeslipField
                label="BOX"
                id="ts-delayBox"
                value={values.delayBox ?? ""}
                onChange={(v) => setValues((p) => ({ ...p, delayBox: v }))}
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
                label="1/4"
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

            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
              <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Run conditions{" "}
                <span className="normal-case tracking-normal">(optional)</span>
              </div>

              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ts-lane">Lane</Label>
                  <Select
                    items={{ left: "Left", right: "Right" }}
                    value={values.lane || null}
                    onValueChange={(value) =>
                      setValues((p) => ({ ...p, lane: value ?? "" }))
                    }
                  >
                    <SelectTrigger id="ts-lane" className="w-full">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value={null}>Not set</SelectItem>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <WeatherField
                    label="Air temp"
                    unit="°F"
                    id="ts-air-temp"
                    value={values.airTemperatureF ?? ""}
                    onChange={(v) =>
                      setValues((p) => ({ ...p, airTemperatureF: v }))
                    }
                  />
                  <WeatherField
                    label="Track temp"
                    unit="°F"
                    id="ts-track-temp"
                    value={values.trackTemperatureF ?? ""}
                    onChange={(v) =>
                      setValues((p) => ({ ...p, trackTemperatureF: v }))
                    }
                  />
                  <WeatherField
                    label="Humidity"
                    unit="%"
                    id="ts-humidity"
                    value={values.humidityPct ?? ""}
                    onChange={(v) =>
                      setValues((p) => ({ ...p, humidityPct: v }))
                    }
                    min={0}
                    max={100}
                  />
                  <WeatherField
                    label="Barometer"
                    unit="inHg"
                    id="ts-barometer"
                    value={values.barometricPressureInHg ?? ""}
                    onChange={(v) =>
                      setValues((p) => ({ ...p, barometricPressureInHg: v }))
                    }
                  />
                  <WeatherField
                    label="Density altitude"
                    unit="ft"
                    id="ts-density-altitude"
                    value={values.densityAltitudeFt ?? ""}
                    onChange={(v) =>
                      setValues((p) => ({ ...p, densityAltitudeFt: v }))
                    }
                  />
                  <WeatherField
                    label="Wind speed"
                    unit="mph"
                    id="ts-wind-speed"
                    value={values.windSpeedMph ?? ""}
                    onChange={(v) =>
                      setValues((p) => ({ ...p, windSpeedMph: v }))
                    }
                    min={0}
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="ts-wind-direction">Wind direction</Label>
                  <Input
                    id="ts-wind-direction"
                    value={values.windDirection ?? ""}
                    onChange={(e) =>
                      setValues((p) => ({
                        ...p,
                        windDirection: e.target.value,
                      }))
                    }
                    placeholder="e.g. headwind, left to right"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit">{isEdit ? "Save" : "Add Timeslip"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WeatherField({
  label,
  unit,
  id,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  unit: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          step="any"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-12 font-mono"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
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
      <Label
        htmlFor={id}
        className={`text-xs text-muted-foreground shrink-0 w-10 ${bold ? "font-bold" : ""}`}
      >
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

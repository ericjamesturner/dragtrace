import { useEffect, useMemo, useRef, useState } from "react";
import type { LoadedLog, HeatmapConfig, HeatmapAggregation } from "@/lib/viewer-types";
import type { ChannelDef } from "@/lib/log-types";
import type { Id } from "../../../convex/_generated/dataModel";
import { getDisplayUnit, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { buildScatterPresets } from "@/lib/scatter-presets";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: LoadedLog[];
  existing?: HeatmapConfig;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  onSubmit: (config: Omit<HeatmapConfig, "id">) => void;
}

const AGGREGATIONS: { value: HeatmapAggregation; label: string }[] = [
  { value: "average", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "count", label: "Count" },
];

function ChannelPicker({
  value,
  onChange,
  channelDefs,
  unitSystem,
  unitOverrides,
  placeholder,
}: {
  value: string;
  onChange: (name: string) => void;
  channelDefs: ChannelDef[];
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!search) return [];
    const lower = search.toLowerCase();
    return channelDefs.filter((d) => d.name.toLowerCase().includes(lower)).slice(0, 8);
  }, [search, channelDefs]);

  const selectedDef = channelDefs.find((d) => d.name === value);
  const metricUnit = selectedDef?.metricUnit ?? "";
  const displayUnit = metricUnit ? getDisplayUnit(metricUnit, unitSystem, unitOverrides) : "";

  return (
    <div>
      {value && !open ? (
        <div
          onClick={() => {
            setOpen(true);
            setSearch("");
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="flex items-center justify-between px-2 py-1.5 text-xs rounded-lg bg-input/30 border border-input cursor-pointer hover:border-muted-foreground"
        >
          <span className="text-foreground truncate">{value}</span>
          {displayUnit && <span className="text-muted-foreground ml-2">{displayUnit}</span>}
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={placeholder ?? "Search channels..."}
            className="w-full px-2 py-1.5 text-xs rounded-lg bg-input/30 border border-input text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-ring"
          />
          {results.length > 0 && open && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
              {results.map((def) => {
                const du = def.metricUnit ? getDisplayUnit(def.metricUnit, unitSystem, unitOverrides) : "";
                return (
                  <button
                    key={def.name}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(def.name);
                      setSearch("");
                      setOpen(false);
                    }}
                    className="flex items-center justify-between w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted cursor-pointer text-foreground border-b border-border last:border-b-0"
                  >
                    <span className="truncate">{def.name}</span>
                    {du && <span className="text-muted-foreground ml-2">{du}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const clampBins = (n: number) => Math.max(4, Math.min(64, Math.round(n)));

export function HeatmapConfigDialog({
  open,
  onOpenChange,
  logs,
  existing,
  unitSystem,
  unitOverrides,
  onSubmit,
}: Props) {
  const [logFileId, setLogFileId] = useState<Id<"files">>(
    existing?.logFileId ?? logs[0]?.fileId,
  );
  const [xChannel, setXChannel] = useState(existing?.xChannel ?? "");
  const [yChannel, setYChannel] = useState(existing?.yChannel ?? "");
  const [valueChannel, setValueChannel] = useState(existing?.valueChannel ?? "");
  const [xBins, setXBins] = useState(existing?.xBins ?? 16);
  const [yBins, setYBins] = useState(existing?.yBins ?? 16);
  const [aggregation, setAggregation] = useState<HeatmapAggregation>(existing?.aggregation ?? "average");

  // Reset form whenever the dialog (re)opens for a new/different target.
  useEffect(() => {
    if (!open) return;
    setLogFileId(existing?.logFileId ?? logs[0]?.fileId);
    setXChannel(existing?.xChannel ?? "");
    setYChannel(existing?.yChannel ?? "");
    setValueChannel(existing?.valueChannel ?? "");
    setXBins(existing?.xBins ?? 16);
    setYBins(existing?.yBins ?? 16);
    setAggregation(existing?.aggregation ?? "average");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const log = logs.find((l) => l.fileId === logFileId) ?? logs[0];
  const channelDefs = log?.parsed.channelDefs ?? [];
  // Reuse the scatter preset matcher: its "color" channel maps to our cell value.
  const presets = useMemo(
    () => buildScatterPresets(channelDefs).filter((p) => p.color),
    [channelDefs],
  );

  const canSubmit = !!xChannel && !!yChannel && !!valueChannel && !!logFileId;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      logFileId,
      xChannel,
      yChannel,
      valueChannel,
      xBins: clampBins(xBins),
      yBins: clampBins(yBins),
      aggregation,
      height: existing?.height ?? 300,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Heatmap" : "New Heatmap"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {logs.length > 1 && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Log</span>
              <div className="flex flex-wrap gap-1.5">
                {logs.map((l) => (
                  <button
                    key={l.fileId}
                    onClick={() => setLogFileId(l.fileId)}
                    className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer transition-colors ${
                      l.fileId === logFileId
                        ? "border-primary text-foreground bg-primary/10"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {l.fileName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {presets.length > 0 && !existing && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Quick Setup</span>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setXChannel(p.x);
                      setYChannel(p.y);
                      setValueChannel(p.color);
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 cursor-pointer transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">X Axis (bottom)</span>
            <ChannelPicker
              value={xChannel}
              onChange={setXChannel}
              channelDefs={channelDefs}
              unitSystem={unitSystem}
              unitOverrides={unitOverrides}
              placeholder="X channel (e.g. RPM)"
            />
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Y Axis (left)</span>
            <ChannelPicker
              value={yChannel}
              onChange={setYChannel}
              channelDefs={channelDefs}
              unitSystem={unitSystem}
              unitOverrides={unitOverrides}
              placeholder="Y channel (e.g. Manifold Pressure)"
            />
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Cell Value (color)</span>
            <ChannelPicker
              value={valueChannel}
              onChange={setValueChannel}
              channelDefs={channelDefs}
              unitSystem={unitSystem}
              unitOverrides={unitOverrides}
              placeholder="Value channel (e.g. Wideband O2)"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">X Bins</label>
              <input
                type="number"
                min={4}
                max={64}
                value={xBins}
                onChange={(e) => setXBins(parseInt(e.target.value, 10) || 0)}
                onBlur={() => setXBins((b) => clampBins(b || 16))}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-input/30 border border-input text-foreground outline-none focus:border-ring"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Y Bins</label>
              <input
                type="number"
                min={4}
                max={64}
                value={yBins}
                onChange={(e) => setYBins(parseInt(e.target.value, 10) || 0)}
                onBlur={() => setYBins((b) => clampBins(b || 16))}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-input/30 border border-input text-foreground outline-none focus:border-ring"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Aggregation</span>
            <div className="flex flex-wrap gap-1.5">
              {AGGREGATIONS.map((a) => (
                <button
                  key={a.value}
                  onClick={() => setAggregation(a.value)}
                  className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer transition-colors ${
                    a.value === aggregation
                      ? "border-primary text-foreground bg-primary/10"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!canSubmit}>
            {existing ? "Save" : "Create Heatmap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

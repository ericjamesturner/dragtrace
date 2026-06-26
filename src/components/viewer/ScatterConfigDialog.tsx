import { useEffect, useMemo, useRef, useState } from "react";
import type { LoadedLog, ScatterConfig, ScatterSuggestion } from "@/lib/viewer-types";
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
import { SparklesIcon } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: LoadedLog[];
  existing?: ScatterConfig;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  aiSuggestions?: ScatterSuggestion[];
  onSubmit: (config: Omit<ScatterConfig, "id">) => void;
}

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

export function ScatterConfigDialog({
  open,
  onOpenChange,
  logs,
  existing,
  unitSystem,
  unitOverrides,
  aiSuggestions,
  onSubmit,
}: Props) {
  const [logFileId, setLogFileId] = useState<Id<"files">>(
    existing?.logFileId ?? logs[0]?.fileId
  );
  const [xChannel, setXChannel] = useState(existing?.xChannel ?? "");
  const [yChannel, setYChannel] = useState(existing?.yChannel ?? "");
  const [colorChannel, setColorChannel] = useState(existing?.colorChannel ?? "");
  const [pointSize, setPointSize] = useState(existing?.pointSize ?? 2);
  const [opacity, setOpacity] = useState(existing?.opacity ?? 0.6);

  // Reset form whenever the dialog (re)opens for a new/different target.
  useEffect(() => {
    if (!open) return;
    setLogFileId(existing?.logFileId ?? logs[0]?.fileId);
    setXChannel(existing?.xChannel ?? "");
    setYChannel(existing?.yChannel ?? "");
    setColorChannel(existing?.colorChannel ?? "");
    setPointSize(existing?.pointSize ?? 2);
    setOpacity(existing?.opacity ?? 0.6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const log = logs.find((l) => l.fileId === logFileId) ?? logs[0];
  const channelDefs = log?.parsed.channelDefs ?? [];
  const presets = useMemo(() => buildScatterPresets(channelDefs), [channelDefs]);

  // AI suggestions whose X/Y channels both exist in the selected log.
  const aiPresets = useMemo(() => {
    if (!aiSuggestions || aiSuggestions.length === 0) return [];
    const names = new Set(channelDefs.map((d) => d.name));
    return aiSuggestions.filter((s) => names.has(s.xChannel) && names.has(s.yChannel));
  }, [aiSuggestions, channelDefs]);

  const canSubmit = !!xChannel && !!yChannel && !!logFileId;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      logFileId,
      xChannel,
      yChannel,
      colorChannel: colorChannel || undefined,
      height: existing?.height ?? 300,
      pointSize,
      opacity,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit XY Scatter" : "New XY Scatter"}</DialogTitle>
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

          {aiPresets.length > 0 && !existing && (
            <div className="grid gap-1.5">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <SparklesIcon className="size-3 text-primary" /> AI Suggestions
              </span>
              <div className="flex flex-wrap gap-1.5">
                {aiPresets.map((s, i) => (
                  <button
                    key={`${s.label}-${i}`}
                    title={s.description}
                    onClick={() => {
                      setXChannel(s.xChannel);
                      setYChannel(s.yChannel);
                      setColorChannel(s.colorChannel ?? "");
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-primary/40 text-primary hover:bg-primary/10 cursor-pointer transition-colors"
                  >
                    {s.label}
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
                      setColorChannel(p.color);
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
            <span className="text-xs text-muted-foreground">X Axis</span>
            <ChannelPicker
              value={xChannel}
              onChange={setXChannel}
              channelDefs={channelDefs}
              unitSystem={unitSystem}
              unitOverrides={unitOverrides}
              placeholder="X channel"
            />
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Y Axis</span>
            <ChannelPicker
              value={yChannel}
              onChange={setYChannel}
              channelDefs={channelDefs}
              unitSystem={unitSystem}
              unitOverrides={unitOverrides}
              placeholder="Y channel"
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Color (optional)</span>
              {colorChannel && (
                <button
                  onClick={() => setColorChannel("")}
                  className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer"
                >
                  clear
                </button>
              )}
            </div>
            <ChannelPicker
              value={colorChannel}
              onChange={setColorChannel}
              channelDefs={channelDefs}
              unitSystem={unitSystem}
              unitOverrides={unitOverrides}
              placeholder="Color channel"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Point Size ({pointSize})</label>
              <input
                type="range"
                min={1}
                max={5}
                step={0.5}
                value={pointSize}
                onChange={(e) => setPointSize(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Opacity ({opacity.toFixed(1)})</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.1}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!canSubmit}>
            {existing ? "Save" : "Create Scatter Plot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

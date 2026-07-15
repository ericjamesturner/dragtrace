import { useState, useMemo } from "react";
import type { LoadedLog, HighlightZoneConfig } from "@/lib/viewer-types";
import type { EvaluatedZone } from "@/hooks/useEvaluatedZones";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { UnitSystem, UnitOverrides } from "@/lib/units";
import { validateZoneExpression } from "@/lib/zone-evaluator";
import { buildHighlightZoneInput, ZONE_COLORS, type ChannelSample } from "@/lib/ai-highlight-zone";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PlusIcon, XIcon, ChevronDownIcon, ChevronRightIcon, PencilIcon, SparklesIcon, RotateCcwIcon, LayersIcon } from "lucide-react";
import { GROUP_COLORS, type GroupNode } from "@/lib/channel-groups";
import { useChannelGroups } from "@/hooks/useChannelGroups";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: LoadedLog[];
  highlightZones?: HighlightZoneConfig[];
  onAddZone?: (zone: HighlightZoneConfig) => void;
  onUpdateZone?: (zoneId: string, updates: Partial<Omit<HighlightZoneConfig, "id">>) => void;
  onRemoveZone?: (zoneId: string) => void;
  onToggleZone?: (zoneId: string) => void;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  evaluatedZones?: EvaluatedZone[];
}



const OPERATORS = [">", "<", ">=", "<=", "==", "!="] as const;

/** Count channels in a group node including subgroups. */
function countGroupChannels(node: GroupNode): number {
  return node.channels.length + node.children.reduce((sum, c) => sum + c.channels.length, 0);
}

/** Searchable, grouped channel picker — matches sidebar UX. */
export function ChannelPicker({
  logs,
  selected,
  onSelect,
}: {
  logs: LoadedLog[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isSearching = search.length > 0;
  const lower = search.toLowerCase();

  // Deduplicate channel defs across logs
  const allDefs = useMemo(() => {
    const seen = new Set<string>();
    const defs: import("@/lib/log-types").ChannelDef[] = [];
    for (const log of logs) {
      for (const def of log.parsed.channelDefs) {
        if (!seen.has(def.name)) {
          seen.add(def.name);
          defs.push(def);
        }
      }
    }
    return defs;
  }, [logs]);

  const { tree } = useChannelGroups(allDefs, "haltech");

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderChannelList = (channels: import("@/lib/channel-groups").GroupChannel[]) => {
    const filtered = isSearching
      ? channels.filter((ch) =>
          ch.def.name.toLowerCase().includes(lower) ||
          ch.displayName.toLowerCase().includes(lower) ||
          ch.aliases?.some((a) => a.toLowerCase().includes(lower))
        )
      : channels;
    if (filtered.length === 0) return null;
    return filtered.map((ch) => (
      <button
        key={ch.def.name}
        onClick={() => onSelect(ch.def.name)}
        title={ch.def.name}
        className={`w-full text-left px-2 py-1 text-sm rounded cursor-pointer truncate ${
          selected === ch.def.name
            ? "bg-primary/10 text-primary"
            : "hover:bg-muted"
        }`}
      >
        {ch.def.name}
      </button>
    ));
  };

  const matchesCh = (ch: import("@/lib/channel-groups").GroupChannel) =>
    ch.def.name.toLowerCase().includes(lower) ||
    ch.displayName.toLowerCase().includes(lower) ||
    ch.aliases?.some((a) => a.toLowerCase().includes(lower));

  const hasMatchInGroup = (node: GroupNode): boolean => {
    if (!isSearching) return true;
    if (node.channels.some(matchesCh)) return true;
    return node.children.some((c) => c.channels.some(matchesCh));
  };

  return (
    <div className="space-y-1">
      <input
        type="text"
        placeholder="Search channels..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
      />
      {selected && (
        <div className="text-xs text-primary font-medium px-1">
          Selected: {selected}
        </div>
      )}
      <div className="max-h-[250px] overflow-y-auto space-y-0.5">
        {tree.map((group) => {
          if (!hasMatchInGroup(group)) return null;
          const groupKey = group.tag;
          const isOpen = isSearching || expanded.has(groupKey);
          const count = countGroupChannels(group);
          const groupColor = GROUP_COLORS[group.tag] ?? "#6b7280";

          return (
            <div key={groupKey}>
              <button
                onClick={() => toggleGroup(groupKey)}
                className="flex items-center gap-1.5 w-full px-1 py-1 text-xs font-semibold hover:bg-muted/50 rounded cursor-pointer"
              >
                {isOpen
                  ? <ChevronDownIcon className="size-3" />
                  : <ChevronRightIcon className="size-3" />}
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: groupColor }} />
                <span className="flex-1 text-left">{group.tag}</span>
                <span className="text-muted-foreground font-normal">{count}</span>
              </button>
              {isOpen && (
                <div className="ml-4">
                  {renderChannelList(group.channels)}
                  {group.children.map((child) => {
                    const childChannels = isSearching
                      ? child.channels.filter((ch) => ch.def.name.toLowerCase().includes(lower))
                      : child.channels;
                    if (childChannels.length === 0) return null;
                    return (
                      <div key={child.tag} className="mt-0.5">
                        <div className="text-xs text-muted-foreground font-medium px-2 py-0.5">{child.tag}</div>
                        {renderChannelList(child.channels)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ZoneBuilder({
  onSubmit,
  editingZone,
  onCancelEdit,
  logs,
  unitSystem,
  unitOverrides,
}: {
  onSubmit: (expression: string, label: string, color: string, aiPrompt?: string) => void;
  editingZone?: HighlightZoneConfig | null;
  onCancelEdit?: () => void;
  logs: LoadedLog[];
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
}) {
  const channelNames = useMemo(() => {
    const names = logs.flatMap((l) => l.parsed.channelDefs.map((d) => d.name));
    return [...new Set(names)];
  }, [logs]);

  const [mode, setMode] = useState<"builder" | "raw">(editingZone ? "raw" : "builder");
  const [channel, setChannel] = useState(editingZone ? "" : "");
  const [operator, setOperator] = useState<string>(">");
  const [value, setValue] = useState("");
  const [useDerivative, setUseDerivative] = useState(false);
  const [rawExpression, setRawExpression] = useState(editingZone?.expression ?? "");
  const [label, setLabel] = useState(editingZone?.label ?? "");
  const [color, setColor] = useState(editingZone?.color ?? ZONE_COLORS[0]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // AI generation (Anthropic call runs server-side in the highlightZones action)
  const generateZone = useAction(api.highlightZones.generate);
  const [aiPrompt, setAiPrompt] = useState(editingZone?.aiPrompt ?? "");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const expressionFromBuilder = (): string => {
    if (!channel || !value.trim()) return "";
    const ref = useDerivative ? `derivative({${channel}})` : `{${channel}}`;
    return `${ref} ${operator} ${value.trim()}`;
  };

  const currentExpression = mode === "raw" ? rawExpression : expressionFromBuilder();

  const handleValidate = (expr: string) => {
    if (!expr.trim()) {
      setValidationError(null);
      return;
    }
    const err = validateZoneExpression(expr, channelNames);
    setValidationError(err);
  };

  const handleSubmit = () => {
    const expr = currentExpression;
    if (!expr.trim() || !label.trim()) return;
    const err = validateZoneExpression(expr, channelNames);
    if (err) {
      setValidationError(err);
      return;
    }
    onSubmit(expr, label.trim(), color, aiPrompt.trim() || undefined);
    // Reset form
    setChannel("");
    setOperator(">");
    setValue("");
    setUseDerivative(false);
    setRawExpression("");
    setLabel("");
    setColor(ZONE_COLORS[0]);
    setValidationError(null);
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const samples: ChannelSample[] = [];
      if (logs.length > 0) {
        const log = logs[0];
        const session = log.parsed.sessions[log.activeSessionIndex];
        if (session) {
          for (const def of log.parsed.channelDefs) {
            const data = session.channels.get(def.name);
            if (data) {
              samples.push({
                name: def.name,
                data,
                timestamps: session.timestamps,
                metricUnit: def.metricUnit ?? "",
              });
            }
          }
        }
      }
      const result = await generateZone(
        buildHighlightZoneInput(
          aiPrompt,
          channelNames,
          unitSystem,
          unitOverrides,
          samples,
        ),
      );
      setRawExpression(result.expression);
      setLabel(result.label);
      setColor(result.color);
      setMode("raw");
      handleValidate(result.expression);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMode("builder")}
          className={`px-2 py-0.5 text-xs rounded cursor-pointer ${mode === "builder" ? "bg-primary/10 text-primary border border-primary" : "border border-border text-muted-foreground hover:bg-muted"}`}
        >
          Builder
        </button>
        <button
          onClick={() => {
            if (mode === "builder" && currentExpression) {
              setRawExpression(currentExpression);
            }
            setMode("raw");
          }}
          className={`px-2 py-0.5 text-xs rounded cursor-pointer ${mode === "raw" ? "bg-primary/10 text-primary border border-primary" : "border border-border text-muted-foreground hover:bg-muted"}`}
        >
          Raw Expression
        </button>
      </div>

      {mode === "builder" ? (
        <div className="space-y-2">
          {/* Rate of change toggle */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={useDerivative}
              onChange={(e) => setUseDerivative(e.target.checked)}
              className="accent-primary"
            />
            Rate of change
          </label>

          {/* Grouped channel picker */}
          <ChannelPicker
            logs={logs}
            selected={channel}
            onSelect={setChannel}
          />

          {/* Operator + value */}
          <div className="flex items-center gap-2">
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              className="px-2 py-1 rounded bg-muted border border-border text-sm outline-none focus:border-primary w-16"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
            />
          </div>

          {currentExpression && (
            <div className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded">
              {currentExpression}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={rawExpression}
            onChange={(e) => {
              setRawExpression(e.target.value);
              handleValidate(e.target.value);
            }}
            placeholder='{TPS} > 50 && {RPM} > 3000'
            rows={2}
            className="w-full px-2 py-1 rounded bg-muted border border-border text-sm font-mono placeholder:text-muted-foreground outline-none focus:border-primary resize-none"
          />
          {validationError && (
            <div className="text-xs text-destructive">{validationError}</div>
          )}
        </div>
      )}

      {/* Label + color */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="flex-1 px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
        />
      </div>
      <div className="flex items-center gap-1">
        {ZONE_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-[18px] h-[18px] rounded-full border-2 cursor-pointer shrink-0 ${color === c ? "border-primary" : "border-transparent"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {/* Submit */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!currentExpression.trim() || !label.trim() || !!validationError}
          className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {editingZone ? "Update Zone" : "Add Zone"}
        </button>
        {editingZone && onCancelEdit && (
          <button
            onClick={onCancelEdit}
            className="px-3 py-1 text-sm border border-border rounded hover:bg-muted cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>

      {/* AI generation */}
      <div className="border-t border-border pt-3 mt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            AI Zone Generator
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Describe what to highlight..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !aiLoading) handleAiGenerate(); }}
              className="flex-1 px-2 py-1 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
            />
            <button
              onClick={handleAiGenerate}
              disabled={aiLoading || !aiPrompt.trim()}
              className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
            >
              {aiLoading ? "..." : editingZone?.aiPrompt ? "Regenerate" : "Generate"}
            </button>
          </div>
          {aiError && <div className="text-xs text-destructive">{aiError}</div>}
        </div>
    </div>
  );
}

export function TraceSettingsPanel({
  open,
  onOpenChange,
  logs,
  highlightZones,
  onAddZone,
  onUpdateZone,
  onRemoveZone,
  onToggleZone,
  unitSystem,
  unitOverrides,
  evaluatedZones,
}: Props) {
  const [showZoneBuilder, setShowZoneBuilder] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);

  const zoneCount = (highlightZones ?? []).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle>Highlight Zones{zoneCount > 0 ? ` (${zoneCount})` : ""}</SheetTitle>
          <SheetDescription>Shade regions of the trace where an expression is true</SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-4">
          {/* ===== Highlight Zones tab ===== */}
          {onAddZone && (
            <div className="space-y-2">
              {/* Zone list */}
              {(highlightZones ?? []).map((zone) => {
                const evaluated = evaluatedZones?.find((ez) => ez.config.id === zone.id);
                const isEditing = editingZoneId === zone.id;

                if (isEditing) {
                  return (
                    <div key={zone.id} className="border border-border rounded-md p-2 mb-2">
                      <ZoneBuilder
                        editingZone={zone}
                        onSubmit={(expression, label, color, aiPrompt) => {
                          onUpdateZone?.(zone.id, { expression, label, color, aiPrompt });
                          setEditingZoneId(null);
                        }}
                        onCancelEdit={() => setEditingZoneId(null)}
                        logs={logs}
                        unitSystem={unitSystem}
                        unitOverrides={unitOverrides}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={zone.id}
                    className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted/50 group"
                  >
                    <button
                      onClick={() => onToggleZone?.(zone.id)}
                      className="cursor-pointer"
                    >
                      <span
                        className={`w-3 h-3 rounded-sm block border ${zone.enabled ? "" : "opacity-30"}`}
                        style={{
                          backgroundColor: zone.enabled ? zone.color : "transparent",
                          borderColor: zone.color,
                        }}
                      />
                    </button>
                    <span className={`flex-1 text-sm truncate ${zone.enabled ? "" : "opacity-50"}`}>
                      {zone.label}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]" title={zone.expression}>
                      {zone.expression}
                    </span>
                    {evaluated?.error && (
                      <span className="text-xs text-destructive" title={evaluated.error}>err</span>
                    )}
                    <button
                      onClick={() => onUpdateZone?.(zone.id, { showOnAllTraces: !zone.showOnAllTraces })}
                      title={zone.showOnAllTraces ? "Shown on all traces — click to limit to this trace" : "Show on all traces"}
                      className={`cursor-pointer ${zone.showOnAllTraces ? "text-primary" : "text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"}`}
                    >
                      <LayersIcon className="size-3" />
                    </button>
                    {zone.labelYFraction != null && (
                      <button
                        onClick={() => onUpdateZone?.(zone.id, { labelYFraction: undefined })}
                        title="Reset dragged label position"
                        className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 cursor-pointer"
                      >
                        <RotateCcwIcon className="size-3" />
                      </button>
                    )}
                    <button
                      onClick={() => setEditingZoneId(zone.id)}
                      className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 cursor-pointer"
                    >
                      <PencilIcon className="size-3" />
                    </button>
                    <button
                      onClick={() => onRemoveZone?.(zone.id)}
                      className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 cursor-pointer"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                );
              })}

              {(highlightZones ?? []).length === 0 && !showZoneBuilder && (
                <p className="text-sm text-muted-foreground py-4 text-center">No highlight zones yet</p>
              )}

              {/* Add zone builder */}
              {showZoneBuilder ? (
                <div className="border border-border rounded-md p-2 mt-2">
                  <ZoneBuilder
                    onSubmit={(expression, label, color, aiPrompt) => {
                      onAddZone?.({
                        id: crypto.randomUUID(),
                        expression,
                        label,
                        color,
                        enabled: true,
                        aiPrompt,
                      });
                      setShowZoneBuilder(false);
                    }}
                    logs={logs}
                    unitSystem={unitSystem}
                    unitOverrides={unitOverrides}
                  />
                  <button
                    onClick={() => setShowZoneBuilder(false)}
                    className="mt-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowZoneBuilder(true)}
                  className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 cursor-pointer mt-1"
                >
                  <PlusIcon className="size-3.5" />
                  Add Zone
                </button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

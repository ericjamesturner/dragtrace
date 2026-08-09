import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { ChannelDef, ChannelStatus, LogSession } from "@/lib/log-types";
import type { LoadedLog, TraceConfig, ChannelOnTrace } from "@/lib/viewer-types";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { XIcon, PlusIcon, PencilIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { PassList } from "./PassList";
import { MathChannelDialog } from "./MathChannelDialog";
import { getDisplayUnit, getUnitOptions, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { GROUP_COLORS, type GroupNode, type GroupChannel } from "@/lib/channel-groups";
import { useChannelGroups } from "@/hooks/useChannelGroups";
import { DEFAULT_ECU_TYPE } from "@/lib/ecu/registry";

function countGroupChannels(node: GroupNode): number {
  return node.channels.length + node.children.reduce((sum, c) => sum + c.channels.length, 0);
}

/** Match a channel against search text (name, displayName, and aliases). */
function matchesSearch(ch: GroupChannel, searchLower: string): boolean {
  if (!searchLower) return true;
  if (ch.def.name.toLowerCase().includes(searchLower)) return true;
  if (ch.displayName.toLowerCase().includes(searchLower)) return true;
  if (ch.aliases?.some((a) => a.toLowerCase().includes(searchLower))) return true;
  return false;
}

/** Filter a group node to only channels in the given set, applying empty/search filters. */
function filterGroupNode(
  node: GroupNode,
  logDefNames: Set<string>,
  emptySet: Set<string>,
  hideEmpty: boolean,
  searchLower: string,
): GroupNode | null {
  const channels = node.channels.filter((ch) => {
    if (!logDefNames.has(ch.def.name)) return false;
    if (hideEmpty && emptySet.has(ch.def.name)) return false;
    if (searchLower && !matchesSearch(ch, searchLower)) return false;
    return true;
  });

  const children = node.children
    .map((child) => filterGroupNode(child, logDefNames, emptySet, hideEmpty, searchLower))
    .filter((c): c is GroupNode => c !== null);

  // Math survives being empty: it's where math channels are created, so
  // dropping it when there are none leaves no way to make the first.
  if (channels.length === 0 && children.length === 0 && node.tag !== "Math") return null;

  return { tag: node.tag, channels, children };
}

function detectEmptyChannels(defs: ChannelDef[], session: LogSession): Set<string> {
  const empty = new Set<string>();
  for (const def of defs) {
    const data = session.channels.get(def.name);
    if (!data || data.length === 0) { empty.add(def.name); continue; }
    let firstValid = NaN;
    let hasVariation = false;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v !== v) continue;
      if (firstValid !== firstValid) { firstValid = v; continue; }
      if (v !== firstValid) { hasVariation = true; break; }
    }
    if (!hasVariation) empty.add(def.name);
  }
  return empty;
}

// ── Component ──

interface Props {
  logs: LoadedLog[];
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  mathVersion?: number;
  mathErrors?: { name: string; message: string }[];
  mathChannels?: Doc<"mathChannels">[];
  loadedFileIds: Id<"files">[];
  pendingFileIds?: Id<"files">[];
  traces: TraceConfig[];
  hiddenLogIds: string[];
  mirroredLogIds: string[];
  onAddFile: (fileId: Id<"files">) => void;
  onRemoveFile: (fileId: Id<"files">) => void;
  onAddChannel: (traceId: string, channel: ChannelOnTrace) => void;
  onAddTraceWithChannel: (channel: ChannelOnTrace) => void;
  onRemoveChannel: (traceId: string, logFileId: Id<"files">, channelName: string) => void;
  onToggleLogVisibility: (logFileId: Id<"files">) => void;
  onToggleMirrorLog: (logFileId: Id<"files">) => void;
  activeTraceId: string | null;
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  onCycleUnit?: (quantitySlug: string) => void;
}

export function ViewerSidebar({
  logs,
  vehicleId,
  eventId,
  mathVersion,
  mathErrors,
  mathChannels,
  loadedFileIds,
  pendingFileIds,
  hiddenLogIds,
  mirroredLogIds,
  onAddFile,
  onRemoveFile,
  onAddChannel,
  onAddTraceWithChannel,
  onRemoveChannel,
  onToggleLogVisibility,
  onToggleMirrorLog,
  activeTraceId,
  unitSystem,
  unitOverrides,
  onCycleUnit,
}: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(() => new Set(logs.map((l) => l.fileId)));
  const [tab, setTab] = useState<"channels" | "passes">("channels");
  const [mathDialog, setMathDialog] = useState<{ editing: Doc<"mathChannels"> | null } | null>(null);
  const [isDragTarget, setIsDragTarget] = useState(false);
  const sidebarDragCounter = useRef(0);

  // Per-vehicle channel renaming. The shared taxonomy is curated reference
  // data, so a user's own naming lives against their vehicle instead.
  const setOverride = useMutation(api.vehicleChannelOverrides.setOverride);
  const removeOverride = useMutation(api.vehicleChannelOverrides.removeOverride);
  const [renaming, setRenaming] = useState<string | null>(null);

  const handleRename = useCallback(
    (channelName: string, name: string) => {
      const trimmed = name.trim();
      setRenaming(null);
      if (trimmed) {
        void setOverride({ vehicleId, channelName, displayName: trimmed });
      } else {
        void removeOverride({ vehicleId, channelName });
      }
    },
    [setOverride, removeOverride, vehicleId],
  );

  // Combine all channel defs from all logs for the hook
  const allDefs = useMemo(() => {
    const seen = new Set<string>();
    const defs: ChannelDef[] = [];
    for (const log of logs) {
      for (const def of log.parsed.channelDefs) {
        if (!seen.has(def.name)) {
          seen.add(def.name);
          defs.push(def);
        }
      }
    }
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, mathVersion]);

  // DB-driven channel grouping (falls back to hardcoded while loading)
  const { tree: masterTree } = useChannelGroups(allDefs, DEFAULT_ECU_TYPE, vehicleId);

  const emptyChannelsByLog = useMemo(() => {
    const map = new Map<Id<"files">, Set<string>>();
    for (const log of logs) {
      const session = log.parsed.sessions[log.activeSessionIndex];
      if (session) map.set(log.fileId, detectEmptyChannels(log.parsed.channelDefs, session));
    }
    return map;
  }, [logs]);

  const toggleGroup = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleLog = useCallback((fileId: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, logFileId: Id<"files">, channelName: string) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ logFileId, channelName }));
      e.dataTransfer.effectAllowed = "copy";
    },
    []
  );

  const handleSidebarDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    sidebarDragCounter.current++;
    if (sidebarDragCounter.current === 1) setIsDragTarget(true);
  }, []);

  const handleSidebarDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleSidebarDragLeave = useCallback(() => {
    sidebarDragCounter.current--;
    if (sidebarDragCounter.current <= 0) {
      sidebarDragCounter.current = 0;
      setIsDragTarget(false);
    }
  }, []);

  const handleSidebarDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      sidebarDragCounter.current = 0;
      setIsDragTarget(false);
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          logFileId: Id<"files">;
          channelName: string;
          sourceTraceId?: string;
        };
        if (parsed.sourceTraceId && parsed.logFileId && parsed.channelName) {
          onRemoveChannel(parsed.sourceTraceId, parsed.logFileId, parsed.channelName);
        }
      } catch {
        // ignore
      }
    },
    [onRemoveChannel]
  );

  const isSearching = search.length > 0;

  return (
    <div
      className={`flex flex-col h-full border-r bg-muted/20 transition-colors ${
        isDragTarget ? "ring-2 ring-inset ring-destructive/30 bg-destructive/5" : ""
      }`}
      onDragEnter={handleSidebarDragEnter}
      onDragOver={handleSidebarDragOver}
      onDragLeave={handleSidebarDragLeave}
      onDrop={handleSidebarDrop}
    >
      <div className="flex border-b">
        {(["channels", "passes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
              tab === t
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "channels" ? "Channels" : "Passes"}
          </button>
        ))}
      </div>

      {tab === "passes" ? (
        <PassList
          vehicleId={vehicleId}
          eventId={eventId}
          loadedFileIds={loadedFileIds}
          pendingFileIds={pendingFileIds}
          onAddFile={onAddFile}
          onRemoveFile={onRemoveFile}
        />
      ) : (
      <>
      <div className="p-3 border-b">
        <input
          type="text"
          placeholder="Search channels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
        />
        <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={() => setHideEmpty((v) => !v)}
            className="rounded"
          />
          Hide empty channels
        </label>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {logs.map((log, logIndex) => {
          const isLogOpen = expandedLogs.has(log.fileId);
          const emptySet = emptyChannelsByLog.get(log.fileId) ?? new Set<string>();
          const statusMap =
            log.parsed.sessions[log.activeSessionIndex]?.channelStatus ??
            new Map<string, ChannelStatus>();

          const logDefNames = new Set(log.parsed.channelDefs.map((d) => d.name));
          const searchLower = search.toLowerCase();

          // Filter master tree to channels present in this log
          const tree = masterTree
            .map((node) => filterGroupNode(node, logDefNames, emptySet, hideEmpty, searchLower))
            .filter((n): n is GroupNode => n !== null);

          return (
            <div key={log.fileId} className="mb-2">
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-muted group">
                {logs.length > 1 && (
                  <Tip content={hiddenLogIds.includes(log.fileId) ? "Show log" : "Hide log"}>
                    <input
                      type="checkbox"
                      checked={!hiddenLogIds.includes(log.fileId)}
                      onChange={() => onToggleLogVisibility(log.fileId)}
                      className="rounded shrink-0 cursor-pointer"
                    />
                  </Tip>
                )}
                <button
                  onClick={() => toggleLog(log.fileId)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer"
                >
                  <span className="text-[10px] w-3">{isLogOpen ? "\u25BC" : "\u25B6"}</span>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: log.logColor }} />
                  <span className="flex-1 truncate">{log.fileName.replace(/\.[^.]+$/, "")}</span>
                  <span className="font-normal normal-case tracking-normal text-[11px] opacity-50">
                    {tree.reduce((sum, n) => sum + countGroupChannels(n), 0)}
                  </span>
                </button>
                {logs.length > 1 && (
                  <Tip content="Remove log">
                    <button
                      onClick={() => onRemoveFile(log.fileId)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer p-0.5 shrink-0"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Tip>
                )}
              </div>
              {isLogOpen && <LogNotes fileId={log.fileId} />}
              {isLogOpen && logs.length > 1 && logIndex > 0 && (
                <div className="px-2 mb-1">
                  <label className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mirroredLogIds.includes(log.fileId)}
                      onChange={() => onToggleMirrorLog(log.fileId)}
                      className="rounded"
                    />
                    Mirror Channels
                  </label>
                </div>
              )}
              {/* A mirrored log hides its tree because its channels come from
                  the log above. With only one log there's nothing to mirror,
                  and the Mirror checkbox isn't rendered either — so without
                  this guard a stale flag hides every channel with no way back. */}
              {isLogOpen && (logs.length === 1 || !mirroredLogIds.includes(log.fileId)) && (
                <div className="ml-1 border-l-2 pl-0" style={{ borderColor: log.logColor + "30" }}>
                  {tree.map((node) => (
                    <SidebarGroupNode
                      key={`${log.fileId}:${node.tag}`}
                      node={node}
                      keyPrefix={`${log.fileId}:`}
                      isRoot
                      isSearching={isSearching}
                      expanded={expanded}
                      emptySet={emptySet}
                      statusMap={statusMap}
                      onNewMathChannel={() => setMathDialog({ editing: null })}
                      onEditMathChannel={(name) => {
                        const def = (mathChannels ?? []).find((m) => m.name === name);
                        if (def) setMathDialog({ editing: def });
                      }}
                      renaming={renaming}
                      onStartRename={setRenaming}
                      onCommitRename={handleRename}
                      logFileId={log.fileId}
                      unitSystem={unitSystem}
                      unitOverrides={unitOverrides}
                      activeTraceId={activeTraceId}
                      onToggleGroup={toggleGroup}
                      onDragStart={handleDragStart}
                      onAddChannel={onAddChannel}
                      onAddTraceWithChannel={onAddTraceWithChannel}
                      onCycleUnit={onCycleUnit}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      </>
      )}

      {(mathErrors?.length ?? 0) > 0 && tab === "channels" && (
        <div className="border-t px-3 py-2 text-xs text-destructive">
          {mathErrors!.map((e) => (
            <div key={e.name} className="truncate" title={`${e.name}: ${e.message}`}>
              {e.name} couldn't be computed
            </div>
          ))}
        </div>
      )}

      {mathDialog && (
        <MathChannelDialog
          open
          onOpenChange={(o) => { if (!o) setMathDialog(null); }}
          vehicleId={vehicleId}
          channelNames={allDefs.filter((d) => !d.custom).map((d) => d.name)}
          unitSystem={unitSystem}
          unitOverrides={unitOverrides}
          editing={mathDialog.editing}
        />
      )}
    </div>
  );
}

/** Live-saving notes for a log — same notes as the event dashboard card. */
function LogNotes({ fileId }: { fileId: Id<"files"> }) {
  const file = useQuery(api.files.get, { id: fileId });
  const updateNotes = useMutation(api.files.updateNotes);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<string | null>(null);
  const focusedRef = useRef(false);

  const flush = useCallback(
    (value: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void updateNotes({ id: fileId, notes: value.trim() || undefined }).finally(
        () => setPending(false),
      );
    },
    [fileId, updateNotes],
  );

  const handleChange = (v: string) => {
    setDraft(v);
    latestRef.current = v;
    setPending(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(v), 600);
  };

  // Flush a pending edit if the log/component goes away mid-debounce
  useEffect(
    () => () => {
      if (timerRef.current && latestRef.current !== null) {
        clearTimeout(timerRef.current);
        void updateNotes({ id: fileId, notes: latestRef.current.trim() || undefined });
      }
    },
    [fileId, updateNotes],
  );

  // Once the server catches up (and we're not typing), drop the local draft
  // so remote edits show live again.
  const serverNotes = file?.notes ?? "";
  useEffect(() => {
    if (!focusedRef.current && draft !== null && !pending && serverNotes === draft.trim()) {
      setDraft(null);
    }
  }, [serverNotes, draft, pending]);

  if (!file) return null;
  const value = draft ?? serverNotes;

  return (
    <div className="px-2 mb-1.5">
      <div className="flex items-center justify-between px-1 pb-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Run Notes
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          {pending ? "saving…" : ""}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (timerRef.current && latestRef.current !== null) flush(latestRef.current);
        }}
        placeholder="Add notes about this run…"
        rows={value ? Math.min(8, value.split("\n").length + 1) : 2}
        className="w-full px-2 py-1.5 rounded bg-muted/50 border border-border text-xs leading-relaxed placeholder:text-muted-foreground/60 outline-none focus:border-primary resize-y"
      />
    </div>
  );
}

/** Recursive group node renderer — supports arbitrary nesting depth. */
function SidebarGroupNode({
  node,
  keyPrefix,
  isRoot,
  isSearching,
  expanded,
  emptySet,
  statusMap,
  renaming,
  onStartRename,
  onCommitRename,
  logFileId,
  unitSystem,
  unitOverrides,
  activeTraceId,
  onToggleGroup,
  onDragStart,
  onAddChannel,
  onAddTraceWithChannel,
  onCycleUnit,
  onNewMathChannel,
  onEditMathChannel,
}: {
  node: GroupNode;
  keyPrefix: string;
  isRoot?: boolean;
  isSearching: boolean;
  expanded: Set<string>;
  emptySet: Set<string>;
  statusMap: Map<string, ChannelStatus>;
  renaming: string | null;
  onStartRename: (channelName: string | null) => void;
  onCommitRename: (channelName: string, name: string) => void;
  logFileId: Id<"files">;
  unitSystem?: UnitSystem;
  unitOverrides?: UnitOverrides;
  activeTraceId: string | null;
  onToggleGroup: (key: string) => void;
  onDragStart: (e: React.DragEvent, logFileId: Id<"files">, channelName: string) => void;
  onAddChannel: (traceId: string, channel: ChannelOnTrace) => void;
  onAddTraceWithChannel: (channel: ChannelOnTrace) => void;
  onCycleUnit?: (quantitySlug: string) => void;
  onNewMathChannel?: () => void;
  onEditMathChannel?: (name: string) => void;
}) {
  const groupKey = `${keyPrefix}${node.tag}`;
  const isOpen = isSearching || expanded.has(groupKey);
  const total = countGroupChannels(node);
  const color = isRoot ? (GROUP_COLORS[node.tag] ?? "#6b7280") : undefined;

  return (
    <div className={isRoot ? "mb-0.5" : "ml-3"}>
      <div className="flex items-center gap-1 pr-1">
        <button
          onClick={() => onToggleGroup(groupKey)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 rounded hover:bg-muted cursor-pointer"
        >
          <span className="text-[10px] w-3">{isOpen ? "\u25BC" : "\u25B6"}</span>
          {color && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
          <span className="flex-1 truncate">{node.tag}</span>
          <span className="font-normal normal-case tracking-normal text-[11px] opacity-50">
            {total}
          </span>
        </button>
        {node.tag === "Math" && onNewMathChannel && (
          <Tip content="New math channel — describe it and Claude writes the expression">
            <button
              onClick={(e) => { e.stopPropagation(); onNewMathChannel(); }}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </Tip>
        )}
      </div>
      {isOpen && (
        <div className={isRoot ? "ml-1 border-l-2 pl-0" : ""} style={isRoot && color ? { borderColor: color + "40" } : undefined}>
          {node.channels.map((ch) => (
            <ChannelRow
              key={ch.def.name}
              ch={ch}
              logFileId={logFileId}
              isEmpty={emptySet.has(ch.def.name)}
              status={statusMap.get(ch.def.name)}
              isRenaming={renaming === ch.def.name}
              onStartRename={() => onStartRename(ch.def.name)}
              onEditMathChannel={
                ch.def.custom && onEditMathChannel
                  ? () => onEditMathChannel(ch.def.name)
                  : undefined
              }
              onCommitRename={(name) => onCommitRename(ch.def.name, name)}
              unitSystem={isRoot ? unitSystem : undefined}
              unitOverrides={isRoot ? unitOverrides : undefined}
              onDragStart={onDragStart}
              onClick={() => {
                if (activeTraceId) {
                  onAddChannel(activeTraceId, { logFileId, channelName: ch.def.name });
                } else {
                  onAddTraceWithChannel({ logFileId, channelName: ch.def.name });
                }
              }}
              onCycleUnit={onCycleUnit}
            />
          ))}
          {node.children.map((child) => (
            <SidebarGroupNode
              key={`${keyPrefix}${node.tag}/${child.tag}`}
              node={child}
              keyPrefix={`${keyPrefix}${node.tag}/`}
              isSearching={isSearching}
              expanded={expanded}
              emptySet={emptySet}
              statusMap={statusMap}
              onNewMathChannel={onNewMathChannel}
              onEditMathChannel={onEditMathChannel}
              renaming={renaming}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              logFileId={logFileId}
              activeTraceId={activeTraceId}
              onToggleGroup={onToggleGroup}
              onDragStart={onDragStart}
              onAddChannel={onAddChannel}
              onAddTraceWithChannel={onAddTraceWithChannel}
              onCycleUnit={onCycleUnit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Explains why a channel is blank. A channel that reported a fault for its
 * whole run is a dead sensor, not a missing feature — worth saying plainly.
 */
function statusNote(status: ChannelStatus): string {
  const reason = status.dominantLabel ?? `status ${status.dominantCode}`;
  if (status.samples >= status.rowCount) return `no reading all run (${reason})`;
  const pct = Math.round((status.samples / status.rowCount) * 100);
  return `${reason} for ${pct || "<1"}% of the run`;
}

function ChannelRow({
  ch,
  logFileId,
  isEmpty,
  unitSystem,
  unitOverrides,
  onDragStart,
  onClick,
  onCycleUnit,
  status,
  isRenaming,
  onStartRename,
  onCommitRename,
  onEditMathChannel,
}: {
  ch: GroupChannel;
  logFileId: Id<"files">;
  isEmpty: boolean;
  unitSystem?: UnitSystem;
  unitOverrides?: UnitOverrides;
  onDragStart: (e: React.DragEvent, logFileId: Id<"files">, channelName: string) => void;
  onClick: () => void;
  onCycleUnit?: (quantitySlug: string) => void;
  onEditMathChannel?: () => void;
  status?: ChannelStatus;
  isRenaming: boolean;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
}) {
  const quantitySlug = ch.def.quantitySlug;
  const displayUnit = quantitySlug && unitSystem ? getDisplayUnit(quantitySlug, unitSystem, unitOverrides) : "";
  const canCycle = !!(quantitySlug && onCycleUnit && getUnitOptions(quantitySlug).length > 1);
  // When renamed, keep the ECU's own name visible so the channel stays
  // identifiable against the tuning software.
  const renamedFrom = ch.displayName !== ch.def.name ? ch.def.name : null;
  const baseTip = displayUnit ? `${ch.displayName} (${displayUnit})` : ch.displayName;
  const tipText = ch.def.computed
    ? `${baseTip} — math channel`
    : [baseTip, renamedFrom, ch.def.description, status && statusNote(status)]
        .filter(Boolean)
        .join(" — ");
  if (isRenaming) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 pl-6">
        <input
          autoFocus
          defaultValue={ch.displayName}
          onBlur={(e) => onCommitRename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename(e.currentTarget.value);
            if (e.key === "Escape") onCommitRename(ch.displayName);
          }}
          className="flex-1 min-w-0 bg-background border rounded px-1 py-0.5 text-sm"
        />
      </div>
    );
  }

  return (
    <Tip content={tipText} side="right">
      <div
        draggable
        onDragStart={(e) => onDragStart(e, logFileId, ch.def.name)}
        onClick={onClick}
        onContextMenu={
          ch.def.computed
            ? undefined
            : (e) => {
                e.preventDefault();
                onStartRename();
              }
        }
        className={`group flex items-center gap-2 px-2 py-1 pl-6 rounded text-sm cursor-pointer select-none ${
          isEmpty
            ? "opacity-35 text-muted-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        {ch.def.computed && (
          <span className="shrink-0 font-serif italic text-xs text-lime-400">ƒ</span>
        )}
        <span className="flex-1 truncate">{ch.displayName}</span>
        {onEditMathChannel && (
          <button
            onClick={(e) => { e.stopPropagation(); onEditMathChannel(); }}
            title="Edit this math channel"
            className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <PencilIcon className="size-3" />
          </button>
        )}
        {displayUnit && (
          canCycle ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCycleUnit!(quantitySlug!);
              }}
              title="Click to change units"
              className="text-xs text-muted-foreground hover:text-foreground border border-transparent hover:border-border rounded px-1 -mr-1 cursor-pointer"
            >
              {displayUnit}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">{displayUnit}</span>
          )
        )}
      </div>
    </Tip>
  );
}

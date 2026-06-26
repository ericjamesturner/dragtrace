import { useState, useMemo, useCallback, useRef } from "react";
import type { ChannelDef, LogSession } from "@/lib/log-types";
import type { LoadedLog, TraceConfig, ChannelOnTrace } from "@/lib/viewer-types";
import type { Id } from "../../../convex/_generated/dataModel";
import { PlusIcon, XIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { AddLogModal } from "./AddLogModal";
import { getDisplayUnit, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { GROUP_COLORS, type GroupNode, type GroupChannel } from "@/lib/channel-groups";
import { useChannelGroups } from "@/hooks/useChannelGroups";

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

  if (channels.length === 0 && children.length === 0) return null;

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
  loadedFileIds: Id<"files">[];
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
}

export function ViewerSidebar({
  logs,
  vehicleId,
  loadedFileIds,
  traces,
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
}: Props) {
  const [addLogOpen, setAddLogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(() => new Set(logs.map((l) => l.fileId)));
  const [isDragTarget, setIsDragTarget] = useState(false);
  const sidebarDragCounter = useRef(0);

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
  }, [logs]);

  // DB-driven channel grouping (falls back to hardcoded while loading)
  const { tree: masterTree } = useChannelGroups(allDefs, "haltech", vehicleId);

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
          const session = log.parsed.sessions[log.activeSessionIndex];
          const emptySet = emptyChannelsByLog.get(log.fileId) ?? new Set<string>();

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
              {isLogOpen && !mirroredLogIds.includes(log.fileId) && (
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
                      logFileId={log.fileId}
                      unitSystem={unitSystem}
                      unitOverrides={unitOverrides}
                      activeTraceId={activeTraceId}
                      onToggleGroup={toggleGroup}
                      onDragStart={handleDragStart}
                      onAddChannel={onAddChannel}
                      onAddTraceWithChannel={onAddTraceWithChannel}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Log button */}
      <div className="border-t p-3">
        <button
          onClick={() => setAddLogOpen(true)}
          className="flex items-center gap-1.5 w-full px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
        >
          <PlusIcon className="size-4" />
          Add Log
        </button>
      </div>

      <AddLogModal
        open={addLogOpen}
        onOpenChange={setAddLogOpen}
        currentVehicleId={vehicleId}
        loadedFileIds={loadedFileIds}
        onAddFile={onAddFile}
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
  logFileId,
  unitSystem,
  unitOverrides,
  activeTraceId,
  onToggleGroup,
  onDragStart,
  onAddChannel,
  onAddTraceWithChannel,
}: {
  node: GroupNode;
  keyPrefix: string;
  isRoot?: boolean;
  isSearching: boolean;
  expanded: Set<string>;
  emptySet: Set<string>;
  logFileId: Id<"files">;
  unitSystem?: UnitSystem;
  unitOverrides?: UnitOverrides;
  activeTraceId: string | null;
  onToggleGroup: (key: string) => void;
  onDragStart: (e: React.DragEvent, logFileId: Id<"files">, channelName: string) => void;
  onAddChannel: (traceId: string, channel: ChannelOnTrace) => void;
  onAddTraceWithChannel: (channel: ChannelOnTrace) => void;
}) {
  const groupKey = `${keyPrefix}${node.tag}`;
  const isOpen = isSearching || expanded.has(groupKey);
  const total = countGroupChannels(node);
  const color = isRoot ? (GROUP_COLORS[node.tag] ?? "#6b7280") : undefined;

  return (
    <div className={isRoot ? "mb-0.5" : "ml-3"}>
      <button
        onClick={() => onToggleGroup(groupKey)}
        className="flex items-center gap-1.5 w-full text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 rounded hover:bg-muted cursor-pointer"
      >
        <span className="text-[10px] w-3">{isOpen ? "\u25BC" : "\u25B6"}</span>
        {color && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
        <span className="flex-1">{node.tag}</span>
        <span className="font-normal normal-case tracking-normal text-[11px] opacity-50">
          {total}
        </span>
      </button>
      {isOpen && (
        <div className={isRoot ? "ml-1 border-l-2 pl-0" : ""} style={isRoot && color ? { borderColor: color + "40" } : undefined}>
          {node.channels.map((ch) => (
            <ChannelRow
              key={ch.def.name}
              ch={ch}
              logFileId={logFileId}
              isEmpty={emptySet.has(ch.def.name)}
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
              logFileId={logFileId}
              activeTraceId={activeTraceId}
              onToggleGroup={onToggleGroup}
              onDragStart={onDragStart}
              onAddChannel={onAddChannel}
              onAddTraceWithChannel={onAddTraceWithChannel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  ch,
  logFileId,
  isEmpty,
  unitSystem,
  unitOverrides,
  onDragStart,
  onClick,
}: {
  ch: GroupChannel;
  logFileId: Id<"files">;
  isEmpty: boolean;
  unitSystem?: UnitSystem;
  unitOverrides?: UnitOverrides;
  onDragStart: (e: React.DragEvent, logFileId: Id<"files">, channelName: string) => void;
  onClick: () => void;
}) {
  const displayUnit = ch.def.metricUnit && unitSystem ? getDisplayUnit(ch.def.metricUnit, unitSystem, unitOverrides) : "";
  const tipText = displayUnit ? `${ch.def.name} (${displayUnit})` : ch.def.name;
  return (
    <Tip content={tipText} side="right">
      <div
        draggable
        onDragStart={(e) => onDragStart(e, logFileId, ch.def.name)}
        onClick={onClick}
        className={`flex items-center gap-2 px-2 py-1 pl-6 rounded text-sm cursor-pointer select-none ${
          isEmpty
            ? "opacity-35 text-muted-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        <span className="flex-1 truncate">{ch.displayName}</span>
        {displayUnit && <span className="text-xs text-muted-foreground">{displayUnit}</span>}
      </div>
    </Tip>
  );
}

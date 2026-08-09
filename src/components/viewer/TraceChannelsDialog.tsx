import { useMemo, useState } from "react";
import type { LoadedLog, ChannelOnTrace } from "@/lib/viewer-types";
import type { GroupNode } from "@/lib/channel-groups";
import { useChannelGroups } from "@/hooks/useChannelGroups";
import { DEFAULT_ECU_TYPE } from "@/lib/ecu/registry";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, ArrowRightIcon, ChevronUpIcon, ChevronDownIcon, PencilIcon, PlusIcon } from "lucide-react";
import { MathChannelDialog } from "./MathChannelDialog";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { UnitSystem, UnitOverrides } from "@/lib/units";

interface Entry {
  name: string;
  displayName: string;
  group: string;
  aliases?: string[];
  custom?: boolean;
}

/** Channels of a node and everything under it. */
function countChannels(node: GroupNode): number {
  return node.channels.length + node.children.reduce((n, c) => n + countChannels(c), 0);
}

/**
 * Drop what's already on the trace and anything the search excludes, then drop
 * the groups left empty — the same shape the sidebar filters to.
 */
function filterNode(node: GroupNode, exclude: Set<string>, q: string): GroupNode | null {
  const channels = node.channels.filter((ch) => {
    if (exclude.has(ch.def.name)) return false;
    if (!q) return true;
    return (
      ch.def.name.toLowerCase().includes(q) ||
      ch.displayName.toLowerCase().includes(q) ||
      (ch.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false)
    );
  });
  const children = node.children
    .map((c) => filterNode(c, exclude, q))
    .filter((c): c is GroupNode => c !== null);
  if (channels.length === 0 && children.length === 0) return null;
  return { tag: node.tag, channels, children };
}

/** Flatten the grouped tree into one entry per channel, keeping its group name. */
function flatten(tree: GroupNode[]): Entry[] {
  const out: Entry[] = [];
  const walk = (node: GroupNode, path: string) => {
    const label = path ? `${path} / ${node.tag}` : node.tag;
    for (const ch of node.channels) {
      out.push({
        name: ch.def.name,
        displayName: ch.displayName,
        group: label,
        aliases: ch.aliases,
        custom: ch.def.custom,
      });
    }
    for (const child of node.children) walk(child, label);
  };
  for (const node of tree) walk(node, "");
  return out;
}

/**
 * Pick what a trace plots: everything the log has on the left, what's on the
 * trace on the right, and arrows or a drag between them. The sidebar can only
 * add one channel at a time and offers no way to see a trace's contents as a
 * list — this is for building a trace rather than tweaking one.
 */
export function TraceChannelsDialog({
  open,
  onOpenChange,
  logs,
  traceChannels,
  onAdd,
  onRemove,
  onReorder,
  vehicleId,
  mathChannels,
  mathVersion,
  unitSystem,
  unitOverrides,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: LoadedLog[];
  traceChannels: ChannelOnTrace[];
  onAdd: (names: string[]) => void;
  onRemove: (names: string[]) => void;
  onReorder: (channelNames: string[]) => void;
  vehicleId: Id<"vehicles">;
  mathChannels: Doc<"mathChannels">[];
  /** Bumped when math channels are recomputed into the logs. The parsed defs
   *  are mutated in place, so nothing else tells this list they changed. */
  mathVersion?: number;
  unitSystem?: UnitSystem;
  unitOverrides?: UnitOverrides;
}) {
  const [search, setSearch] = useState("");
  const [pickedAvailable, setPickedAvailable] = useState<Set<string>>(new Set());
  const [pickedSelected, setPickedSelected] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [mathDialog, setMathDialog] = useState<{ editing: Doc<"mathChannels"> | null } | null>(null);

  const allDefs = useMemo(() => {
    const seen = new Set<string>();
    const defs = [];
    for (const log of logs) {
      for (const def of log.parsed.channelDefs) {
        if (seen.has(def.name)) continue;
        seen.add(def.name);
        defs.push(def);
      }
    }
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, mathVersion]);

  const { tree } = useChannelGroups(allDefs, DEFAULT_ECU_TYPE);
  const entries = useMemo(() => flatten(tree), [tree]);
  const byName = useMemo(() => new Map(entries.map((e) => [e.name, e])), [entries]);

  // Trace order is the plot's draw order, so the right-hand list keeps it.
  const selectedNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const ch of traceChannels) {
      if (seen.has(ch.channelName)) continue;
      seen.add(ch.channelName);
      names.push(ch.channelName);
    }
    return names;
  }, [traceChannels]);

  const selectedSet = useMemo(() => new Set(selectedNames), [selectedNames]);

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;
  const availableTree = useMemo(
    () =>
      tree
        .map((node) => filterNode(node, selectedSet, query))
        .filter((n): n is GroupNode => n !== null),
    [tree, selectedSet, query],
  );
  const availableCount = useMemo(
    () => availableTree.reduce((n, node) => n + countChannels(node), 0),
    [availableTree],
  );

  const add = (names: string[]) => {
    if (names.length === 0) return;
    onAdd(names);
    setPickedAvailable(new Set());
  };
  const remove = (names: string[]) => {
    if (names.length === 0) return;
    onRemove(names);
    setPickedSelected(new Set());
  };

  const dragPayload = (name: string, from: "available" | "selected") =>
    JSON.stringify({ name, from });
  const readDrag = (e: React.DragEvent): { name: string; from: string } | null => {
    try {
      const raw = e.dataTransfer.getData("text/plain");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.name ? parsed : null;
    } catch {
      return null;
    }
  };

  /** Nudge one place up or down. Dragging can't be the only way to reorder:
   *  this list is built on HTML5 drag-and-drop, which touch never fires. */
  const nudge = (name: string, by: -1 | 1) => {
    const from = selectedNames.indexOf(name);
    const to = from + by;
    if (from < 0 || to < 0 || to >= selectedNames.length) return;
    const next = [...selectedNames];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorder(next);
  };

  /** Move `name` to sit where `before` is, or to the end when dropped past it. */
  const moveTo = (name: string, before: string | null) => {
    const rest = selectedNames.filter((n) => n !== name);
    const at = before === null ? rest.length : rest.indexOf(before);
    rest.splice(at < 0 ? rest.length : at, 0, name);
    onReorder(rest);
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setter(next);
  };

  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderGroup = (node: GroupNode, path: string) => {
    const key = path ? `${path}/${node.tag}` : node.tag;
    // A search has already narrowed things down, so everything it matched is
    // open — a hit inside a folded group may as well not exist.
    const open = isSearching || expandedGroups.has(key);
    return (
      <div key={key} className={path ? "ml-3" : ""}>
        <button
          onClick={() => toggleGroup(key)}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted"
        >
          <span className="w-3 text-[10px]">{open ? "\u25BC" : "\u25B6"}</span>
          <span className="min-w-0 flex-1 truncate">{node.tag}</span>
          <span className="font-normal normal-case tracking-normal tabular-nums opacity-60">
            {countChannels(node)}
          </span>
        </button>
        {open && (
          <div className="ml-3">
            {node.channels.map((ch) => (
              <div
                key={ch.def.name}
                draggable
                onDragStart={(ev) =>
                  ev.dataTransfer.setData("text/plain", dragPayload(ch.def.name, "available"))
                }
                onClick={() => toggle(pickedAvailable, setPickedAvailable, ch.def.name)}
                onDoubleClick={() => add([ch.def.name])}
                className={row(pickedAvailable.has(ch.def.name))}
              >
                <span className="min-w-0 flex-1 truncate">{ch.displayName}</span>
                {ch.def.custom && (
                  <button
                    title="Edit this math channel"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const def = mathChannels.find((m) => m.name === ch.def.name);
                      if (def) setMathDialog({ editing: def });
                    }}
                    className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    <PencilIcon className="size-3" />
                  </button>
                )}
              </div>
            ))}
            {node.children.map((child) => renderGroup(child, key))}
          </div>
        )}
      </div>
    );
  };

  const row = (picked: boolean) =>
    `flex w-full cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-left text-sm ${
      picked ? "bg-primary/20" : "hover:bg-muted"
    }`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPickedAvailable(new Set());
          setPickedSelected(new Set());
          setSearch("");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Channels on this trace</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
          {/* ── Available ─────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Available
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground/70">
                {availableCount}
              </span>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search channels…"
              className="mb-1.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const d = readDrag(e);
                if (d && selectedSet.has(d.name)) remove([d.name]);
              }}
              className="h-80 overflow-y-auto rounded-md border p-1"
            >
              {availableTree.map((node) => renderGroup(node, ""))}
              {availableCount === 0 && (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {search ? "Nothing matches." : "Every channel is on the trace."}
                </p>
              )}
            </div>
          </div>

          {/* ── Move ──────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center justify-center gap-2">
            <Button
              size="icon"
              variant="outline"
              title="Add the highlighted channels"
              disabled={pickedAvailable.size === 0}
              onClick={() => add([...pickedAvailable])}
            >
              <ArrowRightIcon className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              title="Take the highlighted channels off"
              disabled={pickedSelected.size === 0}
              onClick={() => remove([...pickedSelected])}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
          </div>

          {/* ── Selected ──────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                On this trace
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground/70">
                {selectedNames.length}
              </span>
            </div>
            {/* Spacer keeps the two lists level with the search box opposite. */}
            <div className="mb-1.5 h-[34px]" />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const d = readDrag(e);
                if (!d) return;
                if (d.from === "selected") moveTo(d.name, null);
                else if (!selectedSet.has(d.name)) add([d.name]);
              }}
              className="h-80 overflow-y-auto rounded-md border p-1"
            >
              {selectedNames.map((name, i) => {
                const e = byName.get(name);
                return (
                  <div
                    key={name}
                    draggable
                    onDragStart={(ev) => ev.dataTransfer.setData("text/plain", dragPayload(name, "selected"))}
                    onDragOver={(ev) => ev.preventDefault()}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      const d = readDrag(ev);
                      if (!d || d.name === name) return;
                      if (d.from === "selected") moveTo(d.name, name);
                      else if (!selectedSet.has(d.name)) add([d.name]);
                    }}
                    onClick={() => toggle(pickedSelected, setPickedSelected, name)}
                    onDoubleClick={() => remove([name])}
                    className={row(pickedSelected.has(name))}
                  >
                    <span className="min-w-0 flex-1 truncate">{e?.displayName ?? name}</span>
                    <span className="flex shrink-0 items-center">
                      <button
                        title="Move up"
                        disabled={i === 0}
                        onClick={(ev) => { ev.stopPropagation(); nudge(name, -1); }}
                        className="rounded p-0.5 text-muted-foreground enabled:cursor-pointer enabled:hover:text-foreground disabled:opacity-20"
                      >
                        <ChevronUpIcon className="size-3.5" />
                      </button>
                      <button
                        title="Move down"
                        disabled={i === selectedNames.length - 1}
                        onClick={(ev) => { ev.stopPropagation(); nudge(name, 1); }}
                        className="rounded p-0.5 text-muted-foreground enabled:cursor-pointer enabled:hover:text-foreground disabled:opacity-20"
                      >
                        <ChevronDownIcon className="size-3.5" />
                      </button>
                    </span>
                    <span className="shrink-0 truncate text-[10px] text-muted-foreground/60">
                      {e?.group}
                    </span>
                  </div>
                );
              })}
              {selectedNames.length === 0 && (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Nothing on this trace yet.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => setMathDialog({ editing: null })}>
              <PlusIcon className="size-3.5" />
              Math channel
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Double-click or drag to move a channel across. Reorder with the
              arrows, or by dragging within the right list.
            </p>
          </div>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
      {mathDialog && (
        <MathChannelDialog
          open
          onOpenChange={(o) => { if (!o) setMathDialog(null); }}
          vehicleId={vehicleId}
          channelNames={entries.filter((e) => !e.custom).map((e) => e.name)}
          unitSystem={unitSystem ?? "imperial"}
          unitOverrides={unitOverrides}
          editing={mathDialog.editing}
          onCreated={(channelName) => onAdd([channelName])}
        />
      )}
    </Dialog>
  );
}

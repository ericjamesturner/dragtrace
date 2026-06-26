import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftIcon,
  PlusIcon,
  XIcon,
  PencilIcon,
  CheckIcon,
  FolderPlusIcon,
} from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

type Category = Doc<"channelCategories">;
type Mapping = Doc<"channelMappings">;

// What's being dragged
type DragItem =
  | { type: "channel"; channelName: string; fromCatId: string }
  | { type: "category"; catId: string; parentId: string | null };

// Where to show the insertion line
type DropIndicator = {
  catId: string;     // parent category
  index: number;     // insertion index among combined [subcats..., channels...]
} | null;

export function ChannelManager() {
  const { goToVehicles } = useNav();
  const ecuType = "haltech";

  const categories = useQuery(api.channelCategories.listByEcuType, { ecuType });
  const mappings = useQuery(api.channelMappings.listByEcuType, { ecuType });

  const createCategory = useMutation(api.channelCategories.create);
  const updateCategory = useMutation(api.channelCategories.update);
  const removeCategory = useMutation(api.channelCategories.remove);
  const reorderCategories = useMutation(api.channelCategories.reorder);
  const moveMapping = useMutation(api.channelMappings.move);
  const reorderMappings = useMutation(api.channelMappings.reorder);
  const setDisplayNameMut = useMutation(api.channelMappings.setDisplayName);
  const setAliasesMut = useMutation(api.channelMappings.setAliases);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [addingSubTo, setAddingSubTo] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  // Drag state
  const dragItemRef = useRef<DragItem | null>(null);
  const [dragChannelName, setDragChannelName] = useState<string | null>(null);
  const [dropTargetCatId, setDropTargetCatId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);

  const loading = categories === undefined || mappings === undefined;

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Category[]>();
    for (const cat of categories ?? []) {
      const parentKey = cat.parentId ?? null;
      const list = map.get(parentKey) ?? [];
      list.push(cat);
      map.set(parentKey, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [categories]);

  const primaryMappingsByCat = useMemo(() => {
    const map = new Map<string, Mapping[]>();
    for (const m of mappings ?? []) {
      const list = map.get(m.categoryId) ?? [];
      list.push(m);
      map.set(m.categoryId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    return map;
  }, [mappings]);

  const channelCountOf = useCallback(
    (catId: string): number => {
      const direct = (primaryMappingsByCat.get(catId) ?? []).length;
      const kids = childrenOf.get(catId) ?? [];
      return direct + kids.reduce((sum, c) => sum + channelCountOf(c._id), 0);
    },
    [primaryMappingsByCat, childrenOf],
  );

  const selectedMapping = useMemo(
    () => (mappings ?? []).find((m) => m.channelName === selectedChannel) ?? null,
    [mappings, selectedChannel],
  );

  const catPath = useCallback(
    (catId: string): string => {
      const cat = (categories ?? []).find((c) => c._id === catId);
      if (!cat) return "?";
      if (!cat.parentId) return cat.name;
      return catPath(cat.parentId) + " / " + cat.name;
    },
    [categories],
  );

  const searchLower = search.toLowerCase();
  const searchResults = useMemo(() => {
    if (!searchLower || !mappings) return null;
    return mappings.filter(
      (m) =>
        m.channelName.toLowerCase().includes(searchLower) ||
        (m.displayName && m.displayName.toLowerCase().includes(searchLower)) ||
        (m.aliases && m.aliases.some((a) => a.toLowerCase().includes(searchLower))),
    );
  }, [searchLower, mappings]);

  // ── Handlers ──

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRename = async (catId: Id<"channelCategories">) => {
    if (!editingCatName.trim()) return;
    await updateCategory({ id: catId, name: editingCatName.trim() });
    setEditingCatId(null);
  };

  const handleAddSub = async (parentId: Id<"channelCategories">) => {
    if (!newSubName.trim()) return;
    const siblings = childrenOf.get(parentId) ?? [];
    await createCategory({
      name: newSubName.trim(),
      parentId,
      ecuType,
      sortOrder: (siblings.length + 1) * 10,
    });
    setAddingSubTo(null);
    setNewSubName("");
    setExpanded((prev) => new Set(prev).add(parentId));
  };

  const handleAddRoot = async () => {
    const roots = childrenOf.get(null) ?? [];
    await createCategory({
      name: "New Category",
      ecuType,
      sortOrder: (roots.length + 1) * 10,
    });
  };

  // ── Drag & Drop ──

  const handleDragStart = (e: React.DragEvent, item: DragItem) => {
    dragItemRef.current = item;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(item));
    if (item.type === "channel") setDragChannelName(item.channelName);
  };

  const handleDragEnd = () => {
    dragItemRef.current = null;
    setDragChannelName(null);
    setDropTargetCatId(null);
    setDropIndicator(null);
  };

  const handleCatHeaderDragOver = (e: React.DragEvent, catId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropTargetCatId(catId);
    setDropIndicator(null);
  };

  const handleCatHeaderDragLeave = (e: React.DragEvent, catId: string) => {
    e.stopPropagation();
    if (dropTargetCatId === catId) setDropTargetCatId(null);
  };

  const handleCatHeaderDrop = async (e: React.DragEvent, catId: Id<"channelCategories">) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetCatId(null);
    setDropIndicator(null);
    const item = dragItemRef.current;
    if (!item) return;
    dragItemRef.current = null;
    setDragChannelName(null);

    if (item.type === "channel") {
      // Move channel into this category (at the end)
      const existing = primaryMappingsByCat.get(catId) ?? [];
      const maxSort = existing.reduce((max, m) => Math.max(max, m.sortOrder ?? 0), 0);
      await moveMapping({ channelName: item.channelName, ecuType, newCategoryId: catId });
      await reorderMappings({ updates: [{ channelName: item.channelName, ecuType, sortOrder: maxSort + 10 }] });
    } else if (item.type === "category") {
      // Move subcategory under this parent
      const siblings = childrenOf.get(catId) ?? [];
      const maxSort = siblings.reduce((max, c) => Math.max(max, c.sortOrder), 0);
      await updateCategory({ id: item.catId as Id<"channelCategories">, parentId: catId, sortOrder: maxSort + 10 });
    }
  };

  // Item-level drag over for reordering (shows insertion line)
  const handleItemDragOver = (
    e: React.DragEvent,
    parentCatId: string,
    itemIndex: number,
    _itemCount: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const insertAfter = y > rect.height / 2;
    const idx = insertAfter ? itemIndex + 1 : itemIndex;
    setDropIndicator({ catId: parentCatId, index: idx });
    setDropTargetCatId(null);
  };

  const handleItemDragLeave = () => {
    setDropIndicator(null);
  };

  const handleItemDrop = async (e: React.DragEvent, parentCatId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const indicator = dropIndicator;
    setDropIndicator(null);
    setDropTargetCatId(null);

    const item = dragItemRef.current;
    if (!item || !indicator) return;
    dragItemRef.current = null;
    setDragChannelName(null);

    // Build the current unified item list for this parent
    const kids = childrenOf.get(parentCatId) ?? [];
    const channels = primaryMappingsByCat.get(parentCatId) ?? [];
    type UnifiedItem =
      | { kind: "cat"; id: string; sortOrder: number }
      | { kind: "channel"; name: string; sortOrder: number };
    const unified: UnifiedItem[] = [
      ...kids.map((k) => ({ kind: "cat" as const, id: k._id, sortOrder: k.sortOrder })),
      ...channels.map((m) => ({ kind: "channel" as const, name: m.channelName, sortOrder: m.sortOrder ?? 0 })),
    ];
    unified.sort((a, b) => a.sortOrder - b.sortOrder);

    // Remove the dragged item from the list
    const dragId = item.type === "channel" ? item.channelName : item.catId;
    const filtered = unified.filter((u) =>
      u.kind === "cat" ? u.id !== dragId : u.name !== dragId
    );

    // Insert at the indicator position
    const insertIdx = Math.max(0, Math.min(filtered.length, indicator.index));
    const newItem: UnifiedItem = item.type === "channel"
      ? { kind: "channel", name: item.channelName, sortOrder: 0 }
      : { kind: "cat", id: item.catId, sortOrder: 0 };
    filtered.splice(insertIdx, 0, newItem);

    // If coming from a different category, move/reparent first
    if (item.type === "channel" && item.fromCatId !== parentCatId) {
      await moveMapping({ channelName: item.channelName, ecuType, newCategoryId: parentCatId as Id<"channelCategories"> });
    } else if (item.type === "category" && item.parentId !== parentCatId) {
      await updateCategory({ id: item.catId as Id<"channelCategories">, parentId: parentCatId as Id<"channelCategories"> });
    }

    // Assign new sort orders to all items
    const catUpdates: { id: Id<"channelCategories">; sortOrder: number }[] = [];
    const channelUpdates: { channelName: string; ecuType: string; sortOrder: number }[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const u = filtered[i];
      if (u.kind === "cat") {
        catUpdates.push({ id: u.id as Id<"channelCategories">, sortOrder: i * 10 });
      } else {
        channelUpdates.push({ channelName: u.name, ecuType, sortOrder: i * 10 });
      }
    }
    if (catUpdates.length > 0) await reorderCategories({ updates: catUpdates });
    if (channelUpdates.length > 0) await reorderMappings({ updates: channelUpdates });
  };

  // ── Render ──

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading channel data...
      </div>
    );
  }

  if ((categories ?? []).length === 0) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">No channel categories yet.</p>
          <p className="text-sm text-muted-foreground">
            Open a log in the viewer — channels will be automatically categorized.
          </p>
          <Button variant="ghost" onClick={goToVehicles}>
            <ArrowLeftIcon className="size-4 mr-2" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  const rootCats = childrenOf.get(null) ?? [];

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-2 border-b px-4 py-3 shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={goToVehicles}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <h1 className="text-sm font-semibold tracking-tight">Channel Manager</h1>
        <div className="flex-1" />
        <div className="w-64">
          <input
            type="text"
            placeholder="Search channels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 rounded bg-muted border border-border text-sm placeholder:text-muted-foreground outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto border-r">
          <div className="max-w-2xl py-3 px-3">
            {searchResults ? (
              <div className="space-y-0.5">
                <div className="text-xs text-muted-foreground px-2 py-1 font-medium mb-2">
                  {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                </div>
                {searchResults.map((m) => (
                  <Tip key={m._id} content={m.channelName} side="right">
                    <button
                      onClick={() => setSelectedChannel(m.channelName)}
                      className={`flex items-center gap-2 w-full text-left px-3 py-1.5 rounded text-sm cursor-pointer ${
                        selectedChannel === m.channelName ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="truncate">{m.displayName ?? m.channelName}</span>
                      {m.displayName && (
                        <span className="text-xs text-muted-foreground shrink-0">({m.channelName})</span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">{catPath(m.categoryId)}</span>
                    </button>
                  </Tip>
                ))}
              </div>
            ) : (
              <>
                {rootCats.map((cat) => (
                  <CategoryNode
                    key={cat._id}
                    cat={cat}
                    depth={0}
                    childrenOf={childrenOf}
                    primaryMappingsByCat={primaryMappingsByCat}
                    channelCountOf={channelCountOf}
                    expanded={expanded}
                    onToggle={toggle}
                    editingCatId={editingCatId}
                    editingCatName={editingCatName}
                    onStartRename={(id, name) => { setEditingCatId(id); setEditingCatName(name); }}
                    onRename={handleRename}
                    onCancelRename={() => setEditingCatId(null)}
                    onSetEditingCatName={setEditingCatName}
                    addingSubTo={addingSubTo}
                    newSubName={newSubName}
                    onStartAddSub={(id) => { setAddingSubTo(id); setNewSubName(""); }}
                    onAddSub={handleAddSub}
                    onCancelAddSub={() => setAddingSubTo(null)}
                    onSetNewSubName={setNewSubName}
                    onRemoveCategory={(id) => removeCategory({ id })}
                    selectedChannel={selectedChannel}
                    onSelectChannel={setSelectedChannel}
                    dragChannelName={dragChannelName}
                    dropTargetCatId={dropTargetCatId}
                    dropIndicator={dropIndicator}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onCatHeaderDragOver={handleCatHeaderDragOver}
                    onCatHeaderDragLeave={handleCatHeaderDragLeave}
                    onCatHeaderDrop={handleCatHeaderDrop}
                    onItemDragOver={handleItemDragOver}
                    onItemDragLeave={handleItemDragLeave}
                    onItemDrop={handleItemDrop}
                  />
                ))}
                <button
                  onClick={handleAddRoot}
                  className="flex items-center gap-1.5 w-full px-3 py-2 mt-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                >
                  <PlusIcon className="size-4" />
                  Add Category
                </button>
              </>
            )}
          </div>
        </div>

        <div className="w-80 shrink-0 overflow-y-auto">
          {selectedMapping ? (
            <ChannelDetail
              key={selectedMapping.channelName}
              mapping={selectedMapping}
              ecuType={ecuType}
              catPath={catPath}
              categories={categories!}
              onSetDisplayName={async (displayName) => {
                await setDisplayNameMut({ channelName: selectedMapping.channelName, ecuType, displayName });
              }}
              onSetAliases={async (aliases) => {
                await setAliasesMut({ channelName: selectedMapping.channelName, ecuType, aliases });
              }}
              onMove={async (newCatId) => {
                await moveMapping({ channelName: selectedMapping.channelName, ecuType, newCategoryId: newCatId });
              }}
              onClose={() => setSelectedChannel(null)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Click a channel to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detail panel ──

function ChannelDetail({
  mapping: m,
  catPath,
  categories,
  onSetDisplayName,
  onSetAliases,
  onMove,
  onClose,
}: {
  mapping: Mapping;
  ecuType: string;
  catPath: (catId: string) => string;
  categories: Category[];
  onSetDisplayName: (name: string) => Promise<void>;
  onSetAliases: (aliases: string[]) => Promise<void>;
  onMove: (catId: Id<"channelCategories">) => Promise<void>;
  onClose: () => void;
}) {
  const [displayNameInput, setDisplayNameInput] = useState(m.displayName ?? "");
  const [aliasInput, setAliasInput] = useState("");

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold truncate" title={m.channelName}>{m.channelName}</h2>
        <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer">
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Display Name</label>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (displayNameInput.trim()) await onSetDisplayName(displayNameInput.trim());
          }}
          className="flex items-center gap-1.5"
        >
          <input
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value)}
            placeholder={m.channelName}
            className="flex-1 px-2 py-1 text-sm bg-muted border border-border rounded outline-none focus:border-primary"
          />
          {displayNameInput !== (m.displayName ?? "") && (
            <button type="submit" className="p-1 text-primary cursor-pointer">
              <CheckIcon className="size-3.5" />
            </button>
          )}
        </form>
        <p className="text-[11px] text-muted-foreground mt-1">Short name shown in sidebar and charts</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Aliases</label>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {(m.aliases ?? []).length === 0 && (
            <span className="text-xs text-muted-foreground/50">None</span>
          )}
          {(m.aliases ?? []).map((alias) => (
            <span key={alias} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded">
              {alias}
              <button
                onClick={() => onSetAliases((m.aliases ?? []).filter((a) => a !== alias))}
                className="text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <XIcon className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!aliasInput.trim()) return;
            await onSetAliases([...(m.aliases ?? []), aliasInput.trim()]);
            setAliasInput("");
          }}
          className="flex items-center gap-1.5"
        >
          <input
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            placeholder="Add alias..."
            className="flex-1 px-2 py-1 text-sm bg-muted border border-border rounded outline-none focus:border-primary"
          />
          <button type="submit" disabled={!aliasInput.trim()} className="p-1 text-primary cursor-pointer disabled:opacity-30">
            <PlusIcon className="size-3.5" />
          </button>
        </form>
        <p className="text-[11px] text-muted-foreground mt-1">Alternate names matched during search</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
        <p className="text-sm mb-1.5">{catPath(m.categoryId)}</p>
        <select
          value={m.categoryId}
          onChange={async (e) => {
            if (e.target.value !== m.categoryId) {
              await onMove(e.target.value as Id<"channelCategories">);
            }
          }}
          className="w-full px-2 py-1 text-sm bg-muted border border-border rounded outline-none focus:border-primary"
        >
          {categories
            .filter((c) => !c.parentId)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((root) => {
              const kids = categories
                .filter((c) => c.parentId === root._id)
                .sort((a, b) => a.sortOrder - b.sortOrder);
              return (
                <optgroup key={root._id} label={root.name}>
                  <option value={root._id}>{root.name}</option>
                  {kids.map((kid) => (
                    <option key={kid._id} value={kid._id}>{"  " + kid.name}</option>
                  ))}
                </optgroup>
              );
            })}
        </select>
      </div>
    </div>
  );
}

// ── Tree nodes ──

interface CategoryNodeProps {
  cat: Category;
  depth: number;
  childrenOf: Map<string | null, Category[]>;
  primaryMappingsByCat: Map<string, Mapping[]>;
  channelCountOf: (catId: string) => number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  editingCatId: string | null;
  editingCatName: string;
  onStartRename: (id: string, name: string) => void;
  onRename: (id: Id<"channelCategories">) => void;
  onCancelRename: () => void;
  onSetEditingCatName: (name: string) => void;
  addingSubTo: string | null;
  newSubName: string;
  onStartAddSub: (id: string) => void;
  onAddSub: (parentId: Id<"channelCategories">) => void;
  onCancelAddSub: () => void;
  onSetNewSubName: (name: string) => void;
  onRemoveCategory: (id: Id<"channelCategories">) => void;
  selectedChannel: string | null;
  onSelectChannel: (name: string) => void;
  dragChannelName: string | null;
  dropTargetCatId: string | null;
  dropIndicator: DropIndicator;
  onDragStart: (e: React.DragEvent, item: DragItem) => void;
  onDragEnd: () => void;
  onCatHeaderDragOver: (e: React.DragEvent, catId: string) => void;
  onCatHeaderDragLeave: (e: React.DragEvent, catId: string) => void;
  onCatHeaderDrop: (e: React.DragEvent, catId: Id<"channelCategories">) => void;
  onItemDragOver: (e: React.DragEvent, parentCatId: string, itemIndex: number, itemCount: number) => void;
  onItemDragLeave: () => void;
  onItemDrop: (e: React.DragEvent, parentCatId: string) => void;
}

function CategoryNode(props: CategoryNodeProps) {
  const {
    cat, depth, childrenOf: childrenMap, primaryMappingsByCat, channelCountOf,
    expanded, onToggle,
    editingCatId, editingCatName, onStartRename, onRename, onCancelRename, onSetEditingCatName,
    addingSubTo, newSubName, onStartAddSub, onAddSub, onCancelAddSub, onSetNewSubName,
    onRemoveCategory,
    selectedChannel, onSelectChannel,
    dragChannelName, dropTargetCatId, dropIndicator,
    onDragStart, onDragEnd,
    onCatHeaderDragOver, onCatHeaderDragLeave, onCatHeaderDrop,
    onItemDragOver, onItemDragLeave, onItemDrop,
  } = props;

  const isExpanded = expanded.has(cat._id);
  const kids = childrenMap.get(cat._id) ?? [];
  const channels = primaryMappingsByCat.get(cat._id) ?? [];
  const totalCount = channelCountOf(cat._id);
  const hasContent = totalCount > 0 || kids.length > 0;
  const isDropTarget = dropTargetCatId === cat._id;
  const isRoot = depth === 0;

  // Build unified item list: subcategories + channels sorted together
  type Item =
    | { kind: "cat"; cat: Category; sortOrder: number }
    | { kind: "channel"; mapping: Mapping; sortOrder: number };

  const items: Item[] = [
    ...kids.map((k) => ({ kind: "cat" as const, cat: k, sortOrder: k.sortOrder })),
    ...channels.map((m) => ({ kind: "channel" as const, mapping: m, sortOrder: m.sortOrder ?? 0 })),
  ];
  items.sort((a, b) => a.sortOrder - b.sortOrder);

  const showIndicatorAt = (idx: number) =>
    dropIndicator?.catId === cat._id && dropIndicator.index === idx;

  const insertLine = (
    <div className="h-0.5 bg-primary rounded-full mx-2 my-0.5" />
  );

  return (
    <div className={isRoot ? "mb-0.5" : ""}>
      {/* Category header — drop target for "move into" */}
      <div
        draggable={!isRoot}
        onDragStart={(e) => {
          if (isRoot) return;
          e.stopPropagation();
          onDragStart(e, { type: "category", catId: cat._id, parentId: cat.parentId ?? null });
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => onCatHeaderDragOver(e, cat._id)}
        onDragLeave={(e) => onCatHeaderDragLeave(e, cat._id)}
        onDrop={(e) => onCatHeaderDrop(e, cat._id)}
        className={`flex items-center gap-1.5 rounded group transition-colors ${
          isDropTarget ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/50"
        } ${!isRoot ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <button
          onClick={() => onToggle(cat._id)}
          className="text-[10px] w-3 shrink-0 cursor-pointer text-muted-foreground"
        >
          {hasContent ? (isExpanded ? "▼" : "▶") : " "}
        </button>
        {cat.color && (
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
        )}
        {editingCatId === cat._id ? (
          <form
            onSubmit={(e) => { e.preventDefault(); onRename(cat._id); }}
            className="flex-1 flex items-center gap-1 py-1"
          >
            <input
              value={editingCatName}
              onChange={(e) => onSetEditingCatName(e.target.value)}
              className="flex-1 text-sm bg-muted border border-border rounded px-2 py-0.5 outline-none focus:border-primary"
              autoFocus
              onBlur={() => onCancelRename()}
              onKeyDown={(e) => { if (e.key === "Escape") onCancelRename(); }}
            />
          </form>
        ) : (
          <button
            onClick={() => onToggle(cat._id)}
            title={cat.name}
            className="flex-1 text-left truncate cursor-pointer py-1.5 text-sm font-semibold"
          >
            {cat.name}
          </button>
        )}
        <span className="text-xs text-muted-foreground tabular-nums mr-1">{totalCount}</span>
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 mr-1 shrink-0">
          <button onClick={() => onStartRename(cat._id, cat.name)} className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" title="Rename">
            <PencilIcon className="size-3" />
          </button>
          <button onClick={() => onStartAddSub(cat._id)} className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer" title="Add subcategory">
            <FolderPlusIcon className="size-3" />
          </button>
          {cat.name !== "Other" && (
            <button onClick={() => onRemoveCategory(cat._id)} className="p-0.5 text-muted-foreground hover:text-destructive cursor-pointer" title="Delete (channels move to Other)">
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div>
          {showIndicatorAt(0) && insertLine}
          {items.map((item, i) => {
            if (item.kind === "cat") {
              return (
                <div
                  key={item.cat._id}
                  onDragOver={(e) => onItemDragOver(e, cat._id, i, items.length)}
                  onDragLeave={onItemDragLeave}
                  onDrop={(e) => onItemDrop(e, cat._id)}
                >
                  <CategoryNode {...props} cat={item.cat} depth={depth + 1} />
                  {showIndicatorAt(i + 1) && insertLine}
                </div>
              );
            }
            const m = item.mapping;
            return (
              <div key={m._id}>
                <Tip content={m.channelName} side="right">
                  <button
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      onDragStart(e, { type: "channel", channelName: m.channelName, fromCatId: cat._id });
                    }}
                    onDragEnd={onDragEnd}
                    onDragOver={(e) => onItemDragOver(e, cat._id, i, items.length)}
                    onDragLeave={onItemDragLeave}
                    onDrop={(e) => onItemDrop(e, cat._id)}
                    onClick={() => onSelectChannel(m.channelName)}
                    className={`flex items-center gap-1.5 w-full text-left rounded text-sm py-1 cursor-grab active:cursor-grabbing transition-colors ${
                      dragChannelName === m.channelName
                        ? "opacity-40"
                        : selectedChannel === m.channelName
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted/30 text-foreground"
                    }`}
                    style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
                  >
                    <span className="truncate">{m.displayName ?? m.channelName}</span>
                    {m.displayName && (
                      <span className="text-xs text-muted-foreground shrink-0">({m.channelName})</span>
                    )}
                  </button>
                </Tip>
                {showIndicatorAt(i + 1) && insertLine}
              </div>
            );
          })}

          {addingSubTo === cat._id && (
            <form
              onSubmit={(e) => { e.preventDefault(); onAddSub(cat._id); }}
              className="flex items-center gap-1 py-1"
              style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
            >
              <FolderPlusIcon className="size-3 text-muted-foreground shrink-0" />
              <input
                value={newSubName}
                onChange={(e) => onSetNewSubName(e.target.value)}
                placeholder="Subcategory name..."
                className="flex-1 text-sm bg-muted border border-border rounded px-2 py-0.5 outline-none focus:border-primary"
                autoFocus
                onBlur={() => { if (!newSubName.trim()) onCancelAddSub(); }}
                onKeyDown={(e) => { if (e.key === "Escape") onCancelAddSub(); }}
              />
              <button type="submit" className="p-0.5 text-primary cursor-pointer">
                <CheckIcon className="size-3.5" />
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LayoutGridIcon, CheckIcon, ChevronDownIcon } from "lucide-react";

interface Props {
  workspaces: Doc<"workspaces">[];
  activeId: Id<"workspaces"> | null;
  onSelect: (ws: Doc<"workspaces">) => void;
  onSaveAsNew: (name: string) => void;
  onRename: (id: Id<"workspaces">, name: string) => void;
  onDelete: (id: Id<"workspaces">) => void;
}

/** Named workspace switcher: per-vehicle saved viewer layouts. */
export function WorkspaceMenu({
  workspaces,
  activeId,
  onSelect,
  onSaveAsNew,
  onRename,
  onDelete,
}: Props) {
  const active = workspaces.find((w) => w._id === activeId) ?? null;
  const sorted = [...workspaces].sort((a, b) => a.name.localeCompare(b.name));

  const handleSaveAsNew = () => {
    const name = window.prompt("Name for the new workspace:", "");
    if (name?.trim()) onSaveAsNew(name.trim());
  };

  const handleRename = () => {
    if (!active) return;
    const name = window.prompt("Rename workspace:", active.name);
    if (name?.trim() && name.trim() !== active.name) onRename(active._id, name.trim());
  };

  const handleDelete = () => {
    if (!active) return;
    if (window.confirm(`Delete workspace "${active.name}"?`)) onDelete(active._id);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" title="Workspaces — saved viewer layouts for this vehicle" />}
      >
        <LayoutGridIcon className="size-4 mr-1" />
        <span className="max-w-[280px] truncate">{active?.name ?? "Default"}</span>
        <ChevronDownIcon className="size-3 ml-1 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[280px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {sorted.map((ws) => (
            <DropdownMenuItem key={ws._id} onClick={() => onSelect(ws)}>
              <CheckIcon
                className={`size-3.5 ${ws._id === activeId ? "opacity-100" : "opacity-0"}`}
              />
              <span className="max-w-[380px] truncate">{ws.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSaveAsNew}>Save as new…</DropdownMenuItem>
          {active && <DropdownMenuItem onClick={handleRename}>Rename current…</DropdownMenuItem>}
          {active && (
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              Delete current
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { ChangeForm } from "./ChangeForm";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, MoreVerticalIcon, PencilIcon, PlusIcon, TrashIcon, WrenchIcon, CpuIcon } from "lucide-react";
import { categoryLabel, isBigChange } from "@/lib/changes";
import { runLabel } from "@/lib/tune-changes";

/** Every change on the car, newest first: hardware logged by hand, tune changes read from the logs. */
export function ChangesPage({ vehicleId }: { vehicleId: Id<"vehicles"> }) {
  const { goToEvents } = useNav();
  const vehicle = useQuery(api.vehicles.get, { id: vehicleId });
  const changes = useQuery(api.changes.listByVehicle, { vehicleId });
  const files = useQuery(api.files.listByVehicle, { vehicleId });
  const events = useQuery(api.events.listByVehicle, { vehicleId });
  const remove = useMutation(api.changes.remove);
  const [editing, setEditing] = useState<Doc<"changes"> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const passName = useMemo(() => {
    const eventName = new Map((events ?? []).map((e) => [e._id as string, e.name]));
    const byId = new Map((files ?? []).map((f) => [f._id as string, f]));
    return (id: string | undefined) => {
      const f = id ? byId.get(id) : undefined;
      return f ? `${f.round ?? runLabel(f.fileName)} · ${eventName.get(f.eventId) ?? ""}` : undefined;
    };
  }, [files, events]);

  return (
    <div className="max-w-4xl p-6">
      <button
        onClick={() => goToEvents(vehicleId)}
        className="mb-2 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        {vehicle?.name ?? "..."}
      </button>
      <div className="mb-6 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Changes</h2>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <PlusIcon />
          Log change
        </Button>
      </div>

      {changes === undefined ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
      ) : changes.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nothing logged yet. Log hardware changes here; tune changes appear on their own when you upload .hlgzip logs.
        </p>
      ) : (
        <div className="space-y-2">
          {changes.map((c) => {
            const expanded = open.has(c._id);
            const items = c.items ?? [];
            const after = passName(c.afterFileId);
            const to = passName(c.toFileId);
            return (
              <div key={c._id} className="group rounded-lg border px-4 py-3">
                <div className="flex items-start gap-3">
                  {c.source === "tune" ? (
                    <CpuIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <WrenchIcon className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{c.date}</span>
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wider ${
                          isBigChange(c) ? "text-amber-400" : "text-muted-foreground"
                        }`}
                      >
                        {categoryLabel(c.category)}
                      </span>
                      <span className="text-sm font-medium">{c.title}</span>
                    </div>
                    {(after || to) && (
                      <div className="text-xs text-muted-foreground">
                        {after && to ? `${after} → ${to}` : after ? `after ${after}` : `first on ${to}`}
                      </div>
                    )}
                    {c.notes && <p className="mt-1 text-sm text-muted-foreground">{c.notes}</p>}
                    {items.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setOpen((s) => {
                            const next = new Set(s);
                            if (next.has(c._id)) next.delete(c._id);
                            else next.add(c._id);
                            return next;
                          })
                        }
                        className="mt-1 flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
                        What moved
                      </button>
                    )}
                    {expanded && (
                      <ul className="mt-1 space-y-0.5 border-l pl-3 font-mono text-xs text-muted-foreground">
                        {items.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100" />}
                    >
                      <MoreVerticalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {c.source === "manual" && (
                        <DropdownMenuItem
                          onClick={() => {
                            setEditing(c);
                            setFormOpen(true);
                          }}
                        >
                          <PencilIcon />
                          Edit
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          if (window.confirm(`Delete "${c.title}"?`)) void remove({ id: c._id });
                        }}
                      >
                        <TrashIcon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ChangeForm open={formOpen} onOpenChange={setFormOpen} vehicleId={vehicleId} change={editing ?? undefined} />
    </div>
  );
}

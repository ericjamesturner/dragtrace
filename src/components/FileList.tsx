import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useNav } from "./Layout";
import { FileUpload } from "./FileUpload";
import { TimeslipForm } from "./TimeslipForm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeftIcon,
  DownloadIcon,
  TrashIcon,
  FileIcon,
  PlusIcon,
  PencilIcon,
  GripVerticalIcon,
} from "lucide-react";
import { RpmPreview, type RaceTimingInfo } from "./RpmPreview";
import { Tip } from "@/components/ui/tooltip";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileList({
  vehicleId,
  eventId,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
}) {
  const vehicle = useQuery(api.vehicles.get, { id: vehicleId });
  const event = useQuery(api.events.get, { id: eventId });
  const files = useQuery(api.files.listByEvent, { eventId });
  const removeFile = useMutation(api.files.remove);
  const reorderFiles = useMutation(api.files.reorder);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  const { goToEvents, goToViewer } = useNav();

  const getDropIdx = useCallback((e: React.DragEvent<HTMLElement>) => {
    const children = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-file-idx]"));
    let closest = 0;
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY > midY) {
        closest = Number(child.dataset.fileIdx) + 1;
      }
    }
    return closest;
  }, []);

  const handleOpenViewer = useCallback((fileId: Id<"files">) => {
    goToViewer(vehicleId, eventId, [fileId]);
  }, [goToViewer, vehicleId, eventId]);

  // Alignment: collect race timing info from each file's preview
  const [raceTimings, setRaceTimings] = useState<Record<string, RaceTimingInfo | null>>({});
  const raceTimingsRef = useRef(raceTimings);
  raceTimingsRef.current = raceTimings;

  const handleRaceTiming = useCallback((fileId: string, info: RaceTimingInfo | null) => {
    const prev = raceTimingsRef.current[fileId];
    if (
      prev?.raceStart === info?.raceStart &&
      prev?.raceEnd === info?.raceEnd &&
      prev?.logDuration === info?.logDuration
    ) return;
    setRaceTimings(prev => ({ ...prev, [fileId]: info }));
  }, []);

  // Fixed lead-in before the race start, then the longest pass across
  // files (timer-counting region) plus a short tail.
  const PRE_RACE_S = 2;
  const POST_RACE_TAIL_S = 2;

  const alignWindow = useMemo(() => {
    const infos = Object.values(raceTimings).filter((v): v is RaceTimingInfo => v !== null);
    if (infos.length === 0) return undefined;
    const maxRun = Math.max(...infos.map(i => i.raceEnd - i.raceStart));
    return { preRace: PRE_RACE_S, postRace: maxRun + POST_RACE_TAIL_S };
  }, [raceTimings]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => goToEvents(vehicleId)}
          className="mb-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeftIcon className="size-4" />
          {vehicle?.name ?? "..."}
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{event?.name ?? "..."}</h2>
          {event?.date && (
            <span className="text-sm text-muted-foreground">
              — {event.date}{event.endDate && event.endDate !== event.date && ` → ${event.endDate}`}
            </span>
          )}
        </div>
        {event?.notes && (
          <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p>
        )}
      </div>

      <FileUpload vehicleId={vehicleId} eventId={eventId} />

      {files === undefined ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading...
        </p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No files yet. Upload datalogs above.
        </p>
      ) : (
        <div
          className="mt-4"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropIdx(getDropIdx(e));
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDropIdx(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const target = getDropIdx(e);
            const from = dragIdxRef.current;
            if (from !== null && target !== from && target !== from + 1) {
              const reordered = [...files];
              const [moved] = reordered.splice(from, 1);
              const insertAt = target > from ? target - 1 : target;
              reordered.splice(insertAt, 0, moved);
              void reorderFiles({ ids: reordered.map((f) => f._id) });
            }
            setDragIdx(null);
            setDropIdx(null);
          }}
        >
          {files.map((file, i) => (
            <div key={file._id}>
              {/* Drop indicator line above this row */}
              <div
                className={`h-0.5 rounded-full mx-2 transition-colors ${
                  dropIdx === i && dragIdx !== null && dragIdx !== i && dragIdx !== i - 1
                    ? "bg-primary"
                    : "bg-transparent"
                }`}
              />
              <div
                data-file-idx={i}
                draggable
                onDragStart={(e) => {
                  const tag = (e.target as HTMLElement).tagName;
                  if (tag === "INPUT" || tag === "TEXTAREA") {
                    e.preventDefault();
                    return;
                  }
                  setDragIdx(i);
                  dragIdxRef.current = i;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  setDropIdx(null);
                  dragIdxRef.current = null;
                }}
                className={`mb-2 transition-opacity ${dragIdx === i ? "opacity-30" : ""}`}
              >
                <FileRow
                  file={file}
                  onDelete={() => {
                    if (window.confirm(`Delete "${file.fileName}"?`)) {
                      void removeFile({ id: file._id });
                    }
                  }}
                  onRaceTiming={(info) => handleRaceTiming(file._id, info)}
                  alignWindow={alignWindow}
                  onOpenViewer={() => handleOpenViewer(file._id)}
                />
              </div>
            </div>
          ))}
          {/* Drop indicator line below the last row */}
          <div
            className={`h-0.5 rounded-full mx-2 transition-colors ${
              dropIdx === files.length && dragIdx !== null && dragIdx !== files.length - 1
                ? "bg-primary"
                : "bg-transparent"
            }`}
          />
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  onDelete,
  onRaceTiming,
  alignWindow,
  onOpenViewer,
}: {
  file: Doc<"files">;
  onDelete: () => void;
  onRaceTiming?: (info: RaceTimingInfo | null) => void;
  alignWindow?: { preRace: number; postRace: number };
  onOpenViewer: () => void;
}) {
  const url = useQuery(api.files.getUrl, { storageId: file.storageId });
  const timeslips = useQuery(api.timeslips.listByFile, { fileId: file._id });
  const updateNotes = useMutation(api.files.updateNotes);
  const renameFile = useMutation(api.files.rename);
  const removeTimeslip = useMutation(api.timeslips.remove);
  const [editingName, setEditingName] = useState(false);
  const [fileName, setFileName] = useState(file.fileName);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(file.notes ?? "");
  const [showTimeslipForm, setShowTimeslipForm] = useState(false);
  const [editingTimeslip, setEditingTimeslip] = useState<Doc<"timeslips"> | null>(null);

  const handleSaveNotes = async () => {
    await updateNotes({ id: file._id, notes: notes.trim() || undefined });
    setEditingNotes(false);
  };

  return (
    <div className="rounded-lg border min-h-[200px] group/row">
      {/* Header — full width */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <div className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-colors">
          <GripVerticalIcon className="size-5" />
        </div>
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              className="font-medium text-sm w-full bg-transparent border-b border-primary outline-none"
              value={fileName}
              autoFocus
              onChange={(e) => setFileName(e.target.value)}
              onBlur={() => {
                let trimmed = fileName.trim();
                if (trimmed) {
                  const origExt = file.fileName.match(/\.[^.]+$/)?.[0];
                  if (origExt && !trimmed.endsWith(origExt)) {
                    trimmed += origExt;
                  }
                }
                if (trimmed && trimmed !== file.fileName) {
                  setFileName(trimmed);
                  void renameFile({ id: file._id, fileName: trimmed });
                } else {
                  setFileName(file.fileName);
                }
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setFileName(file.fileName);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <div
              className="font-medium text-sm truncate cursor-text hover:underline decoration-muted-foreground/50"
              onClick={() => {
                setFileName(file.fileName.replace(/\.[^.]+$/, ""));
                setEditingName(true);
              }}
              title="Click to rename"
            >
              {file.fileName.replace(/\.[^.]+$/, "")}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {formatFileSize(file.fileSize)} &middot;{" "}
            {new Date(file.uploadedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-1">
          {url && (
            <Tip content="Download">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => window.open(url, "_blank")}
              >
                <DownloadIcon />
              </Button>
            </Tip>
          )}
          <Tip content="Delete file">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
            >
              <TrashIcon className="text-destructive" />
            </Button>
          </Tip>
        </div>
      </div>

      {/* Body columns */}
      <div className="flex">
        {/* Notes */}
        <div className="w-[280px] shrink-0 min-w-0 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Notes
            </span>
            {!editingNotes && (
              <Tip content="Edit notes">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    setNotes(file.notes ?? "");
                    setEditingNotes(true);
                  }}
                >
                  <PencilIcon />
                </Button>
              </Tip>
            )}
          </div>
          {editingNotes ? (
            <div className="space-y-2">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Run notes, observations..."
                rows={2}
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleSaveNotes()}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingNotes(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {file.notes || "No notes yet."}
            </p>
          )}
        </div>

        {/* Timeslips */}
        <div className="border-l px-4 py-3 shrink-0 flex flex-col font-mono w-[240px]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">
            Timeslips
          </span>
          <Tip content="Add timeslip">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setEditingTimeslip(null);
                setShowTimeslipForm(true);
              }}
            >
              <PlusIcon />
            </Button>
          </Tip>
        </div>
        {timeslips && timeslips.length > 0 ? (
          <div className="flex gap-3 flex-1">
            {timeslips.map((ts) => (
              <TimeslipRow
                key={ts._id}
                timeslip={ts}
                onEdit={() => {
                  setEditingTimeslip(ts);
                  setShowTimeslipForm(true);
                }}
                onDelete={() => {
                  if (window.confirm("Delete this timeslip?")) {
                    void removeTimeslip({ id: ts._id });
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </div>

      {/* Right: RPM preview — click to open viewer */}
      <div
        className="border-l px-4 py-3 flex-1 flex flex-col min-w-0 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={onOpenViewer}
        title="Click to open in viewer"
      >
        <div className="flex-1 flex items-center">
          <RpmPreview
            file={file}
            onRaceTiming={onRaceTiming}
            alignWindow={alignWindow}
          />
        </div>
      </div>
      </div>

      <TimeslipForm
        open={showTimeslipForm}
        onOpenChange={setShowTimeslipForm}
        fileId={file._id}
        timeslip={editingTimeslip ?? undefined}
        onDone={() => {
          setShowTimeslipForm(false);
          setEditingTimeslip(null);
        }}
      />
    </div>
  );
}

function TimeslipRow({
  timeslip,
  onEdit,
  onDelete,
}: {
  timeslip: Doc<"timeslips">;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group rounded-md border bg-muted/30 px-4 py-3 font-mono text-sm w-[200px] flex flex-col">
      <div className="space-y-0.5 flex-1">
        {timeslip.dialIn !== undefined && (
          <TimeslipLine label="DIAL" value={timeslip.dialIn} />
        )}

        <TimeslipLine label="R.T." value={timeslip.rt} />

        <Separator className="my-1.5" />

        <TimeslipLine label="60'" value={timeslip.sixtyFt} />
        <TimeslipLine label="330'" value={timeslip.threeThirty} />

        <Separator className="my-1.5" />

        <TimeslipLine label="1/8" value={timeslip.eighthEt} />
        <TimeslipLine label="MPH" value={timeslip.eighthMph} />

        {(timeslip.thousandFt !== undefined || timeslip.et !== undefined || timeslip.mph !== undefined) && (
          <>
            <Separator className="my-1.5" />
            {timeslip.thousandFt !== undefined && (
              <TimeslipLine label="1000'" value={timeslip.thousandFt} />
            )}

            {(timeslip.et !== undefined || timeslip.mph !== undefined) && (
              <>
                {timeslip.thousandFt !== undefined && <Separator className="my-1.5" />}
                <TimeslipLine label="E.T." value={timeslip.et} bold />
                <TimeslipLine label="MPH" value={timeslip.mph} bold />
              </>
            )}
          </>
        )}
      </div>
      <div className="flex gap-1 justify-end mt-2 opacity-0 group-hover:opacity-100">
        <Tip content="Edit timeslip">
          <Button variant="ghost" size="icon-xs" onClick={onEdit}>
            <PencilIcon />
          </Button>
        </Tip>
        <Tip content="Delete timeslip">
          <Button variant="ghost" size="icon-xs" onClick={onDelete}>
            <TrashIcon className="text-destructive" />
          </Button>
        </Tip>
      </div>
    </div>
  );
}

function TimeslipLine({
  label,
  value,
  bold,
}: {
  label: string;
  value: number | undefined;
  bold?: boolean;
}) {
  const display = value !== undefined ? String(value) : "—";
  return (
    <div className="flex items-baseline gap-0">
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      <span className="flex-1 overflow-hidden text-muted-foreground/40 mx-1 select-none" aria-hidden>
        {"...................................................................................."}
      </span>
      <span className={`shrink-0 ${bold ? "font-bold" : ""}`}>{display}</span>
    </div>
  );
}

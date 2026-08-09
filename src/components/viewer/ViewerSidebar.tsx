import { useCallback, useRef, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { PassList } from "./PassList";

/**
 * The passes for this car, and somewhere to drop a channel you want off a
 * trace.
 *
 * This used to carry a channel tree as well, but a trace now owns its own
 * channels: the panel beside it lists them and its picker adds them. Browsing
 * every channel in the log from a place with no idea which trace it would land
 * on was the weaker half of that job.
 */
export function ViewerSidebar({
  vehicleId,
  eventId,
  loadedFileIds,
  pendingFileIds,
  hiddenLogIds,
  onToggleLogVisibility,
  onAddFile,
  onRemoveFile,
  onRemoveChannel,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
  loadedFileIds: Id<"files">[];
  pendingFileIds?: Id<"files">[];
  hiddenLogIds: string[];
  onToggleLogVisibility: (fileId: Id<"files">) => void;
  onAddFile: (fileId: Id<"files">) => void;
  onRemoveFile: (fileId: Id<"files">) => void;
  onRemoveChannel: (traceId: string, logFileId: Id<"files">, channelName: string) => void;
}) {
  const [isDragTarget, setIsDragTarget] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragTarget(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragTarget(false);
    }
  }, []);

  // Dragging a channel off a trace and dropping it anywhere off-chart is the
  // quickest way to be rid of one, so the sidebar stays a target for it.
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragTarget(false);
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          logFileId?: Id<"files">;
          channelName?: string;
          sourceTraceId?: string;
        };
        if (parsed.sourceTraceId && parsed.logFileId && parsed.channelName) {
          onRemoveChannel(parsed.sourceTraceId, parsed.logFileId, parsed.channelName);
        }
      } catch {
        // Not one of ours — ignore.
      }
    },
    [onRemoveChannel],
  );

  return (
    <div
      className={`flex h-full flex-col border-r bg-muted/20 transition-colors ${
        isDragTarget ? "bg-destructive/5 ring-2 ring-inset ring-destructive/30" : ""
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="shrink-0 border-b px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Passes
      </div>
      <PassList
        vehicleId={vehicleId}
        eventId={eventId}
        loadedFileIds={loadedFileIds}
        pendingFileIds={pendingFileIds}
        hiddenLogIds={hiddenLogIds}
        onToggleLogVisibility={onToggleLogVisibility}
        onAddFile={onAddFile}
        onRemoveFile={onRemoveFile}
      />
    </div>
  );
}

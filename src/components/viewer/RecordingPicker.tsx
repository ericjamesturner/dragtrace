import type { Id } from "../../../convex/_generated/dataModel";
import { getLogRecordings } from "@/lib/load-haltech-log";
import type { LoadedLog } from "@/lib/viewer-types";

export function RecordingPicker({
  logs,
  onSelect,
  firstRecordingTimeslipIds,
}: {
  logs: LoadedLog[];
  onSelect: (fileId: Id<"files">, sessionIndex: number) => void;
  firstRecordingTimeslipIds?: ReadonlySet<string>;
}) {
  const multipleRecordings = logs.filter((log) => log.parsed.sessions.length > 1);
  if (multipleRecordings.length === 0) return null;

  return (
    <div className="max-h-40 shrink-0 overflow-y-auto border-b bg-muted/20 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        {multipleRecordings.map((log) => (
          <label
            key={log.fileId}
            className="grid min-w-0 flex-1 grid-cols-1 gap-1 sm:min-w-60 sm:max-w-sm"
          >
            <span className="flex min-w-0 items-center gap-2 text-xs">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: log.logColor }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate" title={log.fileName}>
                {log.fileName}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {log.activeSessionIndex + 1} of {log.parsed.sessions.length}
              </span>
            </span>
            <select
              aria-label={`Recording for ${log.fileName}`}
              value={log.activeSessionIndex}
              onChange={(event) => onSelect(log.fileId, Number(event.target.value))}
              className="h-8 w-full min-w-0 max-w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {getLogRecordings(log).map((recording) => (
                <option key={recording.sessionIndex} value={recording.sessionIndex}>
                  {recording.sessionIndex + 1}. {recording.label} · {recording.sourceDuration.toFixed(2)}s
                  {recording.startTime.getTime() > 0
                    ? ` · ${recording.startTime.toLocaleString()}`
                    : ""}
                </option>
              ))}
            </select>
            {log.activeSessionIndex !== (log.passSessionIndex ?? 0) && firstRecordingTimeslipIds?.has(log.fileId) && (
              <span className="text-xs text-muted-foreground">
                The attached timeslip belongs to recording {(log.passSessionIndex ?? 0) + 1}.
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

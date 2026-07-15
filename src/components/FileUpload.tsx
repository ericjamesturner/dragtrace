import { useState, useRef, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { UploadIcon } from "lucide-react";

type UploadProgress = {
  fileName: string;
  fileIndex: number;
  fileCount: number;
  loaded: number; // bytes sent across the whole batch
  total: number; // total bytes in the batch
  saving: boolean; // current file fully sent, waiting on the save mutation
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// fetch() has no upload progress events, so use XHR for the storage POST
function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (loaded: number) => void
): Promise<{ storageId: Id<"_storage"> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.storageId) {
        resolve(xhr.response);
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed (network error)"));
    xhr.send(file);
  });
}

export function FileUpload({
  vehicleId,
  eventId,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
}) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveFile = useMutation(api.files.saveFile);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      if (progress) return;
      // Haltech datalogs only — also guards drag-and-drop, which ignores `accept`
      const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".csv"));
      if (files.length === 0) return;
      setError(null);
      const total = files.reduce((sum, f) => sum + f.size, 0);
      let doneBytes = 0;
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setProgress({
            fileName: file.name,
            fileIndex: i,
            fileCount: files.length,
            loaded: doneBytes,
            total,
            saving: false,
          });
          // Step 1: Get upload URL
          const uploadUrl = await generateUploadUrl();
          // Step 2: Upload the file, streaming real byte progress
          const { storageId } = await uploadWithProgress(uploadUrl, file, (loaded) => {
            setProgress((p) =>
              p ? { ...p, loaded: doneBytes + Math.min(loaded, file.size) } : p
            );
          });
          setProgress((p) => (p ? { ...p, loaded: doneBytes + file.size, saving: true } : p));
          // Step 3: Save file record
          await saveFile({
            storageId,
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type || "application/octet-stream",
            eventId,
            vehicleId,
          });
          doneBytes += file.size;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setProgress(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [progress, generateUploadUrl, saveFile, eventId, vehicleId]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      void uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

  const pct = progress
    ? Math.min(100, progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0)
    : 0;

  return (
    <div
      className={`relative rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
        dragOver
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => {
        if (!progress) inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
        }}
      />
      {progress ? (
        <div className="flex flex-col items-center gap-2">
          <p className="max-w-full truncate text-sm text-muted-foreground">
            {progress.fileCount > 1
              ? `Uploading ${progress.fileIndex + 1} of ${progress.fileCount}: ${progress.fileName}`
              : `Uploading ${progress.fileName}`}
          </p>
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            {progress.saving
              ? "Saving…"
              : `${pct}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`}
          </p>
        </div>
      ) : (
        <div className="flex cursor-pointer flex-col items-center gap-2">
          <UploadIcon className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop files here or click to browse
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

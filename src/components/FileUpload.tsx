import { useState, useRef, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { UploadIcon, Loader2Icon } from "lucide-react";

export function FileUpload({
  vehicleId,
  eventId,
}: {
  vehicleId: Id<"vehicles">;
  eventId: Id<"events">;
}) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveFile = useMutation(api.files.saveFile);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      if (fileList.length === 0) return;
      setUploading(true);
      try {
        for (const file of Array.from(fileList)) {
          // Step 1: Get upload URL
          const uploadUrl = await generateUploadUrl();
          // Step 2: Upload the file
          const result = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          const { storageId } = await result.json();
          // Step 3: Save file record
          await saveFile({
            storageId,
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type || "application/octet-stream",
            eventId,
            vehicleId,
          });
        }
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [generateUploadUrl, saveFile, eventId, vehicleId]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      void uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

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
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
        }}
      />
      {uploading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Uploading...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 cursor-pointer">
          <UploadIcon className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop files here or click to browse
          </p>
        </div>
      )}
    </div>
  );
}

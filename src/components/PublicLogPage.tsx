import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { loadDatalog } from "@/lib/load-haltech-log";
import {
  isSupportedLogFile,
  SUPPORTED_LOG_ACCEPT,
} from "@/lib/datalog-parser";
import type { LoadedLog, ViewerConfig } from "@/lib/viewer-types";
import { captureSharedViewerWorkspace } from "@/lib/shared-viewer-layout";
import { getBrowserVisitorId } from "@/lib/visitor-id";
import { Button } from "@/components/ui/button";
import { FileUpIcon, Loader2Icon, LockKeyholeIcon } from "lucide-react";
import { LogViewerReady } from "./LogViewer";
import { FeedbackDialog } from "./viewer/FeedbackDialog";
import { ShareLogDialog } from "./viewer/ShareLogDialog";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function PublicLogPage({
  directShare = false,
  onHome,
  onSignIn,
}: {
  directShare?: boolean;
  onHome: () => void;
  onSignIn: () => void;
}) {
  const [logs, setLogs] = useState<LoadedLog[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceFilesRef = useRef(new Map<string, File>());
  const viewerConfigRef = useRef<ViewerConfig | null>(null);
  const logsRef = useRef(logs);
  const activeShareRef = useRef<{ shareId: string; logFileIds: string[] } | null>(null);
  const shareUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateViewerWorkspace = useMutation(api.sharedLogs.updateViewerWorkspace);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const getViewerConfig = useCallback(() => viewerConfigRef.current, []);
  const handleViewerConfigChange = useCallback((config: ViewerConfig) => {
    viewerConfigRef.current = config;
    const activeShare = activeShareRef.current;
    if (!activeShare) return;
    const sharedLogs = logsRef.current.filter((log) =>
      activeShare.logFileIds.includes(log.fileId),
    );
    const viewerWorkspace = captureSharedViewerWorkspace(config, sharedLogs);
    if (!viewerWorkspace) return;
    if (shareUpdateTimerRef.current) clearTimeout(shareUpdateTimerRef.current);
    shareUpdateTimerRef.current = setTimeout(() => {
      void updateViewerWorkspace({
        shareId: activeShare.shareId,
        browserVisitorId: getBrowserVisitorId(),
        viewerWorkspace,
      }).catch(() => {
        // The original share is still usable if a background update fails.
      });
    }, 750);
  }, [updateViewerWorkspace]);
  const handleShareCreated = useCallback(
    (shareId: string, logFileIds: string[]) => {
      activeShareRef.current = { shareId, logFileIds };
    },
    [],
  );

  useEffect(
    () => () => {
      if (shareUpdateTimerRef.current) clearTimeout(shareUpdateTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const previousTitle = document.title;
    document.title = directShare
      ? "Share a Datalog — DragTrace"
      : "Open a Datalog — DragTrace";
    return () => {
      document.title = previousTitle;
    };
  }, [directShare]);

  const openFiles = useCallback(async (selectedFiles: File[]) => {
    const logFiles = selectedFiles.filter((file) => isSupportedLogFile(file.name));
    const nextErrors = selectedFiles
      .filter((file) => !isSupportedLogFile(file.name))
      .map((file) => `${file.name}: That log-file extension is not supported.`);
    setErrors(nextErrors);
    if (logFiles.length === 0) return;

    setLoadingFiles(logFiles);
    try {
      const startIndex = logs.length;
      const results = await Promise.all(
        logFiles.map(
          async (
            file,
            index,
          ): Promise<{ log: LoadedLog; file: File } | { error: string }> => {
            try {
              const bytes = await file.arrayBuffer();
              const fileId = `local-${crypto.randomUUID()}` as Id<"files">;
              return {
                log: await loadDatalog({
                  bytes,
                  fileId,
                  fileName: file.name,
                  index: startIndex + index,
                }),
                file,
              };
            } catch (err) {
              const message =
                err instanceof Error ? err.message : "Could not open this datalog";
              return { error: `${file.name}: ${message}` };
            }
          },
        ),
      );
      const loaded = results.flatMap((result) =>
        "log" in result ? [result.log] : [],
      );
      for (const result of results) {
        if ("log" in result) {
          sourceFilesRef.current.set(result.log.fileId, result.file);
        }
      }
      const parseErrors = results.flatMap((result) =>
        "error" in result ? [result.error] : [],
      );
      if (loaded.length > 0) {
        setLogs((current) => [...current, ...loaded]);
        if (directShare) setShareOpen(true);
      }
      setErrors([...nextErrors, ...parseErrors]);
    } finally {
      setLoadingFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [directShare, logs.length]);

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={SUPPORTED_LOG_ACCEPT}
      multiple
      className="hidden"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length > 0) void openFiles(files);
      }}
    />
  );

  if (logs.length > 0) {
    return (
      <>
        {fileInput}
        <ShareLogDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          logs={logs}
          getSourceFile={(fileId) => sourceFilesRef.current.get(fileId)}
          getViewerConfig={getViewerConfig}
          onShareCreated={handleShareCreated}
          copyAndOpen={directShare}
        />
        <LogViewerReady
          key={logs[0].fileId}
          publicMode
          fileIds={logs.map((log) => log.fileId)}
          logs={logs}
          errors={errors}
          workspace={null}
          publicLoading={loadingFiles.length > 0}
          onPublicConfigChange={handleViewerConfigChange}
          onAddPublicFiles={() => inputRef.current?.click()}
          onSharePublicLog={() => setShareOpen(true)}
          onBack={() => {
            setLogs([]);
            setErrors([]);
            sourceFilesRef.current.clear();
            viewerConfigRef.current = null;
            activeShareRef.current = null;
            if (shareUpdateTimerRef.current) {
              clearTimeout(shareUpdateTimerRef.current);
              shareUpdateTimerRef.current = null;
            }
          }}
        />
      </>
    );
  }

  return (
    <div className="min-h-dvh bg-[#08090a] text-white antialiased">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center px-6 py-4">
          <button
            onClick={onHome}
            className="text-base font-semibold tracking-tight transition-opacity hover:opacity-70"
          >
            DragTrace
          </button>
          <FeedbackDialog
            source="guest"
            buttonClassName="ml-auto text-white/70 hover:bg-white/10 hover:text-white"
          />
          <button
            onClick={onSignIn}
            className="rounded-md px-3 py-2 text-base text-white/70 transition-colors hover:text-white"
          >
            Sign in
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col px-6 py-14 sm:py-20">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/50">
          {directShare ? "Public log sharing" : "Guest viewer"}
        </p>
        <h1 className="mt-4 text-balance text-[clamp(2.2rem,6vw,3.6rem)] font-semibold leading-none tracking-[-0.03em]">
          {directShare
            ? "Upload a datalog. Send one link."
            : "Open a datalog. No account needed."}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          {directShare
            ? "Choose one or more supported ECU logs, preview them, and create a public comparison link anyone can open without an account. DragTrace will copy the link before opening the shared viewer."
            : "Pick one or more supported ECU logs and DragTrace will open them with a useful starter layout. Opening stays in this browser; a file is uploaded only if you explicitly create a public share link."}
        </p>

        {fileInput}

        <button
          type="button"
          disabled={loadingFiles.length > 0}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setDragOver(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0) void openFiles(files);
          }}
          className={`mt-10 flex min-h-72 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-colors disabled:cursor-wait ${
            dragOver
              ? "border-white/70 bg-white/10"
              : "border-white/20 bg-white/[0.035] hover:border-white/40 hover:bg-white/[0.06]"
          }`}
        >
          {loadingFiles.length > 0 ? (
            <>
              <Loader2Icon className="size-9 animate-spin text-white/70" />
              <span className="mt-5 text-lg font-medium">
                {loadingFiles.length === 1
                  ? `Opening ${loadingFiles[0].name}`
                  : `Opening ${loadingFiles.length} datalogs`}
              </span>
              <span className="mt-1 text-sm text-white/45">
                Reading{" "}
                {formatBytes(
                  loadingFiles.reduce((sum, file) => sum + file.size, 0),
                )}{" "}
                in your browser…
              </span>
            </>
          ) : (
            <>
              <FileUpIcon className="size-10 text-white/65" />
              <span className="mt-5 text-xl font-medium">
                {directShare
                  ? "Drop an ECU log here to share"
                  : "Drop ECU log files here"}
              </span>
              <span className="mt-2 text-base text-white/50">
                {directShare
                  ? "or click to choose a file"
                  : "or click to choose one or more files"}
              </span>
            </>
          )}
        </button>

        {errors.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {errors.join(" ")}
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 p-5">
            <LockKeyholeIcon className="size-5 text-white/60" />
            <h2 className="mt-3 font-medium">Private by default</h2>
            <p className="mt-1 text-sm leading-relaxed text-white/50">
              Logs are parsed locally. Only “Create public link” or a feedback
              attachment sends a file to DragTrace storage.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 p-5">
            <h2 className="font-medium">Your layout stays ready</h2>
            <p className="mt-1 text-sm leading-relaxed text-white/50">
              Reloading clears the log files, but this browser remembers your
              channels, pages, units, and chart settings for next time.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-white/10 pt-8">
          <p className="text-sm text-white/50">
            Want saved cars, events, and workspaces?
          </p>
          <Button
            onClick={onSignIn}
            className="bg-white text-black hover:bg-white/85"
          >
            Sign in to DragTrace
          </Button>
        </div>
      </main>
    </div>
  );
}

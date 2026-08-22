import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { loadHaltechLog } from "@/lib/load-haltech-log";
import type { LoadedLog } from "@/lib/viewer-types";
import { Button } from "@/components/ui/button";
import { FileUpIcon, Loader2Icon, LockKeyholeIcon } from "lucide-react";
import { LogViewerReady } from "./LogViewer";
import { FeedbackDialog } from "./viewer/FeedbackDialog";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function PublicLogPage({
  onHome,
  onSignIn,
}: {
  onHome: () => void;
  onSignIn: () => void;
}) {
  const [logs, setLogs] = useState<LoadedLog[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Open a Datalog — DragTrace";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const openFiles = useCallback(async (selectedFiles: File[]) => {
    const csvFiles = selectedFiles.filter((file) =>
      file.name.toLowerCase().endsWith(".csv"),
    );
    const nextErrors = selectedFiles
      .filter((file) => !file.name.toLowerCase().endsWith(".csv"))
      .map((file) => `${file.name}: Choose a Haltech CSV datalog.`);
    setErrors(nextErrors);
    if (csvFiles.length === 0) return;

    setLoadingFiles(csvFiles);
    try {
      const startIndex = logs.length;
      const results = await Promise.all(
        csvFiles.map(
          async (
            file,
            index,
          ): Promise<{ log: LoadedLog } | { error: string }> => {
            try {
              const text = await file.text();
              const fileId = `local-${crypto.randomUUID()}` as Id<"files">;
              return {
                log: await loadHaltechLog({
                  text,
                  fileId,
                  fileName: file.name,
                  index: startIndex + index,
                }),
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
      const parseErrors = results.flatMap((result) =>
        "error" in result ? [result.error] : [],
      );
      if (loaded.length > 0) setLogs((current) => [...current, ...loaded]);
      setErrors([...nextErrors, ...parseErrors]);
    } finally {
      setLoadingFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [logs.length]);

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
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
        <LogViewerReady
          key={logs[0].fileId}
          publicMode
          fileIds={logs.map((log) => log.fileId)}
          logs={logs}
          errors={errors}
          workspace={null}
          publicLoading={loadingFiles.length > 0}
          onAddPublicFiles={() => inputRef.current?.click()}
          onBack={() => {
            setLogs([]);
            setErrors([]);
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
          Guest viewer
        </p>
        <h1 className="mt-4 text-balance text-[clamp(2.2rem,6vw,3.6rem)] font-semibold leading-none tracking-[-0.03em]">
          Open a datalog. No account needed.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Pick one or more Haltech CSVs and DragTrace will open them with a
          useful starter layout. Your files stay in this browser and are not
          uploaded.
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
                Drop Haltech CSVs here
              </span>
              <span className="mt-2 text-base text-white/50">
                or click to choose one or more files
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
              The CSVs are parsed locally. They are never added to DragTrace
              storage.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 p-5">
            <h2 className="font-medium">A fresh start every time</h2>
            <p className="mt-1 text-sm leading-relaxed text-white/50">
              Changes work for this visit only. Reloading clears the files and
              restores the default layout.
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

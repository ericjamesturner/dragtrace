import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FileWarningIcon, Loader2Icon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { loadDatalog } from "@/lib/load-haltech-log";
import { isSharedLogOwner } from "@/lib/shared-log-owner";
import {
  captureSharedViewerWorkspace,
  configFromSharedViewerWorkspace,
  sharedViewerWorkspaceKey,
} from "@/lib/shared-viewer-layout";
import { getBrowserVisitorId } from "@/lib/visitor-id";
import type { LoadedLog, ViewerConfig } from "@/lib/viewer-types";
import { LogViewerReady } from "./LogViewer";

export default function SharedLogPage({
  shareId,
  onHome,
}: {
  shareId: string;
  onHome: () => void;
}) {
  const shared = useQuery(api.sharedLogs.get, { shareId });
  const recordVisit = useMutation(api.sharedLogs.recordVisit);
  const updateViewerWorkspace = useMutation(api.sharedLogs.updateViewerWorkspace);
  const recordedVisit = useRef(false);
  const [logs, setLogs] = useState<LoadedLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logsRef = useRef(logs);
  const sharedFilesRef = useRef(shared?.files);
  const sharedFilesKey =
    shared?.files.map((file) => `${file.fileName}:${file.url}`).join("|") ?? "";
  const ownerRef = useRef(isSharedLogOwner(shareId));
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    sharedFilesRef.current = shared?.files;
  }, [shared?.files]);

  const handleViewerConfigChange = useCallback(
    (config: ViewerConfig) => {
      if (!ownerRef.current) return;
      const viewerWorkspace = captureSharedViewerWorkspace(config, logsRef.current);
      if (!viewerWorkspace) return;
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(() => {
        void updateViewerWorkspace({
          shareId,
          browserVisitorId: getBrowserVisitorId(),
          viewerWorkspace,
        }).catch(() => {
          // Local edits still persist even if the public snapshot cannot update.
        });
      }, 750);
    },
    [shareId, updateViewerWorkspace],
  );

  useEffect(
    () => () => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!shared || recordedVisit.current) return;
    recordedVisit.current = true;
    void recordVisit({ shareId }).catch(() => {
      // A counter failure must never stop someone from opening the log.
    });
  }, [recordVisit, shareId, shared]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = shared?.fileName
      ? `${shared.fileName}${(shared.fileCount ?? 1) > 1 ? ` + ${(shared.fileCount ?? 1) - 1} more` : ""} — DragTrace`
      : "Shared datalog — DragTrace";
    return () => {
      document.title = previousTitle;
    };
  }, [shared?.fileName, shared?.fileCount]);

  useEffect(() => {
    const files = sharedFilesRef.current;
    if (!files?.length) return;
    let cancelled = false;
    void Promise.all(
      files.map(async (file, index) => {
        const response = await fetch(file.url);
        if (!response.ok) {
          throw new Error("A shared log could not be downloaded.");
        }
        return await loadDatalog({
          bytes: await response.arrayBuffer(),
          fileId: `shared-${shareId}-${index}` as Id<"files">,
          fileName: file.fileName,
          index,
        });
      }),
    )
      .then((loaded) => {
        if (!cancelled) setLogs(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The shared log could not be opened.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shareId, sharedFilesKey]);

  if (logs.length > 0) {
    const visitCount = shared?.visitCount ?? 0;
    const initialPublicConfig = configFromSharedViewerWorkspace(
      shared?.viewerWorkspace,
      logs,
    );
    const comparison = logs.length > 1;
    return (
      <LogViewerReady
        key={shareId}
        publicMode
        autoFitPass
        initialPublicConfig={initialPublicConfig}
        publicWorkspaceStorageKey={sharedViewerWorkspaceKey(shareId)}
        onPublicConfigChange={handleViewerConfigChange}
        publicLabel={`Shared ${comparison ? `${logs.length}-log comparison` : "log"} · ${visitCount.toLocaleString()} ${visitCount === 1 ? "visit" : "visits"} · layout saved locally`}
        publicDetails={{
          vehicleDetails: shared?.vehicleDetails,
          description: shared?.description,
        }}
        fileIds={logs.map((log) => log.fileId)}
        logs={logs}
        errors={[]}
        workspace={null}
        onBack={onHome}
      />
    );
  }

  const missing = shared === null;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#08090a] px-6 text-white">
      <div className="w-full max-w-md text-center">
        {missing || error ? (
          <>
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-red-500/12 text-red-400 ring-1 ring-red-500/20">
              <FileWarningIcon className="size-6" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold">This log is not available</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/55">
              {error ?? "The link may be incomplete or the shared log may have been removed."}
            </p>
          </>
        ) : (
          <>
            <Loader2Icon className="mx-auto size-7 animate-spin text-white/55" />
            <h1 className="mt-5 text-xl font-semibold">Opening shared datalog…</h1>
            <p className="mt-2 text-sm text-white/50">
              {shared?.fileName ?? "Loading the public link"}
            </p>
          </>
        )}
        {(missing || error) && (
          <Button className="mt-6" onClick={onHome}>
            Go to DragTrace
          </Button>
        )}
      </div>
    </div>
  );
}

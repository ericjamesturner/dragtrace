import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FileWarningIcon, Loader2Icon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { loadDatalog } from "@/lib/load-haltech-log";
import type { LoadedLog } from "@/lib/viewer-types";
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
  const recordedVisit = useRef(false);
  const [log, setLog] = useState<LoadedLog | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      ? `${shared.fileName} — DragTrace`
      : "Shared datalog — DragTrace";
    return () => {
      document.title = previousTitle;
    };
  }, [shared?.fileName]);

  useEffect(() => {
    if (!shared?.url) return;
    let cancelled = false;
    void fetch(shared.url)
      .then((response) => {
        if (!response.ok) throw new Error("The shared log could not be downloaded.");
        return response.arrayBuffer();
      })
      .then((bytes) =>
        loadDatalog({
          bytes,
          fileId: `shared-${shareId}` as Id<"files">,
          fileName: shared.fileName,
        }),
      )
      .then((loaded) => {
        if (!cancelled) setLog(loaded);
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
  }, [shareId, shared?.fileName, shared?.url]);

  if (log) {
    const visitCount = shared?.visitCount ?? 0;
    return (
      <LogViewerReady
        key={shareId}
        publicMode
        autoFitPass
        publicLabel={`Shared log · ${visitCount.toLocaleString()} ${visitCount === 1 ? "visit" : "visits"} · layout saved locally`}
        publicDetails={{
          vehicleDetails: shared?.vehicleDetails,
          description: shared?.description,
        }}
        fileIds={[log.fileId]}
        logs={[log]}
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

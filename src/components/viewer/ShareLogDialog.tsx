import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  Share2Icon,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { errText } from "@/lib/error-text";
import { createSharedLogImage } from "@/lib/share-image";
import { getBrowserVisitorId } from "@/lib/visitor-id";
import type { LoadedLog } from "@/lib/viewer-types";

const MAX_FILE_BYTES = 125 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function ShareLogDialog({
  open,
  onOpenChange,
  logs,
  getSourceFile,
  copyAndOpen = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: LoadedLog[];
  getSourceFile: (fileId: Id<"files">) => File | undefined;
  copyAndOpen?: boolean;
}) {
  const generateUploadUrl = useMutation(api.sharedLogs.generateUploadUrl);
  const createShare = useMutation(api.sharedLogs.create);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharerName, setSharerName] = useState("");
  const [sharerEmail, setSharerEmail] = useState("");

  const selectedLog = useMemo(
    () => logs.find((log) => log.fileId === selectedId) ?? logs[0],
    [logs, selectedId],
  );
  const sourceFile = selectedLog
    ? getSourceFile(selectedLog.fileId)
    : undefined;

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next) {
      setSelectedId(logs[0]?.fileId ?? "");
      setBusy(false);
      setStage("");
      setShareUrl("");
      setCopied(false);
      setError(null);
      setSharerName("");
      setSharerEmail("");
    }
  };

  const upload = async (body: Blob, contentType: string) => {
    const uploadUrl = await generateUploadUrl({
      browserVisitorId: getBrowserVisitorId(),
    });
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    if (!response.ok) throw new Error("The upload did not finish. Try again.");
    return (await response.json()) as { storageId: Id<"_storage"> };
  };

  const publish = async () => {
    if (!selectedLog || !sourceFile) {
      setError("Choose a log from this browser session.");
      return;
    }
    if (sourceFile.size > MAX_FILE_BYTES) {
      setError("Shared logs must be 125 MB or smaller.");
      return;
    }
    const name = sharerName.trim();
    const email = sharerEmail.trim();
    if (!name) {
      setError("Enter your name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setStage("Drawing the social preview…");
      const preview = await createSharedLogImage(selectedLog);
      setStage("Uploading the log…");
      const [{ storageId }, { storageId: ogImageStorageId }] =
        await Promise.all([
          upload(sourceFile, sourceFile.type || "application/octet-stream"),
          upload(preview, "image/png"),
        ]);
      setStage("Creating the public link…");
      const shareId = await createShare({
        storageId,
        ogImageStorageId,
        fileName: sourceFile.name,
        contentType: sourceFile.type || "application/octet-stream",
        browserVisitorId: getBrowserVisitorId(),
        sharerName: name,
        sharerEmail: email,
        fingerprint: selectedLog.contentFingerprint,
      });
      const url = `${window.location.origin}/share/${shareId}`;
      const viewerUrl = `/open?share=${encodeURIComponent(shareId)}`;
      setShareUrl(url);
      setStage("");
      // Keep the already-open viewer in place, but promote the address bar to
      // the durable shared-log URL so closing this dialog leaves something the
      // visitor can copy, bookmark, or reload.
      window.history.replaceState({}, "", viewerUrl);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {
        // The link remains visible and selectable if clipboard access is off.
      }
    } catch (cause) {
      setError(errText(cause));
      setStage("");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      return true;
    } catch {
      setError("Copy was blocked. Select the link and copy it manually.");
      return false;
    }
  };

  const copyLinkAndOpen = async () => {
    if (await copyLink()) window.location.assign(shareUrl);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <div className="border-b bg-gradient-to-br from-red-500/12 via-background to-background px-6 py-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-red-500/15 text-red-500 ring-1 ring-red-500/20">
            <Share2Icon className="size-5" />
          </div>
          <DialogTitle className="mt-4 text-xl">Share a datalog</DialogTitle>
          <DialogDescription className="mt-2 leading-relaxed">
            Create a public DragTrace link that opens the interactive log. Its
            social preview plots RPM, TPS, MAP, and wideband when available.
          </DialogDescription>
        </div>

        {shareUrl ? (
          <div className="space-y-5 px-6 py-5">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4">
              <div className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
                <CheckIcon className="size-4" />
                Public link ready
              </div>
              <input
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-3 h-10 w-full rounded-lg border bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/50"
                aria-label="Public share link"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {copyAndOpen ? (
                <Button
                  className="flex-1"
                  onClick={() => void copyLinkAndOpen()}
                >
                  <ExternalLinkIcon />
                  Copy link &amp; open
                </Button>
              ) : (
                <Button className="flex-1" onClick={() => void copyLink()}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
              )}
              <Button
                variant="outline"
                className="flex-1"
                onClick={() =>
                  window.open(
                    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                <ExternalLinkIcon />
                Share on Facebook
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {copyAndOpen
                ? "The button copies this link, then opens the public log in this browser. Anyone with the link can view it without an account."
                : "Anyone with this link can open the log. The link does not expose your account or the other files in this browser."}
            </p>
          </div>
        ) : (
          <div className="space-y-5 px-6 py-5">
            {logs.length > 1 && (
              <label className="block space-y-2">
                <span className="text-sm font-medium">Log to share</span>
                <select
                  value={selectedLog?.fileId ?? ""}
                  disabled={busy}
                  onChange={(event) => setSelectedId(event.target.value)}
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                >
                  {logs.map((log) => (
                    <option key={log.fileId} value={log.fileId}>
                      {log.fileName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {selectedLog && sourceFile && (
              <div className="rounded-xl border bg-muted/35 p-4">
                <p className="truncate font-medium" title={selectedLog.fileName}>
                  {selectedLog.fileName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedLog.parsed.format} · {formatBytes(sourceFile.size)}
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium">Your name</span>
                <input
                  required
                  autoComplete="name"
                  value={sharerName}
                  disabled={busy}
                  maxLength={100}
                  onChange={(event) => setSharerName(event.target.value)}
                  placeholder="Alex Smith"
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Email</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={sharerEmail}
                  disabled={busy}
                  maxLength={254}
                  onChange={(event) => setSharerEmail(event.target.value)}
                  placeholder="alex@example.com"
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                />
              </label>
              <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
                These details are private and are not shown on the shared log.
              </p>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/7 p-4 text-xs leading-relaxed text-muted-foreground">
              Opening logs here is still private. Publishing is the step that
              uploads this selected log and its preview image so anyone with the
              link can view it.
            </div>

            {stage && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                {stage}
              </p>
            )}
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  busy ||
                  !sourceFile ||
                  !sharerName.trim() ||
                  !sharerEmail.trim()
                }
                onClick={() => void publish()}
              >
                {busy && <Loader2Icon className="animate-spin" />}
                {busy ? "Publishing…" : "Create public link"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

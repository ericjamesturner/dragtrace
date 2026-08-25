import { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { errText } from "@/lib/error-text";
import { createSharedLogImage } from "@/lib/share-image";
import { markSharedLogOwned } from "@/lib/shared-log-owner";
import { captureSharedViewerWorkspace } from "@/lib/shared-viewer-layout";
import { getBrowserVisitorId } from "@/lib/visitor-id";
import type { LoadedLog, ViewerConfig } from "@/lib/viewer-types";

const MAX_FILE_BYTES = 125 * 1024 * 1024;
const MAX_SHARED_FILES = 10;

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
  getViewerConfig,
  onShareCreated,
  copyAndOpen = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: LoadedLog[];
  getSourceFile: (fileId: Id<"files">) => File | undefined;
  getViewerConfig: () => ViewerConfig | null;
  onShareCreated?: (shareId: string, logFileIds: string[]) => void;
  copyAndOpen?: boolean;
}) {
  const generateUploadUrl = useMutation(api.sharedLogs.generateUploadUrl);
  const createShare = useMutation(api.sharedLogs.create);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    logs.slice(0, MAX_SHARED_FILES).map((log) => log.fileId),
  );
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharerName, setSharerName] = useState("");
  const [sharerEmail, setSharerEmail] = useState("");
  const [vehicleDetails, setVehicleDetails] = useState("");
  const [description, setDescription] = useState("");

  const selectedLogs = useMemo(
    () => logs.filter((log) => selectedIds.includes(log.fileId)),
    [logs, selectedIds],
  );
  const primaryLog = selectedLogs[0];
  const primaryFile = primaryLog ? getSourceFile(primaryLog.fileId) : undefined;

  useEffect(() => {
    if (open) {
      setSelectedIds(logs.slice(0, MAX_SHARED_FILES).map((log) => log.fileId));
      setBusy(false);
      setStage("");
      setShareUrl("");
      setCopied(false);
      setError(null);
      setSharerName("");
      setSharerEmail("");
      setVehicleDetails("");
      setDescription("");
    }
  }, [open, logs]);

  const handleOpenChange = (next: boolean) => onOpenChange(next);

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
    const selected = selectedLogs.flatMap((log) => {
      const file = getSourceFile(log.fileId);
      return file ? [{ log, file }] : [];
    });
    if (!primaryLog || !primaryFile || selected.length !== selectedLogs.length) {
      setError("Choose at least one available log from this browser session.");
      return;
    }
    if (selected.some(({ file }) => file.size > MAX_FILE_BYTES)) {
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
      const preview = await createSharedLogImage(primaryLog);
      setStage(
        selected.length === 1
          ? "Uploading the log…"
          : `Uploading ${selected.length} compared logs…`,
      );
      const [uploadedFiles, { storageId: ogImageStorageId }] = await Promise.all([
        Promise.all(
          selected.map(({ file }) =>
            upload(file, file.type || "application/octet-stream"),
          ),
        ),
        upload(preview, "image/png"),
      ]);
      const files = selected.map(({ log, file }, index) => ({
        storageId: uploadedFiles[index].storageId,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        fingerprint: log.contentFingerprint,
      }));
      const primary = files[0];
      if (!primary) throw new Error("Choose at least one log to share.");
      setStage("Creating the public link…");
      const shareId = await createShare({
        storageId: primary.storageId,
        ogImageStorageId,
        fileName: primary.fileName,
        contentType: primary.contentType,
        browserVisitorId: getBrowserVisitorId(),
        sharerName: name,
        sharerEmail: email,
        vehicleDetails: vehicleDetails.trim() || undefined,
        description: description.trim() || undefined,
        fingerprint: primary.fingerprint,
        files,
        viewerWorkspace: captureSharedViewerWorkspace(
          getViewerConfig(),
          selectedLogs,
        ),
      });
      const url = `${window.location.origin}/share/${shareId}`;
      const viewerUrl = `/open?share=${encodeURIComponent(shareId)}`;
      markSharedLogOwned(shareId);
      onShareCreated?.(
        shareId,
        selectedLogs.map((log) => log.fileId as string),
      );
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-lg">
        <div className="border-b bg-gradient-to-br from-red-500/12 via-background to-background px-6 py-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-red-500/15 text-red-500 ring-1 ring-red-500/20">
            <Share2Icon className="size-5" />
          </div>
          <DialogTitle className="mt-4 text-xl">Share datalogs</DialogTitle>
          <DialogDescription className="mt-2 leading-relaxed">
            Create one public DragTrace link for a log or a comparison. It opens
            with your current pages, channels, overlays, and chart setup.
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
                ? "The button copies this link, then opens the public viewer in this browser. Anyone with the link can view it without an account."
                : "Anyone with this link can open the shared log or comparison. The link does not expose your account or unselected files in this browser."}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Because this browser created the link, later channel and layout
              changes you make to it will update the public starting view.
            </p>
          </div>
        ) : (
          <div className="space-y-5 px-6 py-5">
            {logs.length > 1 ? (
              <div className="overflow-hidden rounded-xl border">
                <div className="flex items-center justify-between border-b bg-muted/25 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Logs to include</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {selectedLogs.length} of {logs.length} selected
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setSelectedIds(
                        selectedLogs.length === Math.min(logs.length, MAX_SHARED_FILES)
                          ? []
                          : logs.slice(0, MAX_SHARED_FILES).map((log) => log.fileId),
                      )
                    }
                    className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {selectedLogs.length === Math.min(logs.length, MAX_SHARED_FILES)
                      ? "Clear"
                      : "Select all"}
                  </button>
                </div>
                <div className="max-h-52 divide-y overflow-y-auto">
                  {logs.map((log) => {
                    const file = getSourceFile(log.fileId);
                    const checked = selectedIds.includes(log.fileId);
                    return (
                      <div
                        key={log.fileId}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <Switch
                          appearance="form"
                          checked={checked}
                          title={`Include ${log.fileName}`}
                          onChange={(next) => {
                            setError(null);
                            setSelectedIds((current) => {
                              if (!next) {
                                return current.filter((id) => id !== log.fileId);
                              }
                              if (current.includes(log.fileId)) return current;
                              if (current.length >= MAX_SHARED_FILES) {
                                setError(
                                  `A share can include up to ${MAX_SHARED_FILES} logs.`,
                                );
                                return current;
                              }
                              return [...current, log.fileId];
                            });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={log.fileName}>
                            {log.fileName}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {log.parsed.format}
                            {file ? ` · ${formatBytes(file.size)}` : " · unavailable"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : primaryLog && primaryFile ? (
              <div className="rounded-xl border bg-muted/35 p-4">
                <p className="truncate font-medium" title={primaryLog.fileName}>
                  {primaryLog.fileName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {primaryLog.parsed.format} · {formatBytes(primaryFile.size)}
                </p>
              </div>
            ) : null}

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

            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div>
                <p className="text-sm font-medium">Shown publicly</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Add context for the people opening your shared log. Both
                  fields are optional.
                </p>
              </div>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Vehicle details</span>
                <input
                  value={vehicleDetails}
                  disabled={busy}
                  maxLength={300}
                  onChange={(event) => setVehicleDetails(event.target.value)}
                  placeholder="03 Evo 8 - Haltech 2500"
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Description or question</span>
                <textarea
                  value={description}
                  disabled={busy}
                  maxLength={2000}
                  rows={4}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What should people look at in this pass?"
                  className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                />
              </label>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/7 p-4 text-xs leading-relaxed text-muted-foreground">
              Opening logs here is still private. Publishing is the step that
              uploads only the selected logs and a preview image so anyone with
              the link can view the same comparison.
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
                  selectedLogs.length === 0 ||
                  selectedLogs.some((log) => !getSourceFile(log.fileId)) ||
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

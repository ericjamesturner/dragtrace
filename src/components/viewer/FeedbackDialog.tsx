import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import {
  CheckCircle2Icon,
  FilePlus2Icon,
  Loader2Icon,
  MessageSquareTextIcon,
  XIcon,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { errText } from "@/lib/error-text";
import { getBrowserVisitorId } from "@/lib/visitor-id";

const MAX_FILES = 3;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function FeedbackDialog({
  source,
  buttonClassName,
}: {
  source: "guest" | "account";
  buttonClassName?: string;
}) {
  const generateUploadUrl = useMutation(api.feedback.generateAttachmentUploadUrl);
  const submitFeedback = useMutation(api.feedback.submit);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setMessage("");
    setFiles([]);
    setBusy(false);
    setSent(false);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) reset();
  };

  const addFiles = (selected: File[]) => {
    const next = [...files, ...selected];
    if (next.length > MAX_FILES) {
      setError(`Attach no more than ${MAX_FILES} files.`);
      return;
    }
    if (next.some((file) => file.size > MAX_FILE_BYTES)) {
      setError("Each attachment must be 15 MB or smaller.");
      return;
    }
    if (next.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
      setError("Attachments must total 25 MB or less.");
      return;
    }
    setFiles(next);
    setError(null);
  };

  const submit = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attachments: {
        storageId: Id<"_storage">;
        fileName: string;
        contentType: string;
      }[] = [];
      for (const file of files) {
        const uploadUrl = await generateUploadUrl({});
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) throw new Error(`Could not upload ${file.name}`);
        const result = (await response.json()) as { storageId: Id<"_storage"> };
        attachments.push({
          storageId: result.storageId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        });
      }

      await submitFeedback({
        message: message.trim(),
        source,
        page: `${window.location.pathname}${window.location.search}`,
        browserVisitorId: getBrowserVisitorId(),
        attachments,
      });
      setSent(true);
    } catch (cause) {
      setError(errText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={buttonClassName}
        onClick={() => handleOpenChange(true)}
      >
        <MessageSquareTextIcon className="size-4" />
        Give Feedback
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          {sent ? (
            <>
              <div className="flex flex-col items-center py-5 text-center">
                <CheckCircle2Icon className="size-9 text-green-500" />
                <DialogTitle className="mt-3">Thanks — your feedback is saved.</DialogTitle>
                <DialogDescription className="mt-2">
                  Any attached files were saved with your report.
                </DialogDescription>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Give feedback</DialogTitle>
                <DialogDescription>
                  Tell us what went wrong, what is confusing, or what would make
                  DragTrace better.
                </DialogDescription>
              </DialogHeader>

              <div>
                <label htmlFor="feedback-message" className="text-sm font-medium">
                  Feedback
                </label>
                <Textarea
                  id="feedback-message"
                  className="mt-1 min-h-32 resize-y"
                  value={message}
                  maxLength={5000}
                  autoFocus
                  placeholder="What happened? What did you expect?"
                  onChange={(event) => setMessage(event.target.value)}
                />
                <div className="mt-1 text-right text-xs text-muted-foreground">
                  {message.length.toLocaleString()} / 5,000
                </div>
              </div>

              <div>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".csv,.log,.txt,.zip,.pdf,.png,.jpg,.jpeg"
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={files.length >= MAX_FILES}
                  onClick={() => inputRef.current?.click()}
                >
                  <FilePlus2Icon />
                  Attach files
                </Button>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Optional. Attach up to three logs, screenshots, or supporting files.
                  Attachments are uploaded and stored with this report.
                </p>
                {files.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {files.map((file, index) => (
                      <div
                        key={`${file.name}-${file.size}-${index}`}
                        className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate" title={file.name}>
                          {file.name}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatBytes(file.size)}
                        </span>
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={busy || !message.trim()} onClick={() => void submit()}>
                  {busy && <Loader2Icon className="animate-spin" />}
                  {busy ? "Sending…" : "Send feedback"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

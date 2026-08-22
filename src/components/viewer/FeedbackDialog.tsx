import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import {
  CheckCircle2Icon,
  FilePlus2Icon,
  Loader2Icon,
  MessageSquareTextIcon,
  StarIcon,
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
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [allowTestimonial, setAllowTestimonial] = useState(false);
  const [testimonialName, setTestimonialName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setRating(0);
    setMessage("");
    setAllowTestimonial(false);
    setTestimonialName("");
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
        rating,
        allowTestimonial,
        ...(allowTestimonial && testimonialName.trim()
          ? { testimonialName: testimonialName.trim() }
          : {}),
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
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          {sent ? (
            <>
              <div className="flex flex-col items-center py-5 text-center">
                <CheckCircle2Icon className="size-9 text-green-500" />
                <DialogTitle className="mt-3">Thanks — your feedback is saved.</DialogTitle>
                <DialogDescription className="mt-2">
                  We appreciate hearing what you love and what we can improve.
                </DialogDescription>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Share feedback</DialogTitle>
                <DialogDescription>
                  Tell us what you love, what we got right, or what would make
                  DragTrace even better.
                </DialogDescription>
              </DialogHeader>

              <fieldset>
                <legend className="text-sm font-medium">How are we doing?</legend>
                <div className="mt-1.5 flex items-center gap-1" role="radiogroup" aria-label="Star rating">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={rating === value}
                      aria-label={`${value} out of 5 stars`}
                      className={`rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        value <= rating
                          ? "text-amber-400"
                          : "text-muted-foreground/35 hover:text-amber-400/70"
                      }`}
                      onClick={() => setRating((current) => (current === value ? 0 : value))}
                    >
                      <StarIcon
                        className={`size-7 ${value <= rating ? "fill-current" : ""}`}
                      />
                    </button>
                  ))}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {rating === 0 ? "Optional" : `${rating} of 5`}
                  </span>
                </div>
              </fieldset>

              <div>
                <label htmlFor="feedback-message" className="text-sm font-medium">
                  Your feedback
                </label>
                <Textarea
                  id="feedback-message"
                  className="mt-1 min-h-32 resize-y"
                  value={message}
                  maxLength={5000}
                  autoFocus
                  placeholder="What did we get right? What do you enjoy? What could be even better?"
                  onChange={(event) => setMessage(event.target.value)}
                />
                <div className="mt-1 text-right text-xs text-muted-foreground">
                  {message.length.toLocaleString()} / 5,000
                </div>
              </div>

              <div className="rounded-lg border bg-muted/25 p-3">
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 rounded border-input accent-primary"
                    checked={allowTestimonial}
                    onChange={(event) => setAllowTestimonial(event.target.checked)}
                  />
                  <span>
                    <span className="font-medium">You may share this as a testimonial</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      Optional. We will only quote your feedback publicly if you check this.
                    </span>
                  </span>
                </label>
                {allowTestimonial && (
                  <div className="mt-3">
                    <label htmlFor="testimonial-name" className="text-xs font-medium">
                      Name to show <span className="font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <input
                      id="testimonial-name"
                      value={testimonialName}
                      maxLength={80}
                      placeholder="Your name, team, or business"
                      className="mt-1 block h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                      onChange={(event) => setTestimonialName(event.target.value)}
                    />
                  </div>
                )}
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

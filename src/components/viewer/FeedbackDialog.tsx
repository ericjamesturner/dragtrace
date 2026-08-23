import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import {
  CheckCircle2Icon,
  FilePlus2Icon,
  Loader2Icon,
  MailIcon,
  MessageSquareTextIcon,
  PaperclipIcon,
  QuoteIcon,
  SparklesIcon,
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
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errText } from "@/lib/error-text";
import { getBrowserVisitorId } from "@/lib/visitor-id";

const MAX_FILES = 3;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

const RATING_LABELS = [
  "Optional, but helpful",
  "Needs work",
  "Not there yet",
  "Pretty good",
  "Really good",
  "Love it",
] as const;

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
  const [contactEmail, setContactEmail] = useState("");
  const [allowTestimonial, setAllowTestimonial] = useState(false);
  const [testimonialName, setTestimonialName] = useState("");
  const [includeFiles, setIncludeFiles] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedEmail = contactEmail.trim();
  const emailInvalid = Boolean(trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail));

  const reset = () => {
    setRating(0);
    setMessage("");
    setContactEmail("");
    setAllowTestimonial(false);
    setTestimonialName("");
    setIncludeFiles(false);
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

  const handleIncludeFiles = (next: boolean) => {
    setIncludeFiles(next);
    if (!next) {
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    }
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
    if (!message.trim() || emailInvalid || busy) return;
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
        ...(trimmedEmail ? { contactEmail: trimmedEmail } : {}),
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
        <DialogContent className="!flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          {sent ? (
            <div className="flex min-h-80 flex-col items-center justify-center px-8 py-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
                <CheckCircle2Icon className="size-7 text-emerald-500" />
              </div>
              <DialogTitle className="mt-5 text-xl">
                Thanks for helping shape DragTrace.
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-sm leading-relaxed">
                Your feedback is saved. We appreciate knowing what you love and
                what would make the viewer even better.
              </DialogDescription>
              <Button className="mt-7 min-w-24" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b bg-gradient-to-br from-primary/12 via-primary/5 to-background px-5 py-5 pr-12 sm:px-6 sm:py-6 sm:pr-12">
                <div className="flex items-start gap-3.5">
                  <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                    <SparklesIcon className="size-5" />
                  </div>
                  <div>
                    <DialogTitle className="text-lg font-semibold tracking-tight">
                      Share your DragTrace experience
                    </DialogTitle>
                    <DialogDescription className="mt-1 max-w-md leading-relaxed">
                      Tell us what we got right, what you enjoy, or what would
                      make your next session better.
                    </DialogDescription>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
                <fieldset className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <legend className="text-sm font-semibold">Your experience</legend>
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      {rating === 0 ? "No rating" : `${rating} / 5`}
                    </span>
                  </div>
                  <div
                    className="mt-2.5 flex items-center gap-0.5"
                    role="radiogroup"
                    aria-label="Star rating"
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={rating === value}
                        aria-label={`${value} out of 5 stars`}
                        className={`rounded-md p-1 transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          value <= rating
                            ? "text-amber-400"
                            : "text-muted-foreground/30 hover:text-amber-400/70"
                        }`}
                        onClick={() =>
                          setRating((current) => (current === value ? 0 : value))
                        }
                      >
                        <StarIcon
                          className={`size-7 ${value <= rating ? "fill-current" : ""}`}
                        />
                      </button>
                    ))}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {RATING_LABELS[rating]}
                    </span>
                  </div>
                </fieldset>

                <div>
                  <div className="flex items-baseline justify-between gap-4">
                    <label htmlFor="feedback-message" className="text-sm font-semibold">
                      What’s on your mind?
                    </label>
                    <span className="text-xs text-muted-foreground">Required</span>
                  </div>
                  <Textarea
                    id="feedback-message"
                    className="mt-2 min-h-32 resize-y rounded-xl bg-muted/20"
                    value={message}
                    maxLength={5000}
                    autoFocus
                    placeholder="What did we get right? What do you love? What could be even better?"
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <div className="mt-1.5 text-right text-[11px] text-muted-foreground">
                    {message.length.toLocaleString()} / 5,000
                  </div>
                </div>

                <div>
                  <div className="flex items-baseline justify-between gap-4">
                    <label htmlFor="feedback-email" className="text-sm font-semibold">
                      Email
                    </label>
                    <span className="text-xs text-muted-foreground">Optional</span>
                  </div>
                  <div className="relative mt-2">
                    <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="feedback-email"
                      type="email"
                      value={contactEmail}
                      maxLength={254}
                      autoComplete="email"
                      aria-invalid={emailInvalid}
                      className="h-10 rounded-xl bg-muted/20 pl-9"
                      placeholder="you@example.com"
                      onChange={(event) => setContactEmail(event.target.value)}
                    />
                  </div>
                  <p
                    className={`mt-1.5 text-xs ${
                      emailInvalid ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {emailInvalid
                      ? "Enter a valid email address."
                      : "Private. We’ll only use it if we need to follow up about your feedback."}
                  </p>
                </div>

                <div className="overflow-hidden rounded-xl border bg-muted/[0.12]">
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-foreground/10">
                        <QuoteIcon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Share as a testimonial</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          Allow us to quote your feedback publicly. Your email is
                          never shown.
                        </p>
                      </div>
                      <Switch
                        appearance="form"
                        checked={allowTestimonial}
                        title="Share as a testimonial"
                        onChange={setAllowTestimonial}
                      />
                    </div>
                    {allowTestimonial && (
                      <div className="mt-3 border-t pt-3">
                        <label htmlFor="testimonial-name" className="text-xs font-medium">
                          Public name{" "}
                          <span className="font-normal text-muted-foreground">(optional)</span>
                        </label>
                        <Input
                          id="testimonial-name"
                          value={testimonialName}
                          maxLength={80}
                          placeholder="Your name, team, or business"
                          className="mt-1.5 h-9 bg-background"
                          onChange={(event) => setTestimonialName(event.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="border-t p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-foreground/10">
                        <PaperclipIcon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Include supporting files</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          Add a problem log, screenshot, or other helpful context.
                        </p>
                      </div>
                      <Switch
                        appearance="form"
                        checked={includeFiles}
                        title="Include supporting files"
                        onChange={handleIncludeFiles}
                      />
                    </div>

                    {includeFiles && (
                      <div className="mt-3 border-t pt-3">
                        <input
                          ref={inputRef}
                          type="file"
                          multiple
                          className="hidden"
                          accept=".csv,.log,.txt,.dl,.zip,.pdf,.png,.jpg,.jpeg"
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
                          Choose files
                        </Button>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          Up to 3 files · 15 MB each · 25 MB total
                        </p>
                        {files.length > 0 && (
                          <div className="mt-2.5 space-y-1.5">
                            {files.map((file, index) => (
                              <div
                                key={`${file.name}-${file.size}-${index}`}
                                className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-xs"
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
                                  onClick={() =>
                                    setFiles((current) =>
                                      current.filter((_, currentIndex) => currentIndex !== index),
                                    )
                                  }
                                >
                                  <XIcon className="size-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {error && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/35 px-5 py-3.5 sm:px-6">
                <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  className="min-w-32"
                  disabled={busy || !message.trim() || emailInvalid}
                  onClick={() => void submit()}
                >
                  {busy && <Loader2Icon className="animate-spin" />}
                  {busy ? "Sending…" : "Send feedback"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

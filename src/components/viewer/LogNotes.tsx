import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/** Live-saving notes for a log — same notes as the event dashboard card. */
export function LogNotes({ fileId }: { fileId: Id<"files"> }) {
  const file = useQuery(api.files.get, { id: fileId });
  const updateNotes = useMutation(api.files.updateNotes);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<string | null>(null);
  const focusedRef = useRef(false);

  const flush = useCallback(
    (value: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void updateNotes({ id: fileId, notes: value.trim() || undefined }).finally(
        () => setPending(false),
      );
    },
    [fileId, updateNotes],
  );

  const handleChange = (v: string) => {
    setDraft(v);
    latestRef.current = v;
    setPending(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(v), 600);
  };

  // Flush a pending edit if the log/component goes away mid-debounce
  useEffect(
    () => () => {
      if (timerRef.current && latestRef.current !== null) {
        clearTimeout(timerRef.current);
        void updateNotes({ id: fileId, notes: latestRef.current.trim() || undefined });
      }
    },
    [fileId, updateNotes],
  );

  // Once the server catches up (and we're not typing), drop the local draft
  // so remote edits show live again.
  const serverNotes = file?.notes ?? "";
  useEffect(() => {
    if (!focusedRef.current && draft !== null && !pending && serverNotes === draft.trim()) {
      setDraft(null);
    }
  }, [serverNotes, draft, pending]);

  if (!file) return null;
  const value = draft ?? serverNotes;

  return (
    <div className="px-2 mb-1.5">
      <div className="flex items-center justify-between px-1 pb-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Run Notes
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          {pending ? "saving…" : ""}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (timerRef.current && latestRef.current !== null) flush(latestRef.current);
        }}
        placeholder="Add notes about this run…"
        rows={value ? Math.min(8, value.split("\n").length + 1) : 2}
        className="w-full px-2 py-1.5 rounded bg-muted/50 border border-border text-xs leading-relaxed placeholder:text-muted-foreground/60 outline-none focus:border-primary resize-y"
      />
    </div>
  );
}

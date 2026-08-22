import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBrowserVisitorId } from "@/lib/visitor-id";

type ViewerSource = "guest" | "account";

/** Records actual viewer use, not visits to the marketing/open-file screen. */
export function useViewerAnalytics(
  source: ViewerSource,
  logFingerprints: string[],
) {
  const startSession = useMutation(api.analytics.startSession);
  const addLogs = useMutation(api.analytics.addLogs);
  const heartbeat = useMutation(api.analytics.heartbeat);
  const [sessionId, setSessionId] = useState<Id<"viewerSessions"> | null>(null);
  const sentLogsRef = useRef(new Set<string>());
  const fingerprintKey = logFingerprints.join(",");

  useEffect(() => {
    // Avoid filling real analytics while exercising the local dev UI.
    if (import.meta.env.DEV) return;
    let cancelled = false;
    const initial = [...new Set(logFingerprints)];
    void startSession({
      browserVisitorId: getBrowserVisitorId(),
      source,
      logFingerprints: initial,
    })
      .then((id) => {
        if (cancelled) return;
        sentLogsRef.current = new Set(initial);
        setSessionId(id);
      })
      .catch(() => {
        // Analytics must never interrupt the viewer.
      });
    return () => {
      cancelled = true;
    };
    // A mounted viewer is exactly one session. Later logs use addLogs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, startSession]);

  useEffect(() => {
    if (!sessionId) return;
    const unseen = logFingerprints.filter(
      (fingerprint) => !sentLogsRef.current.has(fingerprint),
    );
    if (unseen.length === 0) return;
    for (const fingerprint of unseen) sentLogsRef.current.add(fingerprint);
    void addLogs({ sessionId, logFingerprints: unseen }).catch(() => {
      for (const fingerprint of unseen) sentLogsRef.current.delete(fingerprint);
    });
  }, [sessionId, fingerprintKey, logFingerprints, addLogs]);

  useEffect(() => {
    if (!sessionId) return;
    let lastTick = Date.now();
    let lastActivity = lastTick;
    let wasVisible = document.visibilityState === "visible";

    const noteActivity = () => {
      lastActivity = Date.now();
    };
    const flush = () => {
      const now = Date.now();
      const startedAt = lastTick;
      lastTick = now;
      if (!wasVisible) return;
      // Stop calling a visible-but-abandoned tab active after one minute.
      const activeUntil = Math.min(now, lastActivity + 60_000);
      const activeMs = Math.max(0, activeUntil - startedAt);
      if (activeMs > 0) {
        void heartbeat({ sessionId, activeMs }).catch(() => undefined);
      }
    };
    const onVisibility = () => {
      flush();
      wasVisible = document.visibilityState === "visible";
      lastTick = Date.now();
      if (wasVisible) lastActivity = lastTick;
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
    ];
    for (const event of activityEvents) {
      window.addEventListener(event, noteActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(flush, 15_000);

    return () => {
      window.clearInterval(interval);
      flush();
      document.removeEventListener("visibilitychange", onVisibility);
      for (const event of activityEvents) {
        window.removeEventListener(event, noteActivity);
      }
    };
  }, [sessionId, heartbeat]);
}

import { useCallback, useEffect, useRef } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const SESSION_KEY = "dragtrace:activity-session";
const SESSION_STARTED_KEY = "dragtrace:activity-session-started";

export type ActivityAction =
  | "account_session_started"
  | "signed_out"
  | "vehicle_opened"
  | "event_opened"
  | "log_opened"
  | "log_comparison_changed"
  | "settings_opened";

export type ActivityContext = {
  vehicleId?: Id<"vehicles">;
  eventId?: Id<"events">;
  fileIds?: Id<"files">[];
  section?: string;
};

function newSessionKey() {
  const random = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `tab:${random}`;
}

function getSessionKey() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = newSessionKey();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return newSessionKey();
  }
}

function clearActivitySession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_STARTED_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}

export function useActivityLog() {
  const record = useMutation(api.activity.record);
  const sessionKey = useRef(getSessionKey());

  return useCallback(
    async (action: ActivityAction, context: ActivityContext = {}) => {
      try {
        await record({
          action,
          sessionKey: sessionKey.current,
          route: `${window.location.pathname}${window.location.search}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: navigator.language,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          ...context,
        });
      } catch {
        // Product logging should never interrupt the person's work.
      }
    },
    [record],
  );
}

export function useActivitySession() {
  const recordActivity = useActivityLog();
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_STARTED_KEY)) return;
      sessionStorage.setItem(SESSION_STARTED_KEY, "1");
    } catch {
      // The server also de-duplicates duplicate start events.
    }
    void recordActivity("account_session_started");
  }, [recordActivity]);
}

export function useTrackedSignOut() {
  const { signOut } = useAuthActions();
  const recordActivity = useActivityLog();

  return useCallback(async () => {
    await recordActivity("signed_out");
    clearActivitySession();
    await signOut();
  }, [recordActivity, signOut]);
}

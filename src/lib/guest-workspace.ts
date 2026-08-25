import type { LoadedLog, ViewerConfig } from "./viewer-types";
import { migrateConfig, remapConfigToFiles } from "./viewer-types";

/**
 * Guest logs never leave the browser and are not retained. The lightweight
 * viewer workspace can safely survive a visit, though, so returning racers do
 * not have to rebuild the same pages and traces every time.
 */
export const GUEST_WORKSPACE_STORAGE_KEY =
  "dragtrace:guest-viewer-workspace:v1";

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadGuestWorkspace(
  logs: LoadedLog[],
  storage: Storage | null = getBrowserStorage(),
  storageKey = GUEST_WORKSPACE_STORAGE_KEY,
): ViewerConfig | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return remapConfigToFiles(
      migrateConfig(parsed as Record<string, unknown>),
      logs,
    );
  } catch {
    return null;
  }
}

export function saveGuestWorkspace(
  config: ViewerConfig,
  storage: Storage | null = getBrowserStorage(),
  storageKey = GUEST_WORKSPACE_STORAGE_KEY,
): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(config));
  } catch {
    // Browsers can disable or fill localStorage. The viewer still works for
    // the current visit when persistence is unavailable.
  }
}

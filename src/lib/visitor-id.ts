const STORAGE_KEY = "dragtrace:analytics:visitor";
let memoryId: string | null = null;

/**
 * A random installation id used for aggregate guest-viewer counts. It contains
 * no account, device, IP, or log information.
 */
export function getBrowserVisitorId(): string {
  if (memoryId) return memoryId;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      memoryId = stored;
      return stored;
    }
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }

  memoryId = crypto.randomUUID();
  try {
    localStorage.setItem(STORAGE_KEY, memoryId);
  } catch {
    // The in-memory id still keeps this page view internally consistent.
  }
  return memoryId;
}

const OWNED_SHARES_KEY = "dragtrace:owned-shares:v1";
const MAX_OWNED_SHARES = 100;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readOwnedShares(): string[] {
  const localStorage = storage();
  if (!localStorage) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OWNED_SHARES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function markSharedLogOwned(shareId: string): void {
  const localStorage = storage();
  if (!localStorage) return;
  try {
    const next = [shareId, ...readOwnedShares().filter((id) => id !== shareId)]
      .slice(0, MAX_OWNED_SHARES);
    localStorage.setItem(OWNED_SHARES_KEY, JSON.stringify(next));
  } catch {
    // Ownership syncing is a convenience; the public link still works.
  }
}

export function isSharedLogOwner(shareId: string): boolean {
  return readOwnedShares().includes(shareId);
}

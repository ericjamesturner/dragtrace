/**
 * The human sentence out of a Convex server error. Raw messages arrive as
 * "[CONVEX ...] [Request ID: ...] Server Error\nUncaught Error: <message>\n at ..."
 * and nobody should ever see that scaffolding.
 */
export function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const match = raw.match(/Uncaught Error: (.*)/);
  if (match) return match[1].trim();
  // No wrapper — first line of whatever we got.
  return raw.split("\n")[0].trim();
}

import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * The signed-in user's own identity, for showing "who am I" in the shell.
 * Deliberately the real user, not the impersonated one — the impersonation
 * banner already names the target.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const u = user as { email?: string; name?: string } | null;
    return { email: u?.email ?? null, name: u?.name ?? null };
  },
});

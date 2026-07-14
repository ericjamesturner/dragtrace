import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const ADMIN_EMAILS = new Set(["eric@ravenfab.com"]);

export async function isAdminUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return !!user?.email && ADMIN_EMAILS.has(user.email);
}

/**
 * The user whose data this request operates on: the signed-in user, or the
 * impersonated customer when the signed-in user is an admin with an active
 * impersonation.
 */
export async function getEffectiveUserId(
  ctx: QueryCtx,
): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const imp = await ctx.db
    .query("impersonations")
    .withIndex("by_admin", (q) => q.eq("adminUserId", userId))
    .unique();
  if (!imp) return userId;
  if (!(await isAdminUser(ctx, userId))) return userId;
  return imp.targetUserId;
}

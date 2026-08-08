import { query, mutation } from "./_generated/server";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";

/**
 * Display preferences belong to the person, not the page they happen to be on.
 * A vehicle can override individual quantities — one car on methanol, another
 * on diesel — but everything not overridden inherits from here.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return null;
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return prefs ?? null;
  },
});

export const setUnits = mutation({
  args: {
    unitSystem: v.optional(v.string()),
    unitOverrides: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const patch = {
      ...(args.unitSystem !== undefined ? { unitSystem: args.unitSystem } : {}),
      ...(args.unitOverrides !== undefined ? { unitOverrides: args.unitOverrides } : {}),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("userPreferences", { userId, ...patch });
  },
});

/**
 * Seed preferences from a viewer workspace, for users whose unit choices were
 * made before preferences existed. Does nothing once a row is present, so it is
 * safe to call on every viewer load.
 */
export const seedFromWorkspace = mutation({
  args: {
    unitSystem: v.optional(v.string()),
    unitOverrides: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return false;
    await ctx.db.insert("userPreferences", {
      userId,
      unitSystem: args.unitSystem,
      unitOverrides: args.unitOverrides,
    });
    return true;
  },
});

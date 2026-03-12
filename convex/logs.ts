import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("logs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const add = mutation({
  args: {
    level: v.union(
      v.literal("info"),
      v.literal("warn"),
      v.literal("error"),
      v.literal("debug")
    ),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.insert("logs", {
      userId,
      level: args.level,
      message: args.message,
      timestamp: Date.now(),
    });
  },
});

import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { isAdminUser } from "./authz";

export const state = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await isAdminUser(ctx, userId))) {
      return { isAdmin: false, impersonating: null };
    }
    const imp = await ctx.db
      .query("impersonations")
      .withIndex("by_admin", (q) => q.eq("adminUserId", userId))
      .unique();
    const target = imp ? await ctx.db.get(imp.targetUserId) : null;
    return {
      isAdmin: true,
      impersonating: target
        ? { userId: target._id, email: target.email ?? "", name: target.name ?? "" }
        : null,
    };
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await isAdminUser(ctx, userId))) return [];
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u._id !== userId)
      .map((u) => ({ userId: u._id, email: u.email ?? "", name: u.name ?? "" }))
      .sort((a, b) => a.email.localeCompare(b.email));
  },
});

export const impersonate = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const adminId = await getAuthUserId(ctx);
    if (!adminId || !(await isAdminUser(ctx, adminId))) {
      throw new Error("Not authorized");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    const existing = await ctx.db
      .query("impersonations")
      .withIndex("by_admin", (q) => q.eq("adminUserId", adminId))
      .unique();
    if (args.userId === adminId) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (existing) {
      await ctx.db.patch(existing._id, { targetUserId: args.userId });
    } else {
      await ctx.db.insert("impersonations", {
        adminUserId: adminId,
        targetUserId: args.userId,
      });
    }
  },
});

export const stopImpersonating = mutation({
  args: {},
  handler: async (ctx) => {
    const adminId = await getAuthUserId(ctx);
    if (!adminId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("impersonations")
      .withIndex("by_admin", (q) => q.eq("adminUserId", adminId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

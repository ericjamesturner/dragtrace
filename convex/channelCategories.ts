import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const listByEcuType = query({
  args: { ecuType: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channelCategories")
      .withIndex("by_ecu_type", (q) => q.eq("ecuType", args.ecuType))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    parentId: v.optional(v.id("channelCategories")),
    ecuType: v.string(),
    color: v.optional(v.string()),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.db.insert("channelCategories", {
      name: args.name,
      parentId: args.parentId,
      ecuType: args.ecuType,
      color: args.color,
      sortOrder: args.sortOrder,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("channelCategories"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    parentId: v.optional(v.id("channelCategories")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const { id, ...patch } = args;
    // Remove undefined fields
    const cleaned: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) cleaned[k] = val;
    }
    await ctx.db.patch(id, cleaned);
  },
});

export const remove = mutation({
  args: { id: v.id("channelCategories") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const category = await ctx.db.get(args.id);
    if (!category) throw new Error("Category not found");

    // Find "Other" category for this ECU type
    const allCats = await ctx.db
      .query("channelCategories")
      .withIndex("by_ecu_type", (q) => q.eq("ecuType", category.ecuType))
      .collect();
    const otherCat = allCats.find((c) => c.name === "Other" && !c.parentId);
    if (!otherCat) throw new Error("Other category not found");

    // Move orphaned mappings to "Other"
    const mappings = await ctx.db
      .query("channelMappings")
      .withIndex("by_category", (q) => q.eq("categoryId", args.id))
      .collect();
    for (const m of mappings) {
      await ctx.db.patch(m._id, { categoryId: otherCat._id });
    }

    // Move child categories to root
    const children = await ctx.db
      .query("channelCategories")
      .withIndex("by_parent", (q) => q.eq("parentId", args.id))
      .collect();
    for (const child of children) {
      await ctx.db.delete(child._id);
      // Move their mappings to Other too
      const childMappings = await ctx.db
        .query("channelMappings")
        .withIndex("by_category", (q) => q.eq("categoryId", child._id))
        .collect();
      for (const m of childMappings) {
        await ctx.db.patch(m._id, { categoryId: otherCat._id });
      }
    }

    await ctx.db.delete(args.id);
  },
});

export const reorder = mutation({
  args: {
    updates: v.array(v.object({
      id: v.id("channelCategories"),
      sortOrder: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    for (const update of args.updates) {
      await ctx.db.patch(update.id, { sortOrder: update.sortOrder });
    }
  },
});

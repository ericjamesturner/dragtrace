import { query, mutation } from "./_generated/server";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";

export const listByVehicle = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) return [];
    return await ctx.db
      .query("vehicleChannelOverrides")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .collect();
  },
});

export const setOverride = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    channelName: v.string(),
    categoryId: v.optional(v.id("channelCategories")),
    displayName: v.optional(v.string()),
    unitKey: v.optional(v.string()),
    hidden: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");

    const existing = await ctx.db
      .query("vehicleChannelOverrides")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .collect();
    const override = existing.find((o) => o.channelName === args.channelName);

    if (override) {
      const patch: Record<string, unknown> = {};
      if (args.categoryId !== undefined) patch.categoryId = args.categoryId;
      if (args.displayName !== undefined) patch.displayName = args.displayName;
      if (args.unitKey !== undefined) patch.unitKey = args.unitKey;
      if (args.hidden !== undefined) patch.hidden = args.hidden;
      await ctx.db.patch(override._id, patch);
    } else {
      await ctx.db.insert("vehicleChannelOverrides", {
        vehicleId: args.vehicleId,
        channelName: args.channelName,
        categoryId: args.categoryId,
        displayName: args.displayName,
        unitKey: args.unitKey,
        hidden: args.hidden,
        createdAt: Date.now(),
      });
    }
  },
});

export const removeOverride = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    channelName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");

    const existing = await ctx.db
      .query("vehicleChannelOverrides")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .collect();
    const override = existing.find((o) => o.channelName === args.channelName);
    if (!override) return;

    // This mutation resets only the custom display name. Preserve the other
    // per-channel choices that now share this record (units, category, etc.).
    if (
      override.categoryId !== undefined ||
      override.unitKey !== undefined ||
      override.hidden !== undefined
    ) {
      await ctx.db.patch(override._id, { displayName: undefined });
    } else {
      await ctx.db.delete(override._id);
    }
  },
});

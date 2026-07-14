import { query, mutation } from "./_generated/server";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";

export const getForVehicle = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("workspaces")
      .withIndex("by_vehicle_user", (q) =>
        q.eq("vehicleId", args.vehicleId).eq("userId", userId),
      )
      .collect();
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.id("workspaces")),
    vehicleId: v.id("vehicles"),
    name: v.string(),
    config: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.userId !== userId) throw new Error("Not found");
      await ctx.db.patch(args.id, {
        name: args.name,
        config: args.config,
        updatedAt: Date.now(),
      });
      return args.id;
    }

    return await ctx.db.insert("workspaces", {
      userId,
      vehicleId: args.vehicleId,
      name: args.name,
      config: args.config,
      updatedAt: Date.now(),
    });
  },
});

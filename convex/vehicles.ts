import { query, mutation } from "./_generated/server";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";

const vehicleDetails = {
  year: v.optional(v.number()),
  make: v.optional(v.string()),
  model: v.optional(v.string()),
  raceWeightLb: v.optional(v.number()),
};

function validateVehicleDetails(args: {
  year?: number;
  raceWeightLb?: number;
}) {
  const nextYear = new Date().getFullYear() + 1;
  if (
    args.year !== undefined &&
    (!Number.isInteger(args.year) || args.year < 1886 || args.year > nextYear)
  ) {
    throw new Error(`Year must be between 1886 and ${nextYear}`);
  }
  if (
    args.raceWeightLb !== undefined &&
    (!Number.isFinite(args.raceWeightLb) ||
      args.raceWeightLb <= 0 ||
      args.raceWeightLb > 100_000)
  ) {
    throw new Error("Race weight must be between 1 and 100,000 lb");
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("vehicles") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return null;
    const vehicle = await ctx.db.get(args.id);
    if (!vehicle || vehicle.userId !== userId) return null;
    return vehicle;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    ...vehicleDetails,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    validateVehicleDetails(args);
    return await ctx.db.insert("vehicles", {
      userId,
      name: args.name,
      year: args.year,
      make: args.make,
      model: args.model,
      raceWeightLb: args.raceWeightLb,
      description: args.description,
      createdAt: Date.now(),
    });
  },
});

/**
 * Per-quantity display overrides for one vehicle. Sparse: a quantity absent
 * here inherits the user's preference, so a car running methanol only needs to
 * say so about AFR.
 */
export const setUnitOverrides = mutation({
  args: {
    id: v.id("vehicles"),
    unitOverrides: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const vehicle = await ctx.db.get(args.id);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { unitOverrides: args.unitOverrides });
  },
});

export const update = mutation({
  args: {
    id: v.id("vehicles"),
    name: v.string(),
    ...vehicleDetails,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const vehicle = await ctx.db.get(args.id);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");
    validateVehicleDetails(args);
    await ctx.db.patch(args.id, {
      name: args.name,
      year: args.year,
      make: args.make,
      model: args.model,
      raceWeightLb: args.raceWeightLb,
      description: args.description,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("vehicles") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const vehicle = await ctx.db.get(args.id);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");

    // Cascade: delete all events and their files
    const events = await ctx.db
      .query("events")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.id))
      .collect();

    for (const event of events) {
      const files = await ctx.db
        .query("files")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      for (const file of files) {
        const timeslips = await ctx.db
          .query("timeslips")
          .withIndex("by_file", (q) => q.eq("fileId", file._id))
          .collect();
        for (const ts of timeslips) {
          await ctx.db.delete(ts._id);
        }
        await ctx.storage.delete(file.storageId);
        await ctx.db.delete(file._id);
      }
      await ctx.db.delete(event._id);
    }

    await ctx.db.delete(args.id);
  },
});

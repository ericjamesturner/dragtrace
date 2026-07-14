import { query, mutation } from "./_generated/server";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";

export const listByVehicle = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    const events = await ctx.db
      .query("events")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .collect();
    // Enrich with file + timeslip counts
    const enriched = await Promise.all(
      events.map(async (event) => {
        const files = await ctx.db
          .query("files")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();
        let timeslipCount = 0;
        for (const file of files) {
          const ts = await ctx.db
            .query("timeslips")
            .withIndex("by_file", (q) => q.eq("fileId", file._id))
            .collect();
          timeslipCount += ts.length;
        }
        return { ...event, fileCount: files.length, timeslipCount };
      })
    );
    // Sort by date descending
    return enriched.sort((a, b) => b.date.localeCompare(a.date));
  },
});

export const get = query({
  args: { id: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return null;
    const event = await ctx.db.get(args.id);
    if (!event || event.userId !== userId) return null;
    return event;
  },
});

export const create = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    name: v.string(),
    date: v.string(),
    endDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    // Verify vehicle ownership
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");
    return await ctx.db.insert("events", {
      userId,
      vehicleId: args.vehicleId,
      name: args.name,
      date: args.date,
      endDate: args.endDate,
      notes: args.notes,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("events"),
    name: v.string(),
    date: v.string(),
    endDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const event = await ctx.db.get(args.id);
    if (!event || event.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, {
      name: args.name,
      date: args.date,
      endDate: args.endDate,
      notes: args.notes,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const event = await ctx.db.get(args.id);
    if (!event || event.userId !== userId) throw new Error("Not found");

    // Cascade: delete all files
    const files = await ctx.db
      .query("files")
      .withIndex("by_event", (q) => q.eq("eventId", args.id))
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

    await ctx.db.delete(args.id);
  },
});

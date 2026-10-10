import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";
import { changeDetail } from "./schema";

const changeFields = {
  date: v.string(),
  category: v.string(),
  title: v.string(),
  notes: v.optional(v.string()),
  afterFileId: v.optional(v.id("files")),
};

/** The car's changes, newest first. */
export const listByVehicle = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) return [];
    const changes = await ctx.db
      .query("changes")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .collect();
    return changes.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  },
});

async function ownedFile(ctx: MutationCtx, userId: Id<"users">, vehicleId: Id<"vehicles">, fileId?: Id<"files">) {
  if (!fileId) return;
  const file = await ctx.db.get(fileId);
  if (!file || file.userId !== userId || file.vehicleId !== vehicleId) throw new Error("Not found");
}

export const create = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    ...changeFields,
    source: v.optional(v.union(v.literal("manual"), v.literal("tune"))),
    items: v.optional(v.array(v.string())),
    details: v.optional(v.array(changeDetail)),
    toFileId: v.optional(v.id("files")),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");
    await ownedFile(ctx, userId, args.vehicleId, args.afterFileId);
    await ownedFile(ctx, userId, args.vehicleId, args.toFileId);
    const source = args.source ?? "manual";
    // A tune change read from the logs is one entry per pair of passes, so
    // reading the same uploads again doesn't stack duplicates.
    if (source === "tune" && args.toFileId) {
      const existing = await ctx.db
        .query("changes")
        .withIndex("by_to_file", (q) => q.eq("toFileId", args.toFileId))
        .collect();
      const old = existing.find((c) => c.source === "tune");
      if (old) {
        await ctx.db.patch(old._id, {
          date: args.date,
          category: args.category,
          title: args.title,
          notes: args.notes,
          items: args.items,
          details: args.details,
          afterFileId: args.afterFileId,
        });
        return old._id;
      }
    }
    return await ctx.db.insert("changes", {
      userId,
      vehicleId: args.vehicleId,
      date: args.date,
      category: args.category,
      title: args.title,
      notes: args.notes,
      afterFileId: args.afterFileId,
      toFileId: args.toFileId,
      source,
      items: args.items,
      details: args.details,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: { id: v.id("changes"), ...changeFields },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const change = await ctx.db.get(args.id);
    if (!change || change.userId !== userId) throw new Error("Not found");
    await ownedFile(ctx, userId, change.vehicleId, args.afterFileId);
    await ctx.db.patch(args.id, {
      date: args.date,
      category: args.category,
      title: args.title,
      notes: args.notes,
      afterFileId: args.afterFileId,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("changes") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const change = await ctx.db.get(args.id);
    if (!change || change.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});

/**
 * A pass is going away: a tune change read across it goes with it, and a
 * hand-logged change that pointed at it keeps its date but loses the link.
 */
export async function detachChangesFromFile(ctx: MutationCtx, fileId: Id<"files">) {
  const after = await ctx.db
    .query("changes")
    .withIndex("by_after_file", (q) => q.eq("afterFileId", fileId))
    .collect();
  const to = await ctx.db
    .query("changes")
    .withIndex("by_to_file", (q) => q.eq("toFileId", fileId))
    .collect();
  for (const c of [...after, ...to]) {
    if (c.source === "tune") await ctx.db.delete(c._id);
    else await ctx.db.patch(c._id, { afterFileId: undefined });
  }
}

/** The car itself is going away. */
export async function removeVehicleChanges(ctx: MutationCtx, vehicleId: Id<"vehicles">) {
  const changes = await ctx.db
    .query("changes")
    .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicleId))
    .collect();
  for (const c of changes) await ctx.db.delete(c._id);
}

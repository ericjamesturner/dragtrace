import { query, mutation } from "./_generated/server";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveFile = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    eventId: v.id("events"),
    vehicleId: v.id("vehicles"),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    // Verify event ownership
    const event = await ctx.db.get(args.eventId);
    if (!event || event.userId !== userId) throw new Error("Not found");
    // ...and that the vehicle is the caller's, and is the event's vehicle, so
    // a file can't be grafted onto another tenant's by_vehicle listing.
    if (event.vehicleId !== args.vehicleId) throw new Error("Not found");
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");
    // Shift existing files down to make room at the top
    const existing = await ctx.db
      .query("files")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const f of existing) {
      await ctx.db.patch(f._id, { order: (f.order ?? 0) + 1 });
    }
    return await ctx.db.insert("files", {
      userId,
      vehicleId: args.vehicleId,
      eventId: args.eventId,
      storageId: args.storageId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      contentType: args.contentType,
      order: 0,
      uploadedAt: Date.now(),
    });
  },
});

export const listByEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    const event = await ctx.db.get(args.eventId);
    if (!event || event.userId !== userId) return [];
    const files = await ctx.db
      .query("files")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    return files.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  },
});

/** Every pass for one vehicle, newest first — the pass list's wider scope. */
export const listByVehicle = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) return [];
    const files = await ctx.db
      .query("files")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .collect();
    return files.sort((a, b) => b.uploadedAt - a.uploadedAt);
  },
});

export const get = query({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return null;
    const file = await ctx.db.get(args.id);
    if (!file || file.userId !== userId) return null;
    return file;
  },
});

// Takes a file id rather than a storage id so the caller's ownership of the
// underlying log can be checked. A raw storage id carries no owner.
export const getUrl = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return null;
    const file = await ctx.db.get(args.fileId);
    if (!file || file.userId !== userId) return null;
    return await ctx.storage.getUrl(file.storageId);
  },
});

export const remove = mutation({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const file = await ctx.db.get(args.id);
    if (!file || file.userId !== userId) throw new Error("Not found");
    // Cascade: delete timeslips
    const timeslips = await ctx.db
      .query("timeslips")
      .withIndex("by_file", (q) => q.eq("fileId", args.id))
      .collect();
    for (const ts of timeslips) {
      await ctx.db.delete(ts._id);
    }
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(args.id);
  },
});

export const savePreview = mutation({
  args: {
    id: v.id("files"),
    preview: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const file = await ctx.db.get(args.id);
    if (!file || file.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { preview: args.preview });
  },
});

export const rename = mutation({
  args: {
    id: v.id("files"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const file = await ctx.db.get(args.id);
    if (!file || file.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { fileName: args.fileName });
  },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("files")) },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    for (let i = 0; i < args.ids.length; i++) {
      const file = await ctx.db.get(args.ids[i]);
      if (!file || file.userId !== userId) throw new Error("Not found");
      await ctx.db.patch(args.ids[i], { order: i });
    }
  },
});

/** The round this pass ran (T1, Q2, E3...) — on the file, so a pass can
 *  carry its round before any timeslip is entered. */
export const updateRound = mutation({
  args: {
    id: v.id("files"),
    round: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const file = await ctx.db.get(args.id);
    if (!file || file.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { round: args.round });
  },
});

export const updateNotes = mutation({
  args: {
    id: v.id("files"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const file = await ctx.db.get(args.id);
    if (!file || file.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { notes: args.notes });
  },
});

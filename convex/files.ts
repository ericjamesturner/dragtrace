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
    const files = await ctx.db
      .query("files")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    return files.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
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

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
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

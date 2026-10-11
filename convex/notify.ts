import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/** How many of the vehicle's latest passes the alert's Health check compares against. */
const HEALTH_REFS = 30;

/** What a new-log alert says, and the preview to draw for it. Null once the file is gone. */
export const alertInfo = internalQuery({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) return null;
    const [user, vehicle, event] = await Promise.all([
      ctx.db.get(file.userId),
      ctx.db.get(file.vehicleId),
      ctx.db.get(file.eventId),
    ]);
    // What the Health check needs: this pass, the vehicle's other counted
    // passes to judge it against (the latest ones are enough), and the units.
    const others = (
      await ctx.db
        .query("files")
        .withIndex("by_vehicle", (q) => q.eq("vehicleId", file.vehicleId))
        .collect()
    )
      .filter((f) => f._id !== file._id && !f.excluded && f.preview)
      .sort((a, b) => b.uploadedAt - a.uploadedAt)
      .slice(0, HEALTH_REFS);
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", file.userId))
      .first();
    return {
      title: `New log from ${user?.email ?? user?.name ?? file.userId}`,
      message: `${vehicle?.name ?? "Unknown vehicle"} · ${event?.name ?? "Unknown event"}`,
      preview: file.preview ?? null,
      refPreviews: others.map((f) => f.preview!),
      unitSystem: prefs?.unitSystem ?? null,
      unitOverrides: [prefs?.unitOverrides ?? null, vehicle?.unitOverrides ?? null],
    };
  },
});

/** The fallback for an upload whose preview never came: alert without a picture. */
export const flushUploadAlert = internalMutation({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file?.uploadAlertPending) return;
    await ctx.db.patch(args.fileId, { uploadAlertPending: undefined });
    await ctx.scheduler.runAfter(0, internal.notifyImage.sendLogAlert, { fileId: args.fileId, withImage: false });
  },
});

/** ntfy.sh drops a message after 12 hours; its picture has no use after that. */
export const deleteAlertImage = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
  },
});

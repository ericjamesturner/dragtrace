import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { getEffectiveUserId, requireAdmin } from "./authz";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const CLIENT_ACTIONS = v.union(
  v.literal("account_session_started"),
  v.literal("signed_out"),
  v.literal("vehicle_opened"),
  v.literal("event_opened"),
  v.literal("log_opened"),
  v.literal("log_comparison_changed"),
  v.literal("settings_opened"),
);

function limited(value: string | undefined, max: number) {
  if (value === undefined) return undefined;
  return value.trim().slice(0, max) || undefined;
}

async function pruneExpired(ctx: MutationCtx, now: number) {
  const expired = await ctx.db
    .query("activityEvents")
    .withIndex("by_time", (q) => q.lt("occurredAt", now - RETENTION_MS))
    .take(25);
  await Promise.all(expired.map((event) => ctx.db.delete(event._id)));
}

/** Called by the auth provider itself, so this is an actual new login. */
export async function recordAuthSignIn(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const now = Date.now();
  const metadata = await ctx.meta.getRequestMetadata();
  await ctx.db.insert("activityEvents", {
    actorUserId: userId,
    effectiveUserId: userId,
    action: "signed_in",
    occurredAt: now,
    ipAddress: metadata.ip ?? undefined,
    userAgent: metadata.userAgent ?? undefined,
    requestId: metadata.requestId,
  });
  await pruneExpired(ctx, now);
}

export const record = mutation({
  args: {
    action: CLIENT_ACTIONS,
    sessionKey: v.string(),
    route: v.optional(v.string()),
    vehicleId: v.optional(v.id("vehicles")),
    eventId: v.optional(v.id("events")),
    fileIds: v.optional(v.array(v.id("files"))),
    section: v.optional(v.string()),
    timezone: v.optional(v.string()),
    locale: v.optional(v.string()),
    viewport: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorUserId = await getAuthUserId(ctx);
    if (!actorUserId) throw new Error("Not authenticated");
    const effectiveUserId = await getEffectiveUserId(ctx);
    if (!effectiveUserId) throw new Error("Not authenticated");
    if (!/^[a-zA-Z0-9:_-]{16,120}$/.test(args.sessionKey)) {
      throw new Error("Invalid activity session");
    }

    const fileIds = [...new Set(args.fileIds ?? [])];
    if (fileIds.length > 10) throw new Error("Too many logs");

    const vehicle = args.vehicleId ? await ctx.db.get(args.vehicleId) : null;
    if (args.vehicleId && (!vehicle || vehicle.userId !== effectiveUserId)) {
      throw new Error("Not found");
    }
    const event = args.eventId ? await ctx.db.get(args.eventId) : null;
    if (
      args.eventId &&
      (!event ||
        event.userId !== effectiveUserId ||
        (args.vehicleId !== undefined && event.vehicleId !== args.vehicleId))
    ) {
      throw new Error("Not found");
    }
    for (const fileId of fileIds) {
      const file = await ctx.db.get(fileId);
      if (
        !file ||
        file.userId !== effectiveUserId ||
        (args.vehicleId !== undefined && file.vehicleId !== args.vehicleId) ||
        (args.eventId !== undefined && file.eventId !== args.eventId)
      ) {
        throw new Error("Not found");
      }
    }

    const now = Date.now();
    const metadata = await ctx.meta.getRequestMetadata();
    const existingRequest = await ctx.db
      .query("activityEvents")
      .withIndex("by_request", (q) => q.eq("requestId", metadata.requestId))
      .first();
    if (existingRequest) return existingRequest._id;

    // React development mode and quick route reconciliation can emit the same
    // event twice. Keep the timeline human-readable.
    const previous = await ctx.db
      .query("activityEvents")
      .withIndex("by_session_time", (q) => q.eq("sessionKey", args.sessionKey))
      .order("desc")
      .first();
    const route = limited(args.route, 500);
    if (
      previous &&
      now - previous.occurredAt < 2_000 &&
      previous.action === args.action &&
      previous.route === route &&
      previous.vehicleId === args.vehicleId &&
      previous.eventId === args.eventId &&
      (previous.fileIds ?? []).join(",") === fileIds.join(",")
    ) {
      return previous._id;
    }

    const id = await ctx.db.insert("activityEvents", {
      actorUserId,
      effectiveUserId,
      action: args.action,
      occurredAt: now,
      sessionKey: args.sessionKey,
      route,
      vehicleId: args.vehicleId,
      eventId: args.eventId,
      fileIds: fileIds.length > 0 ? fileIds : undefined,
      section: limited(args.section, 80),
      ipAddress: metadata.ip ?? undefined,
      userAgent: metadata.userAgent ?? undefined,
      requestId: metadata.requestId,
      timezone: limited(args.timezone, 80),
      locale: limited(args.locale, 40),
      viewport: limited(args.viewport, 40),
    });
    await pruneExpired(ctx, now);
    return id;
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 200), 250));
    const events = await ctx.db
      .query("activityEvents")
      .withIndex("by_time")
      .order("desc")
      .take(limit);

    return await Promise.all(
      events.map(async (activity) => {
        const [actor, effectiveUser, vehicle, event] = await Promise.all([
          ctx.db.get(activity.actorUserId),
          activity.effectiveUserId === activity.actorUserId
            ? ctx.db.get(activity.actorUserId)
            : ctx.db.get(activity.effectiveUserId),
          activity.vehicleId ? ctx.db.get(activity.vehicleId) : null,
          activity.eventId ? ctx.db.get(activity.eventId) : null,
        ]);
        const files = await Promise.all(
          (activity.fileIds ?? []).map((fileId) => ctx.db.get(fileId)),
        );
        return {
          ...activity,
          actorName: actor?.name,
          actorEmail: actor?.email,
          effectiveUserName: effectiveUser?.name,
          effectiveUserEmail: effectiveUser?.email,
          vehicleName: vehicle?.name,
          eventName: event?.name,
          fileNames: files.flatMap((file) => (file ? [file.fileName] : [])),
        };
      }),
    );
  },
});

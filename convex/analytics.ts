import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./authz";

const sourceValidator = v.union(v.literal("guest"), v.literal("account"));
type ViewerSource = "guest" | "account";

function browserVisitorKey(value: string): string {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(value)) {
    throw new Error("Invalid visitor id");
  }
  return `browser:${value}`;
}

function normalizeFingerprints(values: string[]): string[] {
  if (values.length > 50) throw new Error("Too many logs");
  const unique = [...new Set(values)];
  for (const value of unique) {
    if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
      throw new Error("Invalid log fingerprint");
    }
  }
  return unique;
}

async function addSessionLogs(
  ctx: MutationCtx,
  sessionId: Id<"viewerSessions">,
  source: ViewerSource,
  fingerprints: string[],
  now: number,
) {
  let newUniqueLogs = 0;
  let newLoads = 0;

  for (const fingerprint of fingerprints) {
    const existingLoad = await ctx.db
      .query("viewerLogLoads")
      .withIndex("by_session_log", (q) =>
        q.eq("sessionId", sessionId).eq("fingerprint", fingerprint),
      )
      .unique();
    if (existingLoad) continue;

    await ctx.db.insert("viewerLogLoads", {
      sessionId,
      fingerprint,
      loadedAt: now,
    });
    newLoads++;

    const existingLog = await ctx.db
      .query("viewerLogs")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
      .unique();
    if (existingLog) {
      await ctx.db.patch(existingLog._id, {
        lastSeenAt: now,
        sessionCount: existingLog.sessionCount + 1,
      });
    } else {
      await ctx.db.insert("viewerLogs", {
        fingerprint,
        firstSource: source,
        firstSeenAt: now,
        lastSeenAt: now,
        sessionCount: 1,
      });
      newUniqueLogs++;
    }
  }

  return { newUniqueLogs, newLoads };
}

async function updateMetrics(
  ctx: MutationCtx,
  changes: Partial<{
    uniqueVisitors: number;
    uniqueLogs: number;
    sessions: number;
    guestSessions: number;
    accountSessions: number;
    totalLogLoads: number;
    totalActiveMs: number;
  }>,
  now: number,
) {
  const current = await ctx.db
    .query("viewerMetrics")
    .withIndex("by_key", (q) => q.eq("key", "all"))
    .unique();
  const value = (key: keyof typeof changes) => changes[key] ?? 0;

  if (!current) {
    await ctx.db.insert("viewerMetrics", {
      key: "all",
      uniqueVisitors: value("uniqueVisitors"),
      uniqueLogs: value("uniqueLogs"),
      sessions: value("sessions"),
      guestSessions: value("guestSessions"),
      accountSessions: value("accountSessions"),
      totalLogLoads: value("totalLogLoads"),
      totalActiveMs: value("totalActiveMs"),
      updatedAt: now,
    });
    return;
  }

  await ctx.db.patch(current._id, {
    uniqueVisitors: current.uniqueVisitors + value("uniqueVisitors"),
    uniqueLogs: current.uniqueLogs + value("uniqueLogs"),
    sessions: current.sessions + value("sessions"),
    guestSessions: current.guestSessions + value("guestSessions"),
    accountSessions: current.accountSessions + value("accountSessions"),
    totalLogLoads: current.totalLogLoads + value("totalLogLoads"),
    totalActiveMs: current.totalActiveMs + value("totalActiveMs"),
    updatedAt: now,
  });
}

export const startSession = mutation({
  args: {
    browserVisitorId: v.string(),
    source: sourceValidator,
    logFingerprints: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const userId = await getAuthUserId(ctx);
    const source: ViewerSource =
      args.source === "account" && userId ? "account" : "guest";
    const visitorKey = userId
      ? `user:${userId}`
      : browserVisitorKey(args.browserVisitorId);
    const fingerprints = normalizeFingerprints(args.logFingerprints);

    const visitor = await ctx.db
      .query("viewerVisitors")
      .withIndex("by_visitor", (q) => q.eq("visitorKey", visitorKey))
      .unique();
    if (visitor) {
      await ctx.db.patch(visitor._id, {
        lastSeenAt: now,
        sessionCount: visitor.sessionCount + 1,
        ...(userId ? { userId } : {}),
      });
    } else {
      await ctx.db.insert("viewerVisitors", {
        visitorKey,
        ...(userId ? { userId } : {}),
        firstSeenAt: now,
        lastSeenAt: now,
        sessionCount: 1,
      });
    }

    const sessionId = await ctx.db.insert("viewerSessions", {
      visitorKey,
      ...(userId ? { userId } : {}),
      source,
      startedAt: now,
      lastSeenAt: now,
      activeMs: 0,
      uniqueLogsLoaded: 0,
    });
    const added = await addSessionLogs(
      ctx,
      sessionId,
      source,
      fingerprints,
      now,
    );
    if (added.newLoads > 0) {
      await ctx.db.patch(sessionId, { uniqueLogsLoaded: added.newLoads });
    }

    await updateMetrics(
      ctx,
      {
        uniqueVisitors: visitor ? 0 : 1,
        uniqueLogs: added.newUniqueLogs,
        sessions: 1,
        guestSessions: source === "guest" ? 1 : 0,
        accountSessions: source === "account" ? 1 : 0,
        totalLogLoads: added.newLoads,
      },
      now,
    );
    return sessionId;
  },
});

export const addLogs = mutation({
  args: {
    sessionId: v.id("viewerSessions"),
    logFingerprints: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Viewer session not found");
    const now = Date.now();
    const added = await addSessionLogs(
      ctx,
      args.sessionId,
      session.source,
      normalizeFingerprints(args.logFingerprints),
      now,
    );
    if (added.newLoads > 0) {
      await ctx.db.patch(args.sessionId, {
        lastSeenAt: now,
        uniqueLogsLoaded: session.uniqueLogsLoaded + added.newLoads,
      });
      await updateMetrics(
        ctx,
        {
          uniqueLogs: added.newUniqueLogs,
          totalLogLoads: added.newLoads,
        },
        now,
      );
    }
  },
});

export const heartbeat = mutation({
  args: {
    sessionId: v.id("viewerSessions"),
    activeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    const increment = Math.round(Math.max(0, Math.min(args.activeMs, 60_000)));
    if (increment === 0) return;
    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      activeMs: session.activeMs + increment,
      lastSeenAt: now,
    });
    await updateMetrics(ctx, { totalActiveMs: increment }, now);
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const since = now - 14 * 24 * 60 * 60 * 1000;
    const [metrics, recentSessions, recentLoads] = await Promise.all([
      ctx.db
        .query("viewerMetrics")
        .withIndex("by_key", (q) => q.eq("key", "all"))
        .unique(),
      ctx.db
        .query("viewerSessions")
        .withIndex("by_started", (q) => q.gte("startedAt", since))
        .collect(),
      ctx.db
        .query("viewerLogLoads")
        .withIndex("by_loaded", (q) => q.gte("loadedAt", since))
        .collect(),
    ]);

    const days = new Map<
      string,
      { sessions: number; visitors: Set<string>; logs: Set<string>; activeMs: number }
    >();
    for (let offset = 13; offset >= 0; offset--) {
      const date = new Date(now - offset * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      days.set(date, { sessions: 0, visitors: new Set(), logs: new Set(), activeMs: 0 });
    }
    for (const session of recentSessions) {
      const date = new Date(session.startedAt).toISOString().slice(0, 10);
      const day = days.get(date);
      if (!day) continue;
      day.sessions++;
      day.visitors.add(session.visitorKey);
      day.activeMs += session.activeMs;
    }
    for (const load of recentLoads) {
      const date = new Date(load.loadedAt).toISOString().slice(0, 10);
      days.get(date)?.logs.add(load.fingerprint);
    }

    const totals = metrics ?? {
      uniqueVisitors: 0,
      uniqueLogs: 0,
      sessions: 0,
      guestSessions: 0,
      accountSessions: 0,
      totalLogLoads: 0,
      totalActiveMs: 0,
    };
    return {
      uniqueVisitors: totals.uniqueVisitors,
      uniqueLogs: totals.uniqueLogs,
      sessions: totals.sessions,
      guestSessions: totals.guestSessions,
      accountSessions: totals.accountSessions,
      totalLogLoads: totals.totalLogLoads,
      totalActiveMs: totals.totalActiveMs,
      averageActiveMs:
        totals.sessions > 0 ? Math.round(totals.totalActiveMs / totals.sessions) : 0,
      daily: [...days].map(([date, day]) => ({
        date,
        sessions: day.sessions,
        uniqueVisitors: day.visitors.size,
        uniqueLogs: day.logs.size,
        activeMs: day.activeMs,
      })),
    };
  },
});

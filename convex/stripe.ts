import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireAdmin } from "./authz";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Subscriptions. Stripe holds the truth; the `subscriptions` table is a cache
 * the webhook keeps current so an ordinary query never has to call Stripe.
 *
 * Everything here runs server-side. STRIPE_SECRET_KEY never reaches the browser.
 * Swapping between test and live is one environment variable — nothing in this
 * file knows the difference.
 */

/** Days before the first charge. Set to 0 to bill immediately. */
const TRIAL_DAYS = 14;

/** Statuses that mean "let them in". */
const GOOD_STATUSES = new Set(["trialing", "active", "past_due"]);

function requireKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Run: npx convex env set STRIPE_SECRET_KEY sk_..."
    );
  }
  return key;
}

function requirePrice(): string {
  const price = process.env.STRIPE_PRICE_ID;
  if (!price) {
    throw new Error(
      "STRIPE_PRICE_ID is not set. Run: npx convex env set STRIPE_PRICE_ID price_..."
    );
  }
  return price;
}

/** Stripe's API is form-encoded, including nested keys like `a[b]`. */
function form(params: Record<string, string | number | boolean | undefined>) {
  const body = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) {
    if (val === undefined) continue;
    body.set(k, String(val));
  }
  return body;
}

async function stripeCall(
  path: string,
  params: Record<string, string | number | boolean | undefined>
) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form(params),
  });
  const json = await res.json();
  if (!res.ok) {
    const message = json?.error?.message ?? res.statusText;
    throw new Error(`Stripe ${path} failed: ${message}`);
  }
  return json;
}

/* ─────────────────────── reading status ─────────────────────── */

export type Access = {
  active: boolean;
  status: string | null;
  /** Seconds since epoch. */
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  comped: boolean;
  trialing: boolean;
};

/**
 * Does this account get in? Deliberately uses the real signed-in user rather
 * than the impersonation-aware id — an admin looking at a customer's data
 * should not consume or depend on that customer's billing state.
 */
export const access = query({
  args: {},
  handler: async (ctx): Promise<Access> => {
    const userId = await getAuthUserId(ctx);
    const empty: Access = {
      active: false,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      comped: false,
      trialing: false,
    };
    if (!userId) return empty;

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!sub) return empty;

    const now = Date.now();
    const comped = (sub.compedUntil ?? 0) > now;
    const status = sub.status ?? null;
    // past_due still gets in — Stripe retries for a while and locking someone
    // out mid-weekend over a declined card is the wrong call.
    const paid = status !== null && GOOD_STATUSES.has(status);

    return {
      active: comped || paid,
      status,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
      comped,
      trialing: status === "trialing",
    };
  },
});

/* ─────────────────────── internal plumbing ─────────────────────── */

export const getByUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique(),
});

export const getByCustomerInternal = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("subscriptions")
      .withIndex("by_customer", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId)
      )
      .unique(),
});

export const upsertInternal = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    status: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    const patch = {
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      status: args.status,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      updatedAt: Date.now(),
    };
    // A webhook can arrive with only part of the picture; never blank a field
    // we already know just because this event did not carry it.
    if (existing) {
      const merged: Record<string, unknown> = { updatedAt: patch.updatedAt };
      for (const [k, val] of Object.entries(patch)) {
        if (val !== undefined) merged[k] = val;
      }
      await ctx.db.patch(existing._id, merged);
      return existing._id;
    }
    return await ctx.db.insert("subscriptions", {
      userId: args.userId,
      ...patch,
    });
  },
});

/** Lets an account in without paying. Used for our own and for early testers. */
export const compInternal = internalMutation({
  args: { userId: v.id("users"), until: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        compedUntil: args.until,
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.insert("subscriptions", {
      userId: args.userId,
      compedUntil: args.until,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Lets an admin hand out access without a card — our own accounts, early
 * testers, or someone we owe a month to after an outage.
 */
export const comp = mutation({
  args: { userId: v.id("users"), days: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const until = Date.now() + args.days * 24 * 60 * 60 * 1000;
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { compedUntil: until, updatedAt: Date.now() });
      return;
    }
    await ctx.db.insert("subscriptions", {
      userId: args.userId,
      compedUntil: until,
      updatedAt: Date.now(),
    });
  },
});

export const userEmailInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return (user as { email?: string } | null)?.email ?? undefined;
  },
});

/* ─────────────────────── checkout + portal ─────────────────────── */

/**
 * Sends the racer to Stripe Checkout and hands back the URL to send them to.
 * Reuses their Stripe customer if they already have one, so a second attempt
 * does not create a duplicate.
 */
export const createCheckoutSession = action({
  args: { returnOrigin: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");

    const existing = await ctx.runQuery(internal.stripe.getByUserInternal, {
      userId,
    });

    let customerId = existing?.stripeCustomerId;
    if (!customerId) {
      const email = await ctx.runQuery(internal.stripe.userEmailInternal, {
        userId,
      });
      const customer = await stripeCall("customers", {
        // Convex turns an undefined return into null on the way back.
        email: email ?? undefined,
        "metadata[userId]": userId,
      });
      customerId = customer.id as string;
      await ctx.runMutation(internal.stripe.upsertInternal, {
        userId,
        stripeCustomerId: customerId,
      });
    }

    // Only offer a trial to someone who has never had a subscription.
    const trial = existing?.stripeSubscriptionId ? undefined : TRIAL_DAYS;

    const session = await stripeCall("checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]": requirePrice(),
      "line_items[0][quantity]": 1,
      success_url: `${args.returnOrigin}/?checkout=success`,
      cancel_url: `${args.returnOrigin}/?checkout=cancelled`,
      "subscription_data[trial_period_days]": trial && trial > 0 ? trial : undefined,
      "subscription_data[metadata][userId]": userId,
      "metadata[userId]": userId,
      allow_promotion_codes: true,
      client_reference_id: userId,
    });

    return { url: session.url as string };
  },
});

/** Stripe's own page for changing the card, cancelling, or getting receipts. */
export const createPortalSession = action({
  args: { returnOrigin: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");

    const sub = await ctx.runQuery(internal.stripe.getByUserInternal, { userId });
    if (!sub?.stripeCustomerId) throw new Error("No billing account yet");

    const session = await stripeCall("billing_portal/sessions", {
      customer: sub.stripeCustomerId,
      return_url: `${args.returnOrigin}/?billing=done`,
    });
    return { url: session.url as string };
  },
});

/**
 * Pulls the current state from Stripe on demand. The webhook normally keeps us
 * current; this is the belt-and-braces path for the moment right after checkout,
 * before the webhook has landed.
 */
export const syncFromStripe = action({
  args: {},
  handler: async (ctx): Promise<{ synced: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");

    const sub = await ctx.runQuery(internal.stripe.getByUserInternal, { userId });
    if (!sub?.stripeCustomerId) return { synced: false };

    const res = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${sub.stripeCustomerId}&status=all&limit=1`,
      { headers: { Authorization: `Bearer ${requireKey()}` } }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Stripe read failed");

    const s = json.data?.[0];
    if (!s) return { synced: false };

    await ctx.runMutation(internal.stripe.upsertInternal, {
      userId: userId as Id<"users">,
      stripeCustomerId: sub.stripeCustomerId,
      stripeSubscriptionId: s.id,
      status: s.status,
      // Current Stripe API versions put this on the item, not the subscription.
      currentPeriodEnd: s.items?.data?.[0]?.current_period_end ?? s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
    });
    return { synced: true };
  },
});

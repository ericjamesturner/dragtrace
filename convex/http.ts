import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

auth.addHttpRoutes(http);

/** Reject anything signed more than this long ago, so a captured body cannot be replayed. */
const TOLERANCE_SECONDS = 300;

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Current Stripe API versions carry the period end on the subscription *item*,
 * not on the subscription. Older ones put it at the top level, so read both.
 */
function periodEndOf(sub: {
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
}): number | undefined {
  return sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
}

/** Length-independent compare, so a mismatch does not leak where it failed. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies Stripe's signature over the *raw* body. The body must not be parsed
 * before this runs — re-serialising JSON changes the bytes and the signature
 * will never match.
 */
async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string
): Promise<boolean> {
  if (!header) return false;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  );
  const expected = hex(mac);
  return signatures.some((sig) => safeEqual(sig, expected));
}

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error("STRIPE_WEBHOOK_SECRET is not set");
      return new Response("not configured", { status: 500 });
    }

    const rawBody = await request.text();
    const ok = await verifyStripeSignature(
      rawBody,
      request.headers.get("stripe-signature"),
      secret
    );
    if (!ok) {
      // Never act on an unverified body — anyone can POST to this URL.
      return new Response("bad signature", { status: 400 });
    }

    const event = JSON.parse(rawBody);
    const object = event.data?.object ?? {};

    /** Prefer the id Stripe carries for us; fall back to the customer we stored. */
    const resolveUserId = async (): Promise<Id<"users"> | null> => {
      const fromMetadata =
        object.metadata?.userId ?? object.subscription_details?.metadata?.userId;
      if (fromMetadata) return fromMetadata as Id<"users">;

      const customerId =
        typeof object.customer === "string" ? object.customer : undefined;
      if (!customerId) return null;
      const row = await ctx.runQuery(internal.stripe.getByCustomerInternal, {
        stripeCustomerId: customerId,
      });
      return row?.userId ?? null;
    };

    switch (event.type) {
      case "checkout.session.completed": {
        const userId =
          (object.client_reference_id as Id<"users"> | undefined) ??
          (await resolveUserId());
        if (!userId) break;
        await ctx.runMutation(internal.stripe.upsertInternal, {
          userId,
          stripeCustomerId:
            typeof object.customer === "string" ? object.customer : undefined,
          stripeSubscriptionId:
            typeof object.subscription === "string" ? object.subscription : undefined,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const userId = await resolveUserId();
        if (!userId) break;
        await ctx.runMutation(internal.stripe.upsertInternal, {
          userId,
          stripeCustomerId:
            typeof object.customer === "string" ? object.customer : undefined,
          stripeSubscriptionId: object.id,
          status:
            event.type === "customer.subscription.deleted"
              ? "canceled"
              : object.status,
          currentPeriodEnd: periodEndOf(object),
          cancelAtPeriodEnd: object.cancel_at_period_end,
        });
        break;
      }

      default:
        // Everything else is acknowledged so Stripe stops retrying it.
        break;
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;

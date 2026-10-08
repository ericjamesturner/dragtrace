import Anthropic from "@anthropic-ai/sdk";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

const SYSTEM_PROMPT = `You explain ECU tune changes to a drag racer. You get the settings that differ between saved tunes from one car, in the order they were saved, already grouped and in the racer's units. Write what changed and what it does to the car on a pass — launch, 60-foot, shifts, top end, safety margins — in plain words a racer uses. Lead with the changes that matter most for performance or engine safety; group small related edits (several cylinder trims, one table nudged in many cells) into one point. Say what a change likely aims at only when the settings make it clear, and call out anything that looks risky (leaner mixture at high load, more timing, protection turned off). Never invent settings or numbers that are not in the list. Keep it short: a one-sentence overview, then at most 8 bullets. Plain text with "- " bullets; no headings, no markdown emphasis.`;

export const cached = internalQuery({
  args: { userId: v.id("users"), key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("tuneSummaries")
      .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
      .unique();
    return row?.text ?? null;
  },
});

export const store = internalMutation({
  args: { userId: v.id("users"), key: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("tuneSummaries", { ...args, createdAt: Date.now() });
  },
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A plain-language summary of what changed between tunes. The browser sends
 * only the computed differences — setting names and values — never the tune.
 */
export const summarize = action({
  args: {
    car: v.string(),
    steps: v.array(
      v.object({
        from: v.string(),
        to: v.string(),
        changes: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<string> => {
    // Billed against our Anthropic key, so it must never be callable anonymously.
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const body = args.steps
      .map((s, i) => `Step ${i + 1}: "${s.from}" -> "${s.to}"\n${s.changes || "(no setting changes)"}`)
      .join("\n\n");
    // A diff of every setting in a tune is the worst case; it stays well
    // inside the context window, so nothing is cut.
    if (body.length > 400_000) throw new Error("Too many changes to summarise at once. Compare fewer files.");

    // The same comparison opened again reads the summary it already has.
    const userContent = `Car: ${args.car}\n\n${body}`;
    const key = await sha256(`${SYSTEM_PROMPT}\u0000${userContent}`);
    const hit = await ctx.runQuery(internal.tuneSummary.cached, { userId, key });
    if (hit) return hit;

    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "medium" },
      // A safety classifier can decline a request; retry it server-side on
      // the model Anthropic recommends for that category instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("The summary could not be written for these changes.");
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new Error("The summary came back empty. Try again.");
    await ctx.runMutation(internal.tuneSummary.store, { userId, key, text });
    return text;
  },
});

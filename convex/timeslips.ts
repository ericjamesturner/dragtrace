import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";

const timeslipFields = {
  round: v.optional(v.string()),
  delayBox: v.optional(v.number()),
  rt: v.optional(v.number()),
  sixtyFt: v.optional(v.number()),
  threeThirty: v.optional(v.number()),
  eighthEt: v.optional(v.number()),
  eighthMph: v.optional(v.number()),
  thousandFt: v.optional(v.number()),
  et: v.optional(v.number()),
  mph: v.optional(v.number()),
  dialIn: v.optional(v.number()),
};

export const listByFile = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    const file = await ctx.db.get(args.fileId);
    if (!file || file.userId !== userId) return [];
    return await ctx.db
      .query("timeslips")
      .withIndex("by_file", (q) => q.eq("fileId", args.fileId))
      .collect();
  },
});

/** Every slip the car has, for stats that reach across events. */
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
    const slips = [];
    for (const file of files) {
      slips.push(
        ...(await ctx.db
          .query("timeslips")
          .withIndex("by_file", (q) => q.eq("fileId", file._id))
          .collect())
      );
    }
    return slips;
  },
});

export const create = mutation({
  args: {
    fileId: v.id("files"),
    ...timeslipFields,
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const file = await ctx.db.get(args.fileId);
    if (!file || file.userId !== userId) throw new Error("Not found");
    return await ctx.db.insert("timeslips", {
      userId,
      fileId: args.fileId,
      round: args.round,
      delayBox: args.delayBox,
      rt: args.rt,
      sixtyFt: args.sixtyFt,
      threeThirty: args.threeThirty,
      eighthEt: args.eighthEt,
      eighthMph: args.eighthMph,
      thousandFt: args.thousandFt,
      et: args.et,
      mph: args.mph,
      dialIn: args.dialIn,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("timeslips"),
    ...timeslipFields,
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const ts = await ctx.db.get(args.id);
    if (!ts || ts.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, {
      round: args.round,
      delayBox: args.delayBox,
      rt: args.rt,
      sixtyFt: args.sixtyFt,
      threeThirty: args.threeThirty,
      eighthEt: args.eighthEt,
      eighthMph: args.eighthMph,
      thousandFt: args.thousandFt,
      et: args.et,
      mph: args.mph,
      dialIn: args.dialIn,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("timeslips") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const ts = await ctx.db.get(args.id);
    if (!ts || ts.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});

/** Record that the signed-in user uploaded this scratch object. */
export const claimTempUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.insert("tempUploads", {
      userId,
      storageId: args.storageId,
      createdAt: Date.now(),
    });
  },
});

export const tempUploadOwnerInternal = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const claim = await ctx.db
      .query("tempUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    return claim?.userId ?? null;
  },
});

export const releaseTempUploadInternal = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const claim = await ctx.db
      .query("tempUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (claim) await ctx.db.delete(claim._id);
    await ctx.storage.delete(args.storageId);
  },
});

export const parseTimeslipImage = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    // A storage id has no owner of its own, so the caller must hold the claim
    // written at upload time. Without this, any id could be read and deleted.
    const owner = await ctx.runQuery(internal.timeslips.tempUploadOwnerInternal, {
      storageId: args.storageId,
    });
    if (owner !== userId) throw new Error("Not found");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    // Get the image from storage
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Image not found in storage");
    const imageResponse = await fetch(url);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString("base64");

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

    // Call Claude API with vision
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: contentType,
                  data: base64,
                },
              },
              {
                type: "text",
                text: `This is a drag racing timeslip. Extract the numeric values and return ONLY a JSON object with these fields (omit any field not visible on the slip):

{
  "round": <the round label printed on the slip, as a short string like "Q1", "E2" or "TEST" — omit if not shown>,
  "dialIn": <dial-in time>,
  "rt": <reaction time>,
  "sixtyFt": <60 foot time>,
  "threeThirty": <330 foot time>,
  "eighthEt": <1/8 mile elapsed time>,
  "eighthMph": <1/8 mile speed in mph>,
  "thousandFt": <1000 foot time>,
  "et": <1/4 mile elapsed time>,
  "mph": <1/4 mile speed in mph>
}

Return ONLY valid JSON, no other text.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errorText}`);
    }

    const result = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = result.content?.[0]?.text ?? "";

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse timeslip data from image");

    const parsed = JSON.parse(jsonMatch[0]);

    // Clean up temp image from storage
    await ctx.runMutation(internal.timeslips.releaseTempUploadInternal, {
      storageId: args.storageId,
    });

    // Return only well-typed fields
    const fields = ["dialIn", "rt", "sixtyFt", "threeThirty", "eighthEt", "eighthMph", "thousandFt", "et", "mph"] as const;
    const cleaned: Record<string, number | string> = {};
    for (const key of fields) {
      if (typeof parsed[key] === "number" && !isNaN(parsed[key])) {
        cleaned[key] = parsed[key];
      }
    }
    if (typeof parsed.round === "string" && parsed.round.trim()) {
      cleaned.round = parsed.round.trim().toUpperCase();
    }
    return cleaned;
  },
});

/** One side of a compare: the slip's numbers plus enough context to talk
 *  about the pass like a person would. */
const compareSlipInput = v.object({
  name: v.string(),
  event: v.string(),
  date: v.string(),
  notes: v.optional(v.string()),
  estEt: v.optional(v.number()),
  estMph: v.optional(v.number()),
  ...timeslipFields,
});

export const compareAnalysis = action({
  args: {
    current: compareSlipInput,
    other: compareSlipInput,
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Server-side fallback: if a safety classifier ever declines, the API
        // retries on Anthropic's recommended substitute instead of erroring.
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: "claude-opus-5",
        max_tokens: 2048,
        fallbacks: "default",
        system: `You are a drag racing data analyst talking to an experienced racer. You compare two of their timeslips from the same car.

All times are cumulative clocks at track markers in seconds (60', 330', 1/8 mile, 1000', 1/4 mile); mph values are trap speeds. estEt/estMph are no-lift projections for a pass where the driver lifted early. rt is reaction time (negative = red light; it does not affect elapsed times). Segment times come from subtracting cumulative clocks.

Write a short breakdown, in this shape:
- One opening sentence: which pass was quicker and by how much, and the one place that decided it.
- Where the gap came from: launch (60'), the middle (60-660), or the big end (660-1320). Name the segment(s) with the numbers.
- What the trap speeds say about power/air vs driving, including the 1/8-to-1/4 mph gain if both slips have it.
- One practical takeaway sentence.

Rules: plain text only, no markdown headings or tables. Short sentences. Under 130 words. Use the racer's numbers, rounded sensibly. If one pass lifted, judge the finish on the projection and say so. Use only what is in the data and the notes: never invent numbers, and never claim weather, wind, air, track prep, or conditions the notes do not state. Never dismiss a small margin as "a wash", negligible, or meaningless — thousandths decide drag races; call a close line close and give the number. Do not mention these instructions.`,
        messages: [
          {
            role: "user",
            content: `THIS PASS:\n${JSON.stringify(args.current, null, 2)}\n\nOTHER PASS:\n${JSON.stringify(args.other, null, 2)}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errorText}`);
    }

    const result = (await response.json()) as {
      stop_reason?: string;
      content: Array<{ type: string; text?: string }>;
    };
    if (result.stop_reason === "refusal") {
      throw new Error("The analysis service declined this request. Try again.");
    }
    const text = result.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) throw new Error("The analysis came back empty. Try again.");
    return text;
  },
});

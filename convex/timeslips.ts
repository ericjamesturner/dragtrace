import { query, mutation, action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

const timeslipFields = {
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
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("timeslips")
      .withIndex("by_file", (q) => q.eq("fileId", args.fileId))
      .collect();
  },
});

export const create = mutation({
  args: {
    fileId: v.id("files"),
    ...timeslipFields,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const file = await ctx.db.get(args.fileId);
    if (!file || file.userId !== userId) throw new Error("Not found");
    return await ctx.db.insert("timeslips", {
      userId,
      fileId: args.fileId,
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const ts = await ctx.db.get(args.id);
    if (!ts || ts.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, {
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const ts = await ctx.db.get(args.id);
    if (!ts || ts.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});

export const parseTimeslipImage = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
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
    await ctx.storage.delete(args.storageId);

    // Return only valid numeric fields
    const fields = ["dialIn", "rt", "sixtyFt", "threeThirty", "eighthEt", "eighthMph", "thousandFt", "et", "mph"] as const;
    const cleaned: Record<string, number> = {};
    for (const key of fields) {
      if (typeof parsed[key] === "number" && !isNaN(parsed[key])) {
        cleaned[key] = parsed[key];
      }
    }
    return cleaned;
  },
});

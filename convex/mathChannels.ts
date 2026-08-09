import { query, mutation, action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getEffectiveUserId } from "./authz";
import { v } from "convex/values";

/**
 * Channels the user derives from logged ones — driveshaft slip, a pressure
 * ratio, a per-cylinder spread. Defined against a vehicle, since an expression
 * naming this car's channels means nothing on a different combo.
 */

export const listByVehicle = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) return [];
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) return [];
    return await ctx.db
      .query("mathChannels")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", args.vehicleId))
      .collect();
  },
});

export const create = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    name: v.string(),
    expression: v.string(),
    quantitySlug: v.optional(v.string()),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");
    return await ctx.db.insert("mathChannels", { ...args, createdAt: Date.now() });
  },
});

export const update = mutation({
  args: {
    id: v.id("mathChannels"),
    name: v.optional(v.string()),
    expression: v.optional(v.string()),
    quantitySlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Not found");
    const vehicle = await ctx.db.get(existing.vehicleId);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.expression !== undefined ? { expression: args.expression } : {}),
      ...(args.quantitySlug !== undefined ? { quantitySlug: args.quantitySlug } : {}),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("mathChannels") },
  handler: async (ctx, args) => {
    const userId = await getEffectiveUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Not found");
    const vehicle = await ctx.db.get(existing.vehicleId);
    if (!vehicle || vehicle.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});

const SYSTEM_PROMPT = `You write expressions for derived datalog channels in an automotive log viewer.

Reference logged channels with {Exact Channel Name} — copy names verbatim from the list you're given, including capitalisation. Available operators: + - * / % ( ) and the ternary ?:. Available functions: abs(), sqrt(), pow(), min(), max(), log(), log10(), floor(), ceil(), round(), and the constants PI and E. derivative({Channel Name}) gives rate of change per second.

The expression is evaluated once per sample and must produce a NUMBER, not a boolean — this creates a new channel that gets plotted, not a condition.

Guard division by zero with a ternary so the channel doesn't blow up at idle or before launch: {A} > 0 ? {B} / {A} : 0

Give it a short name a racer would recognise, in title case, naming what it measures and its unit if that helps ("Driveshaft Slip %", "Boost per 1000 RPM").

Set quantitySlug only when the result genuinely carries that quantity — "percentage" for a percentage, "pressure" for a pressure, "engine-speed" for RPM, "temperature", "afr", "speed". Leave it out for ratios and anything unitless; a wrong one makes the number display in the wrong units.`;

export const generate = action({
  args: {
    description: v.string(),
    channelNames: v.array(v.string()),
    unitPrefs: v.string(),
  },
  returns: v.object({
    name: v.string(),
    expression: v.string(),
    quantitySlug: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Billed against our Anthropic key, so it must never be callable anonymously.
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
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              `Available channels:\n${args.channelNames.join("\n")}\n\n` +
              `Display units:\n${args.unitPrefs}\n\n` +
              `Create a math channel for: ${args.description}`,
          },
        ],
        tools: [
          {
            name: "create_math_channel",
            description: "Define a derived channel computed from logged channels",
            input_schema: {
              type: "object" as const,
              properties: {
                name: { type: "string", description: "Short title-case name for the channel" },
                expression: {
                  type: "string",
                  description:
                    "Numeric expression using {Exact Channel Name} references, evaluated per sample",
                },
                quantitySlug: {
                  type: "string",
                  description:
                    "Quantity for display units, or omit when unitless (ratios, counts)",
                },
              },
              required: ["name", "expression"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "create_math_channel" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const toolBlock = data.content?.find((b: { type: string }) => b.type === "tool_use");
    if (!toolBlock?.input) throw new Error("No tool response from API");

    const result = toolBlock.input as {
      name: string;
      expression: string;
      quantitySlug?: string;
    };
    return {
      name: result.name,
      expression: result.expression,
      ...(result.quantitySlug ? { quantitySlug: result.quantitySlug } : {}),
    };
  },
});

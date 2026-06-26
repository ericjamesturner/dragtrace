import { action } from "./_generated/server";
import { v } from "convex/values";

const SYSTEM_PROMPT = `You are an expert automotive tuner analyzing ECU datalog channels. Given the available channels and their units, suggest the most useful XY scatter plot combinations for diagnosing tuning issues, analyzing performance, and understanding engine behavior. Focus on combinations that reveal meaningful correlations. CRITICAL: Use ONLY the exact channel name string in quotes — do NOT include units, brackets, or any other text. For example if the channel is listed as "RPM" [unit: RPM], use "RPM" not "RPM (RPM)". For the optional color channel, pick a 3rd variable that adds diagnostic value (e.g. coloring an RPM vs MAP scatter by AFR shows rich/lean areas of the fuel map). Suggest 4-8 scatter plots ordered by usefulness.`;

// Server-side AI scatter-suggestion generation. Keeps the Anthropic key on the
// backend (process.env.ANTHROPIC_API_KEY) instead of shipping it to the browser.
// Mirrors the shape of convex/highlightZones.ts.
export const generate = action({
  args: {
    channelList: v.string(),
  },
  returns: v.array(
    v.object({
      xChannel: v.string(),
      yChannel: v.string(),
      colorChannel: v.optional(v.string()),
      label: v.string(),
      description: v.string(),
    }),
  ),
  handler: async (_ctx, args) => {
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
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              `Available datalog channels:\n${args.channelList}\n\n` +
              `Suggest the most useful XY scatter plots for analyzing this data.`,
          },
        ],
        tools: [
          {
            name: "suggest_scatter_plots",
            description:
              "Suggest useful XY scatter plot combinations from the available channels",
            input_schema: {
              type: "object" as const,
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      xChannel: {
                        type: "string",
                        description: "Exact channel name for X axis",
                      },
                      yChannel: {
                        type: "string",
                        description: "Exact channel name for Y axis",
                      },
                      colorChannel: {
                        type: "string",
                        description:
                          "Optional exact channel name for color-coding. Omit or empty if not needed.",
                      },
                      label: {
                        type: "string",
                        description:
                          'Short label, e.g. "Fuel Map (RPM vs MAP)"',
                      },
                      description: {
                        type: "string",
                        description: "One sentence on what this scatter reveals",
                      },
                    },
                    required: ["xChannel", "yChannel", "label", "description"],
                  },
                },
              },
              required: ["suggestions"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "suggest_scatter_plots" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const block = data.content?.find(
      (b: { type: string }) => b.type === "tool_use",
    );
    const raw = block?.input?.suggestions;
    if (!Array.isArray(raw)) return [];

    // Normalize to the exact `returns` shape — Claude can emit extra/typed-wrong
    // fields, and the Convex returns validator is strict.
    return raw
      .map((s: Record<string, unknown>) => ({
        xChannel: String(s.xChannel ?? ""),
        yChannel: String(s.yChannel ?? ""),
        colorChannel: s.colorChannel ? String(s.colorChannel) : undefined,
        label: String(s.label ?? ""),
        description: String(s.description ?? ""),
      }))
      .filter(
        (s: { xChannel: string; yChannel: string }) =>
          s.xChannel && s.yChannel,
      );
  },
});

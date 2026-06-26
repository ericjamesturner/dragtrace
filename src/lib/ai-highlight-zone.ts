import type { UnitSystem, UnitOverrides } from "./units";
import { UNIT_OPTIONS, getDisplayUnit, convertForDisplay } from "./units";

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string;

interface GeneratedZone {
  expression: string;
  label: string;
  color: string;
}

function buildUnitPreferences(unitSystem: UnitSystem, unitOverrides?: UnitOverrides): string {
  const lines: string[] = [`Unit system: ${unitSystem}`];
  for (const baseUnit of Object.keys(UNIT_OPTIONS)) {
    const display = getDisplayUnit(baseUnit, unitSystem, unitOverrides);
    lines.push(`  ${baseUnit} → displayed as ${display}`);
  }
  return lines.join("\n");
}

const ZONE_COLORS = [
  "#22c55e", "#3b82f6", "#ef4444", "#f59e0b",
  "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
];

export { ZONE_COLORS };

export interface ChannelSample {
  name: string;
  data: Float64Array;
  timestamps: Float64Array;
  metricUnit: string;
}

function buildSampleData(
  samples: ChannelSample[],
  zoomRange: [number, number] | null,
  unitSystem: UnitSystem,
  unitOverrides?: UnitOverrides,
): string {
  if (samples.length === 0) return "";

  const lines: string[] = [
    "Sample data from the visible range (in display units, ~20 evenly-spaced points):",
  ];

  for (const s of samples) {
    const ts = s.timestamps;
    const tMin = zoomRange ? zoomRange[0] : ts[0];
    const tMax = zoomRange ? zoomRange[1] : ts[ts.length - 1];

    let iStart = 0,
      iEnd = s.data.length;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] >= tMin) {
        iStart = i;
        break;
      }
    }
    for (let i = ts.length - 1; i >= 0; i--) {
      if (ts[i] <= tMax) {
        iEnd = i + 1;
        break;
      }
    }
    if (iEnd <= iStart) continue;

    const displayUnit = getDisplayUnit(s.metricUnit, unitSystem, unitOverrides);

    const count = Math.min(20, iEnd - iStart);
    const step = Math.max(1, Math.floor((iEnd - iStart) / count));
    const vals: string[] = [];
    let min = Infinity,
      max = -Infinity;
    for (let i = iStart; i < iEnd; i += step) {
      const raw = s.data[i];
      if (raw !== raw) continue;
      const v = convertForDisplay(raw, s.metricUnit, unitSystem, unitOverrides);
      if (v < min) min = v;
      if (v > max) max = v;
      vals.push(v.toFixed(2));
    }
    if (vals.length === 0) continue;
    const unitLabel = displayUnit ? ` ${displayUnit}` : "";
    lines.push(
      `  ${s.name}: [${vals.join(", ")}]${unitLabel} (range: ${min.toFixed(2)} to ${max.toFixed(2)}${unitLabel})`,
    );
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

export async function generateHighlightZone(
  description: string,
  channelNames: string[],
  unitSystem: UnitSystem,
  unitOverrides?: UnitOverrides,
  channelSamples?: ChannelSample[],
  zoomRange?: [number, number] | null,
): Promise<GeneratedZone> {
  if (!API_KEY || API_KEY === "your-key-here") {
    throw new Error("Anthropic API key not configured");
  }

  const unitPrefs = buildUnitPreferences(unitSystem, unitOverrides);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You create highlight zone expressions for an automotive datalog viewer. Highlight zones shade regions of a chart where a boolean condition is true. Channels are referenced using {Exact Channel Name} syntax. Available operators: >, <, >=, <=, ==, !=, &&, ||, !. Available math functions: abs(), sqrt(), pow(), min(), max(), log(), log10(), floor(), ceil(), round(), PI, E. You can also use derivative({Channel Name}) to get the rate of change of a channel. IMPORTANT: Channel values in expressions use the user's selected display units (see their unit preferences below), NOT raw metric SI. For example, if the user displays pressure in PSI, write thresholds in PSI. Your expression must evaluate to a truthy/falsy value — it defines WHEN the zone is active. Pick a color that semantically matches: green for good/safe conditions, red for danger/limits, blue for informational, yellow/orange for warnings. The label should be short (2-4 words).`,
      messages: [
        {
          role: "user",
          content: `Available channels:\n${channelNames.join("\n")}\n\nUser's current display preferences:\n${unitPrefs}\n\n${channelSamples ? buildSampleData(channelSamples, zoomRange ?? null, unitSystem, unitOverrides) + "\n\n" : ""}Create a highlight zone for: ${description}`,
        },
      ],
      tools: [
        {
          name: "create_highlight_zone",
          description:
            "Create a highlight zone that shades chart regions where a condition is true",
          input_schema: {
            type: "object" as const,
            properties: {
              expression: {
                type: "string",
                description:
                  "Boolean expression using {Exact Channel Name} references. Must evaluate to truthy/falsy. Use exact channel names from the available list. Values are in the user's display units (see their preferences).",
              },
              label: {
                type: "string",
                description:
                  'Short descriptive label for the zone (2-4 words, e.g. "Full Throttle", "Over Boost", "Lean Condition")',
              },
              color: {
                type: "string",
                enum: ZONE_COLORS,
                description:
                  "Color for the zone. Green=#22c55e (good/safe), Blue=#3b82f6 (info), Red=#ef4444 (danger), Yellow=#f59e0b (warning), Purple=#8b5cf6, Pink=#ec4899, Cyan=#06b6d4, Orange=#f97316",
              },
            },
            required: ["expression", "label", "color"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "create_highlight_zone" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error: ${response.status} ${err}`);
  }

  const data = await response.json();

  const toolBlock = data.content?.find(
    (block: { type: string }) => block.type === "tool_use",
  );
  if (!toolBlock?.input) {
    throw new Error("No tool response from API");
  }

  const result = toolBlock.input as GeneratedZone;

  return {
    expression: result.expression,
    label: result.label,
    color: result.color || ZONE_COLORS[0],
  };
}

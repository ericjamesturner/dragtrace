import type { UnitSystem, UnitOverrides } from "./units";
import { UNIT_OPTIONS, getDisplayUnit, convertForDisplay } from "./units";

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
  "#eab308", "#14b8a6", "#a3e635", "#d946ef",
  "#f43f5e", "#38bdf8", "#fb923c", "#ffffff",
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

// Serializable payload for the `highlightZones.generate` Convex action. The
// prompt is built client-side (it needs the in-memory Float64Array samples and
// unit helpers); the action attaches the Anthropic key and makes the API call.
export interface HighlightZoneInput {
  description: string;
  channelNames: string[];
  unitPrefs: string;
  sampleData: string;
}

export function buildHighlightZoneInput(
  description: string,
  channelNames: string[],
  unitSystem: UnitSystem,
  unitOverrides?: UnitOverrides,
  channelSamples?: ChannelSample[],
  zoomRange?: [number, number] | null,
): HighlightZoneInput {
  return {
    description,
    channelNames,
    unitPrefs: buildUnitPreferences(unitSystem, unitOverrides),
    sampleData: channelSamples
      ? buildSampleData(channelSamples, zoomRange ?? null, unitSystem, unitOverrides)
      : "",
  };
}

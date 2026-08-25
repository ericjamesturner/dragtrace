import type { ChannelDef } from "./log-types";
import { inferPassWindow } from "./pass-window";
import type { LoadedLog } from "./viewer-types";

const WIDTH = 1200;
const HEIGHT = 630;

interface ShareSeries {
  label: string;
  channelName: string;
  color: string;
  values: Float64Array;
}

export interface SharedLogPreviewChannel {
  label: string;
  channelName: string;
}

interface TargetChannel {
  label: string;
  color: string;
  preferred: RegExp;
  fallback?: RegExp;
  quantitySlug?: string;
}

const TARGET_CHANNELS: TargetChannel[] = [
  {
    label: "RPM",
    color: "#ef4444",
    preferred: /^(?:rpm|engine speed)$/i,
    fallback: /(?:^|\b)(?:rpm|engine speed)(?:\b|$)/i,
    quantitySlug: "engine-speed",
  },
  {
    label: "TPS",
    color: "#22c55e",
    preferred: /^(?:tps|throttle position)$/i,
    fallback: /(?:\btps\b|throttle position)/i,
  },
  {
    label: "MAP",
    color: "#3b82f6",
    preferred: /^(?:map|manifold pressure|measured manifold pressure)$/i,
    fallback: /(?:\bmap\b|manifold.*pressure|boost pressure)/i,
  },
  {
    label: "Wideband",
    color: "#f59e0b",
    preferred: /^(?:wideband o2 overall|wideband o2 1|afr average|lambda)$/i,
    fallback: /(?:wideband|\bafr\b|lambda|air.?fuel)/i,
    quantitySlug: "afr",
  },
];

function findChannel(
  definitions: ChannelDef[],
  target: TargetChannel,
  used: Set<string>,
): ChannelDef | undefined {
  const available = definitions.filter(
    (definition) =>
      !definition.computed &&
      !used.has(definition.name) &&
      !/derivative|target|error|limit|filtered|unfiltered|diagnostic/i.test(
        definition.name,
      ),
  );
  return (
    available.find((definition) => target.preferred.test(definition.name)) ??
    available.find(
      (definition) => target.fallback?.test(definition.name) ?? false,
    ) ??
    available.find(
      (definition) =>
        target.quantitySlug !== undefined &&
        definition.quantitySlug === target.quantitySlug,
    )
  );
}

function finiteRange(values: Float64Array): [number, number] | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
}

function formatRange([min, max]: [number, number]): string {
  const scale = Math.max(Math.abs(min), Math.abs(max));
  const digits = scale >= 100 ? 0 : scale >= 10 ? 1 : 2;
  return `${min.toFixed(digits)} – ${max.toFixed(digits)}`;
}

function ellipsize(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  if (context.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text.length > 1 && context.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text}…`;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create the share preview image."));
    }, "image/png");
  });
}

/** The channels that will appear on the generated social card, in order. */
export function getSharedLogPreviewChannels(
  log: LoadedLog,
): SharedLogPreviewChannel[] {
  const session = log.parsed.sessions[log.activeSessionIndex];
  if (!session) return [];
  const used = new Set<string>();
  return TARGET_CHANNELS.flatMap((target) => {
    const definition = findChannel(log.parsed.channelDefs, target, used);
    const values = definition
      ? session.channels.get(definition.name)
      : undefined;
    if (!definition || !values || !finiteRange(values)) return [];
    used.add(definition.name);
    return [{ label: target.label, channelName: definition.name }];
  });
}

/** Build a 1200×630 social card entirely from the locally parsed log. */
export async function createSharedLogImage(log: LoadedLog): Promise<Blob> {
  const session = log.parsed.sessions[log.activeSessionIndex];
  if (!session) throw new Error("This log does not have a viewable session.");

  const lastSampleIndex = session.timestamps.length - 1;
  const fullRange: [number, number] = [
    session.timestamps[0] ?? 0,
    session.timestamps[lastSampleIndex] ?? 0,
  ];
  const passWindow = inferPassWindow(
    [log],
    new Map([[log.fileId, 0]]),
    fullRange,
  );
  let firstSampleIndex = 0;
  let finalSampleIndex = lastSampleIndex;
  if (passWindow) {
    while (
      firstSampleIndex < lastSampleIndex &&
      session.timestamps[firstSampleIndex] < passWindow[0]
    ) {
      firstSampleIndex++;
    }
    while (
      finalSampleIndex > firstSampleIndex &&
      session.timestamps[finalSampleIndex] > passWindow[1]
    ) {
      finalSampleIndex--;
    }
  }
  const visibleSampleCount = Math.max(
    0,
    finalSampleIndex - firstSampleIndex + 1,
  );
  const visibleStart = session.timestamps[firstSampleIndex] ?? fullRange[0];
  const visibleEnd = session.timestamps[finalSampleIndex] ?? fullRange[1];
  const visibleDuration = Math.max(0, visibleEnd - visibleStart);

  const selectedChannels = getSharedLogPreviewChannels(log);
  const series: ShareSeries[] = selectedChannels.map((selected) => ({
    ...selected,
    color:
      TARGET_CHANNELS.find((target) => target.label === selected.label)?.color ??
      "#e2e8f0",
    values: session.channels.get(selected.channelName)!,
  }));

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a share preview.");

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#0b0d10");
  background.addColorStop(1, "#15191f");
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = "#ef4444";
  context.fillRect(0, 0, 12, HEIGHT);
  context.font = "700 27px Geist, system-ui, sans-serif";
  context.fillStyle = "#f8fafc";
  context.fillText("DRAGTRACE", 70, 68);
  context.font = "500 18px Geist, system-ui, sans-serif";
  context.fillStyle = "#94a3b8";
  context.fillText("SHARED DATALOG", 70, 100);

  context.font = "700 42px Geist, system-ui, sans-serif";
  context.fillStyle = "#ffffff";
  context.fillText(ellipsize(context, log.fileName, 1040), 70, 158);

  const chartX = 70;
  const chartY = 198;
  const chartWidth = 1060;
  const chartHeight = 340;
  context.fillStyle = "rgba(255,255,255,0.025)";
  context.fillRect(chartX, chartY, chartWidth, chartHeight);
  context.strokeStyle = "rgba(148,163,184,0.14)";
  context.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const x = chartX + (chartWidth * i) / 8;
    context.beginPath();
    context.moveTo(x, chartY);
    context.lineTo(x, chartY + chartHeight);
    context.stroke();
  }

  if (series.length === 0) {
    context.font = "600 28px Geist, system-ui, sans-serif";
    context.fillStyle = "#cbd5e1";
    context.fillText("Open the interactive log to explore its channels", 110, 385);
  } else {
    const bandHeight = chartHeight / series.length;
    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const item = series[seriesIndex];
      const visibleValues = item.values.subarray(
        firstSampleIndex,
        finalSampleIndex + 1,
      );
      const range = finiteRange(visibleValues);
      if (!range) continue;
      const [min, max] = range;
      const span = max - min || 1;
      const top = chartY + seriesIndex * bandHeight;
      if (seriesIndex > 0) {
        context.strokeStyle = "rgba(148,163,184,0.12)";
        context.beginPath();
        context.moveTo(chartX, top);
        context.lineTo(chartX + chartWidth, top);
        context.stroke();
      }

      context.font = "700 18px Geist, system-ui, sans-serif";
      context.fillStyle = item.color;
      context.fillText(item.label, chartX + 16, top + 27);
      context.font = "500 14px Geist, system-ui, sans-serif";
      context.fillStyle = "#94a3b8";
      context.fillText(formatRange(range), chartX + 16, top + 49);

      const plotLeft = chartX + 150;
      const plotRight = chartX + chartWidth - 16;
      const plotTop = top + 10;
      const plotBottom = top + bandHeight - 10;
      const pointCount = Math.min(visibleSampleCount, 760);
      const step = Math.max(1, Math.ceil(visibleSampleCount / pointCount));
      let drawing = false;
      context.strokeStyle = item.color;
      context.lineWidth = 2.5;
      context.lineJoin = "round";
      context.beginPath();
      for (
        let index = firstSampleIndex;
        index <= finalSampleIndex;
        index += step
      ) {
        const value = item.values[index];
        if (!Number.isFinite(value)) {
          drawing = false;
          continue;
        }
        const x =
          plotLeft +
          ((plotRight - plotLeft) *
            ((session.timestamps[index] ?? visibleStart) - visibleStart)) /
            Math.max(Number.EPSILON, visibleDuration);
        const y = plotBottom - ((plotBottom - plotTop) * (value - min)) / span;
        if (drawing) context.lineTo(x, y);
        else {
          context.moveTo(x, y);
          drawing = true;
        }
      }
      context.stroke();
    }
  }

  context.font = "500 16px Geist, system-ui, sans-serif";
  context.fillStyle = "#94a3b8";
  context.fillText(
    `${log.parsed.format}  ·  ${visibleSampleCount.toLocaleString()} samples  ·  ${visibleDuration.toFixed(2)} seconds`,
    70,
    585,
  );
  context.textAlign = "right";
  context.fillStyle = "#e2e8f0";
  context.fillText("dragtrace.com", 1130, 585);

  return canvasBlob(canvas);
}

"use node";

import { deflateSync } from "node:zlib";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { parsePreview, raceSeries, type PreviewPayload } from "../src/lib/preview";
import { healthLines } from "../src/lib/health-text";
import type { PassChecks } from "../src/lib/anomalies";
import type { UnitOverrides } from "../src/lib/units";

/** The ntfy.sh topic that hears about new uploads. Anyone who knows the name can subscribe. */
const NTFY_TOPIC = "dragtrace-alerts";
const IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

const WIDTH = 800;
const HEIGHT = 300;
const PAD = 14;
const BACKGROUND: Rgb = [10, 10, 10];
const SECOND_RULE: Rgb = [38, 38, 38];
// Tailwind 400s, the same colours as the run sheet's trace popover.
const RPM_COLOR: Rgb = [248, 113, 113];
const TPS_COLOR: Rgb = [74, 222, 128];
const DS_COLOR: Rgb = [96, 165, 250];

type Rgb = [number, number, number];

/** Sends one new-log alert, with a picture of the pass when there is a preview. Never throws. */
export const sendLogAlert = internalAction({
  args: { fileId: v.id("files"), withImage: v.boolean() },
  handler: async (ctx, args) => {
    const info = await ctx.runQuery(internal.notify.alertInfo, { fileId: args.fileId });
    if (!info) return;
    // The Health check, so the phone says whether the pass needs a look.
    let health: string[] | null = null;
    try {
      const pass = checksOf(parsePreview(info.preview));
      if (pass) {
        const refs = info.refPreviews.flatMap((raw) => {
          const c = checksOf(parsePreview(raw));
          return c ? [c] : [];
        });
        const overrides = Object.assign({}, ...info.unitOverrides.map(parseOverrides)) as UnitOverrides;
        health = healthLines(pass, refs, info.unitSystem === "metric" ? "metric" : "imperial", overrides);
      }
    } catch (e) {
      console.warn("Alert health check failed:", e);
    }
    let attach: string | null = null;
    try {
      const preview = args.withImage ? parsePreview(info.preview) : null;
      if (preview) {
        const png = renderPassPng(preview);
        const storageId = await ctx.storage.store(new Blob([new Uint8Array(png)], { type: "image/png" }));
        attach = await ctx.storage.getUrl(storageId);
        await ctx.scheduler.runAfter(IMAGE_TTL_MS, internal.notify.deleteAlertImage, { storageId });
      }
    } catch (e) {
      console.warn("Alert preview image failed:", e);
    }
    try {
      // JSON to the root, not headers on the topic URL: a Title header can't carry
      // non-ASCII, and vehicle or file names can.
      const res = await fetch("https://ntfy.sh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: NTFY_TOPIC,
          title: info.title,
          message:
            health === null
              ? info.message
              : health.length
                ? `${info.message}\n⚠️ ${health.join("\n⚠️ ")}`
                : `${info.message}\nHealth: all clear`,
          tags: health?.length ? ["warning"] : ["checkered_flag"],
          ...(health?.length ? { priority: 4 } : {}),
          ...(attach ? { attach, filename: "pass.png" } : {}),
        }),
      });
      if (!res.ok) console.warn(`ntfy alert failed: HTTP ${res.status}`);
    } catch (e) {
      console.warn("ntfy alert failed:", e);
    }
  },
});

/** The Health check's inputs from a stored preview; null for a preview without them. */
function checksOf(p: PreviewPayload | null): PassChecks | null {
  if (!p || (!p.levels?.length && !p.cylinders?.length && !p.boost && !p.limiter)) return null;
  return { levels: p.levels ?? [], cylinders: p.cylinders ?? [], boost: p.boost, limiter: p.limiter, faults: p.faults };
}

function parseOverrides(raw: string | null): UnitOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as UnitOverrides) : {};
  } catch {
    return {};
  }
}

/**
 * The pass as the run sheet's trace shows it: RPM, throttle and driveshaft,
 * each on its own scale, from a second before the launch to the end of the run.
 */
function renderPassPng(preview: NonNullable<ReturnType<typeof parsePreview>>): Buffer {
  const s = raceSeries(preview, 1);
  const px = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i++) px.set(BACKGROUND, i * 3);

  const span = s.duration > 0 ? s.duration : 1;
  const x = (t: number) => PAD + (t / span) * (WIDTH - PAD * 2);
  for (let sec = 1; sec < span; sec++) {
    const cx = Math.round(x(sec));
    for (let y = PAD; y < HEIGHT - PAD; y++) blend(px, cx, y, SECOND_RULE, 1);
  }
  for (const [values, color] of [
    [s.tps, TPS_COLOR],
    [s.dsRpm, DS_COLOR],
    [s.rpm, RPM_COLOR],
  ] as const) {
    if (values) drawSeries(px, s.times, values, x, color);
  }
  return encodePng(px, WIDTH, HEIGHT);
}

function drawSeries(
  px: Uint8Array,
  times: number[],
  values: (number | null)[],
  x: (t: number) => number,
  color: Rgb,
) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return;
  const range = max - min || 1;
  const y = (v: number) => HEIGHT - PAD - ((v - min) / range) * (HEIGHT - PAD * 2);
  // Gaps break the line rather than being bridged, as on the run sheet.
  let prev: [number, number] | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      prev = null;
      continue;
    }
    const p: [number, number] = [x(times[i]), y(v)];
    if (prev) drawLine(px, prev, p, color);
    prev = p;
  }
}

/** A ~2.5px line: a soft round brush stamped every half pixel. */
function drawLine(px: Uint8Array, [x0, y0]: [number, number], [x1, y1]: [number, number], color: Rgb) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let k = 0; k <= steps; k++) {
    const cx = x0 + ((x1 - x0) * k) / steps;
    const cy = y0 + ((y1 - y0) * k) / steps;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ix = Math.round(cx) + dx;
        const iy = Math.round(cy) + dy;
        const d = Math.hypot(ix - cx, iy - cy);
        const a = Math.min(1, Math.max(0, 1.6 - d));
        if (a > 0) blend(px, ix, iy, color, a);
      }
    }
  }
}

function blend(px: Uint8Array, x: number, y: number, [r, g, b]: Rgb, a: number) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 3;
  // Stamps overlap, so blend toward the colour and never past it.
  px[i] = Math.max(px[i], px[i] + (r - px[i]) * a) | 0;
  px[i + 1] = Math.max(px[i + 1], px[i + 1] + (g - px[i + 1]) * a) | 0;
  px[i + 2] = Math.max(px[i + 2], px[i + 2] + (b - px[i + 2]) * a) | 0;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An 8-bit RGB PNG. */
function encodePng(px: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // no row filter
    raw.set(px.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

import type { ChannelDef, ParsedLog } from "./log-types";

// Holley V6 layout reference:
// https://github.com/HackingLZ/holley-efi-parser
// The implementation here is browser-native and intentionally supports only
// the fixed-width V6 .DL format requested by DragTrace users.
const HOLLEY_V5_V6_MAGIC = 0x0085f41f;
const HOLLEY_V3_MAGIC = 0x0095365f;
const VERSION_OFFSET = 8;
const V6_VERSION = 6;
const V6_DATA_START = 16_456;
const V6_FLOATS_PER_ROW = 1_030;
const V6_BYTES_PER_ROW = V6_FLOATS_PER_ROW * 4;
// 1,030 float slots contain 515 value/status pairs (parameter indexes 0-514).
// The upstream parser loops once too far despite documenting the 1,030-float
// stride; stopping at 514 prevents the final channel from reading into the
// following row.
const V6_CHANNEL_COUNT = V6_FLOATS_PER_ROW / 2;

interface KnownChannel {
  name: string;
  unit?: string;
  quantitySlug?: string;
  convert?: (value: number) => number;
}

const identity = (value: number) => value;

// The reference parser documents these names. All other V6 positions stay
// explicitly numbered so we never attach a plausible-but-wrong sensor label.
const KNOWN_CHANNELS = new Map<number, KnownChannel>([
  [0, { name: "Point Number" }],
  [1, { name: "RTC", unit: "s", quantitySlug: "time-s" }],
  [2, { name: "RPM", unit: "RPM", quantitySlug: "engine-speed" }],
  [3, { name: "Injector Pulse Width", unit: "ms", quantitySlug: "time-ms" }],
  [4, { name: "Injector Duty Cycle", unit: "%", quantitySlug: "percentage" }],
  [5, { name: "Closed Loop Compensation", unit: "%", quantitySlug: "percentage" }],
  [6, { name: "Target AFR", unit: "AFR", quantitySlug: "afr", convert: (value) => value / 14.7 }],
  [7, { name: "AFR Left", unit: "AFR", quantitySlug: "afr", convert: (value) => value / 14.7 }],
  [8, { name: "AFR Right", unit: "AFR", quantitySlug: "afr", convert: (value) => value / 14.7 }],
  [9, { name: "AFR Average", unit: "AFR", quantitySlug: "afr", convert: (value) => value / 14.7 }],
  [10, { name: "Air Temperature Enrichment", unit: "%", quantitySlug: "percentage" }],
  [66, { name: "Throttle Position", unit: "%", quantitySlug: "percentage" }],
]);

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readFloat(view: DataView, row: number, channelIndex: number): number {
  const rowOffset = V6_DATA_START + row * V6_BYTES_PER_ROW;
  // V6 stores one value and one companion/status float per CSV parameter.
  return view.getFloat32(rowOffset + channelIndex * 2 * 4, true);
}

function formatError(view: DataView): Error {
  const magic = view.byteLength >= 4 ? readUint32(view, 0) : 0;
  const version = view.byteLength >= VERSION_OFFSET + 4 ? readUint32(view, VERSION_OFFSET) : 0;
  if (magic === HOLLEY_V3_MAGIC) {
    return new Error("Holley DL V3 is not supported. Open or export the log with Holley EFI software first.");
  }
  if (magic === HOLLEY_V5_V6_MAGIC && version === 5) {
    return new Error("Holley DL V5 uses sparse storage. Open it in Holley EFI software to convert it to V6, then upload the V6 .dl file.");
  }
  if (magic === HOLLEY_V5_V6_MAGIC) {
    return new Error(`Holley DL V${version || "unknown"} is not supported. DragTrace currently opens V6 .dl files only.`);
  }
  return new Error("This is not a supported Holley EFI V6 .dl file.");
}

export function isHolleyV6Dl(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < V6_DATA_START + V6_BYTES_PER_ROW) return false;
  const view = new DataView(bytes);
  return readUint32(view, 0) === HOLLEY_V5_V6_MAGIC && readUint32(view, VERSION_OFFSET) === V6_VERSION;
}

export function parseHolleyV6Dl(bytes: ArrayBuffer): ParsedLog {
  const view = new DataView(bytes);
  if (!isHolleyV6Dl(bytes)) throw formatError(view);

  const dataBytes = bytes.byteLength - V6_DATA_START;
  const rowCount = Math.floor(dataBytes / V6_BYTES_PER_ROW);
  const remainder = dataBytes % V6_BYTES_PER_ROW;
  if (rowCount === 0 || remainder >= 100) {
    throw new Error("The Holley V6 data section is incomplete or has an unexpected record size.");
  }

  const rawTimes = new Float64Array(rowCount);
  let firstTime = Number.NaN;
  let previousTime = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < rowCount; row++) {
    const time = readFloat(view, row, 1);
    if (!Number.isFinite(time)) throw new Error(`Holley V6 log has an invalid RTC value at row ${row + 1}.`);
    if (row > 0 && time < previousTime) {
      throw new Error(`Holley V6 log time moves backward at row ${row + 1}.`);
    }
    if (row === 0) firstTime = time;
    rawTimes[row] = time - firstTime;
    previousTime = time;
  }

  const channels = new Map<string, Float64Array>();
  const channelDefs: ChannelDef[] = [];

  // Point Number and RTC drive row/time handling rather than appearing as
  // selectable traces. Every actual parameter remains available.
  for (let channelIndex = 2; channelIndex < V6_CHANNEL_COUNT; channelIndex++) {
    const known = KNOWN_CHANNELS.get(channelIndex);
    const name = known?.name ?? `Holley Parameter ${String(channelIndex).padStart(3, "0")}`;
    const convert = known?.convert ?? identity;
    const values = new Float64Array(rowCount);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (let row = 0; row < rowCount; row++) {
      const raw = readFloat(view, row, channelIndex);
      const value = Number.isFinite(raw) ? convert(raw) : Number.NaN;
      values[row] = value;
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }

    channels.set(name, values);
    channelDefs.push({
      name,
      id: channelIndex,
      type: known?.unit ?? "Holley V6 parameter",
      unit: known?.unit,
      displayMin: Number.isFinite(min) ? min : 0,
      displayMax: Number.isFinite(max) ? max : 0,
      index: channelDefs.length,
      quantitySlug: known?.quantitySlug,
      path: `Holley/Param_${String(channelIndex).padStart(3, "0")}`,
    });
  }

  return {
    format: "Holley EFI V6",
    metadata: {
      "DL Version": "6",
      "Data layout": "515 interleaved parameters",
    },
    channelDefs,
    sessions: [{
      label: "Holley EFI V6",
      startTime: new Date(0),
      timestamps: rawTimes,
      channels,
      channelStatus: new Map(),
      rowCount,
    }],
  };
}

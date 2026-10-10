import { isStatusValue, statusCodeOf, haltechAdapter } from "./ecu/haltech";
import { QUANTITIES, rawToCanonical } from "./ecu/quantities";
import { fillChannelGaps, getChannelEnumValues, isContinuousQuantity } from "./haltech-parser";
import type { ChannelDef, ChannelStatus, LogSession, ParsedLog } from "./log-types";

// NSP writes a stream of length-prefixed sections. The high nibble selects a
// sampling group; types 11/12/13 carry a 16-bit group number instead. See the
// corrected format notes in the sibling haltech project's COMMS.md, section 8.
const MAX_CHANNELS = 16_384;
export const MAX_HALTECH_CELLS = 50_000_000;
/** Throttle Position is stored in tenths of a percent: 90% and over is wide open. */
const WOT_RAW = 900;
const MAX_SAMPLES = 1_000_000;
const quantitiesById = new Map(Object.values(QUANTITIES).map((q) => [q.sourceId, q]));

interface Descriptor {
  unitType: number;
  displayMin: number;
  displayMax: number;
  shortName: string;
  name: string;
  description: string;
}

interface Group {
  ids?: number[];
  descriptors?: Descriptor[];
}

interface Sample {
  time: number;
  group: number;
  offset: number;
  count: number;
}

interface Block {
  serial: string;
  startTime: Date;
  hasRecordedDate: boolean;
  dateSource: "header" | "filename" | "unknown";
  logNumber: number;
  source: number;
  groups: Map<number, Group>;
  samples: Sample[];
  lastLogNumber: number;
}

function invalid(detail: string): Error {
  return new Error(`Invalid Haltech HLG log: ${detail}`);
}

// NSP casts each character to a byte, rather than writing UTF-8. Decode those
// bytes directly (TextDecoder's "latin1" alias actually uses Windows-1252).
function byteString(data: Uint8Array, start: number, end: number): string {
  let result = "";
  for (let i = start; i < end; i++) result += String.fromCharCode(data[i]);
  return result;
}

function calendarDate(year: number, month: number, day: number, hour: number, minute: number, second: number): Date | undefined {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59) return undefined;
  const date = new Date(0);
  // setFullYear also handles years 1–99 without Date's implicit 1900 offset.
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date : undefined;
}

function dateFromFileName(fileName: string | undefined): Date | undefined {
  // NSP names downloads YYYY-MM-DD_hhmmam/pm. This is a display fallback only:
  // a filename cannot establish that separate ECU blocks share a clock origin.
  const match = /(?:^|[ _-])(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(am|pm)(?=_|\.|$)/i.exec(fileName ?? "");
  if (!match) return undefined;
  const hour = Number(match[4]);
  if (hour < 1 || hour > 12) return undefined;
  return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]),
    hour % 12 + (match[6].toLowerCase() === "pm" ? 12 : 0), Number(match[5]), 0);
}

function readDescriptors(data: Uint8Array, view: DataView, start: number, end: number): Descriptor[] {
  const result: Descriptor[] = [];
  let pos = start;
  const string = () => {
    const begin = pos;
    while (pos < end && data[pos] !== 0) pos++;
    if (pos === end) throw invalid("unterminated channel name or description");
    return byteString(data, begin, pos++);
  };
  while (pos < end) {
    if (end - pos < 14) throw invalid("truncated channel descriptor");
    const unitType = view.getUint16(pos);
    // Byte +2 is the preferred display-unit order; values stay in raw units.
    const displayMin = view.getInt32(pos + 3);
    const displayMax = view.getInt32(pos + 7);
    pos += 11;
    const shortName = string();
    const name = string();
    const description = string();
    result.push({ unitType, displayMin, displayMax, shortName, name, description });
    if (result.length > MAX_CHANNELS) throw invalid("too many channels");
  }
  return result;
}

function statusSummary(hits: Map<number, number>, rowCount: number): ChannelStatus {
  const counts = new Map<number, number>();
  for (const code of hits.values()) counts.set(code, (counts.get(code) ?? 0) + 1);
  let dominantCode = 0;
  let largest = 0;
  for (const [code, count] of counts) {
    if (count > largest) { dominantCode = code; largest = count; }
  }
  return {
    samples: hits.size,
    rowCount,
    dominantCode,
    dominantLabel: haltechAdapter.statusLabel(dominantCode),
    codes: [...counts.keys()],
  };
}

function fillSampleGaps(values: Float64Array, timestamps: Float64Array, linear: boolean, hits: Map<number, number>) {
  // A fault is an actual sensor state, not a slow group missing this row.
  // Stop interpolation at faults and keep the channel blank until its next
  // valid reading, including rows contributed by faster sampling groups.
  let start = 0;
  for (let row = 0; row < values.length; row++) {
    if (!hits.has(row)) continue;
    fillChannelGaps(values.subarray(start, row), timestamps.subarray(start, row), linear);
    let resume = row + 1;
    while (resume < values.length && Number.isNaN(values[resume])) resume++;
    start = resume;
    row = resume - 1;
  }
  fillChannelGaps(values.subarray(start), timestamps.subarray(start), linear);
}

/** Read PC recordings and grouped ECU recordings without dropping slower groups. */
export function parseHaltechHlg(bytes: ArrayBuffer, cellLimit = MAX_HALTECH_CELLS, fileName?: string): ParsedLog {
  if (bytes.byteLength > 256 * 1024 * 1024) throw new Error("The Haltech log exceeds the 256 MB import limit.");
  const data = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const blocks: Block[] = [];
  const logNumbers: number[] = [];
  let block: Block | undefined;
  let pos = 0;
  let sampleCount = 0;

  while (pos < data.length) {
    const type = data[pos];
    if (type === 0xff) { pos++; continue; }
    // ECU buffers can end in unused zero-filled capacity.
    if (type === 0 && data.subarray(pos).every((byte) => byte === 0)) break;
    if (data.length - pos < 5) throw invalid("truncated section header");
    const length = view.getUint32(pos + 1);
    if (length < 5 || length > data.length - pos) throw invalid("truncated or invalid section length");
    const end = pos + length;
    const kind = type & 0x0f;

    if (kind === 1) {
      if (length < 57 || !/^HALTECH[01]$/.test(byteString(data, pos + 5, pos + 13))) {
        throw invalid("missing HALTECH header");
      }
      const serialEnd = data.subarray(pos + 17, pos + 49).indexOf(0);
      const year = view.getUint16(pos + 53);
      const month = data[pos + 55];
      const day = data[pos + 56];
      const hour = data[pos + 49];
      const minute = data[pos + 50];
      const second = data[pos + 51];
      // ECU recordings may have no clock set (all zeroes). NSP accepts missing
      // or invalid calendar metadata and still reads their sensor samples.
      const recordedDate = calendarDate(year, month, day, hour, minute, second);
      const filenameDate = recordedDate ? undefined : dateFromFileName(fileName);
      const startTime = recordedDate ?? filenameDate ?? new Date(0);
      const logNumber = (length >= 61 ? view.getUint32(pos + 57) : 0) || logNumbers[blocks.length] || 0;
      block = {
        serial: byteString(data, pos + 17, pos + 17 + (serialEnd < 0 ? 32 : serialEnd)),
        startTime,
        hasRecordedDate: !!recordedDate,
        dateSource: recordedDate ? "header" : filenameDate ? "filename" : "unknown",
        logNumber,
        lastLogNumber: logNumber,
        source: length >= 66 ? data[pos + 65] : 0,
        groups: new Map(),
        samples: [],
      };
      blocks.push(block);
    } else if (type === 14) {
      if ((length - 5) % 4) throw invalid("invalid stored-log index");
      for (let at = pos + 5; at < end; at += 4) logNumbers.push(view.getUint32(at));
    } else if (kind === 6 || kind === 9 || kind === 7 || type === 11 || type === 12 || type === 13) {
      if (!block) throw invalid("channel or sample section precedes the log header");
      const extended = type === 11 || type === 12 || type === 13;
      if (extended && length < 7) throw invalid("truncated channel-group number");
      const groupNumber = extended ? view.getUint16(pos + 5) : type >> 4;
      const start = pos + (extended ? 7 : 5);
      const group = block.groups.get(groupNumber) ?? {};
      block.groups.set(groupNumber, group);
      if (kind === 6 || type === 11) {
        if ((end - start) % 2) throw invalid("invalid channel-ID table");
        const ids: number[] = [];
        for (let at = start; at < end; at += 2) ids.push(view.getUint16(at));
        if (ids.length > MAX_CHANNELS) throw invalid("too many channels");
        if (group.ids && group.ids.join(",") !== ids.join(",")) throw invalid("channel group changes within a recording");
        group.ids = ids;
      } else if (kind === 9 || type === 13) {
        group.descriptors = readDescriptors(data, view, start, end);
      } else {
        if (end - start < 4 || (end - start - 4) % 4) throw invalid("invalid sample length");
        const count = (end - start - 4) / 4;
        if (count === 0 || !group.ids || group.ids.length !== count) throw invalid("sample does not match its channel group");
        const time = view.getUint32(start);
        const previous = block.samples[block.samples.length - 1];
        if (previous && time < previous.time) throw invalid("sample timestamps go backwards");
        if (++sampleCount > MAX_SAMPLES) throw new Error("This Haltech log has too many samples. Export a shorter recording from NSP.");
        block.samples.push({ time, group: groupNumber, offset: start + 4, count });
      }
    }
    // Other sections include embedded maps and scope captures; their declared
    // length lets us skip them without mistaking their payload for samples.
    pos = end;
  }

  if (blocks.length === 0) throw invalid("no HALTECH log header found");
  // NSP splits continuous ECU recordings at storage block boundaries. Merge
  // only when raw clocks continue and the complete channel schema agrees.
  const recordings: Block[] = [];
  const schema = (candidate: Block) => JSON.stringify([...candidate.groups]
    .sort(([a], [b]) => a - b)
    .map(([groupNumber, group]) => [groupNumber, group.ids, group.descriptors]));
  for (const current of blocks) {
    if (current.samples.length === 0) continue;
    const previous = recordings[recordings.length - 1];
    const gap = previous ? current.samples[0].time - previous.samples[previous.samples.length - 1].time : -1;
    const originGap = previous ? Math.abs((current.startTime.getTime() - previous.startTime.getTime()) -
      (current.samples[0].time - previous.samples[0].time)) : Infinity;
    const nextNumber = previous && (!previous.lastLogNumber || !current.logNumber ||
      current.logNumber === previous.lastLogNumber + 1);
    if (previous && previous.hasRecordedDate && current.hasRecordedDate &&
        current.source !== 0 && previous.serial === current.serial && previous.source === current.source &&
        originGap <= 1000 && nextNumber &&
        gap >= 0 && gap <= 1000 && schema(previous) === schema(current)) {
      for (const sample of current.samples) previous.samples.push(sample);
      previous.lastLogNumber = current.lastLogNumber;
    } else {
      recordings.push(current);
    }
  }
  // A race-day download can hold more than the browser should decode at
  // once. Decode the recordings with a pass in them first, then the rest in
  // order while they fit, and leave out what doesn't rather than refuse the
  // whole file over idle and warm-up recordings.
  // As the decoder counts: one array per channel, however many sampling
  // groups carry it, one cell per distinct sample time.
  const cellsOf = (r: Block) => {
    const channels = new Set<number>();
    for (const group of r.groups.values()) for (const id of group.ids ?? []) channels.add(id);
    return new Set(r.samples.map((sample) => sample.time)).size * channels.size;
  };
  // Seconds at wide-open throttle: a pass has several, a burnout or idle
  // recording next to none. (The race timer also starts on burnouts.)
  const wotSeconds = (r: Block) => {
    for (const [groupNumber, group] of r.groups) {
      const at = group.descriptors?.findIndex((d) => d.name === "Throttle Position") ?? -1;
      if (at < 0) continue;
      let ms = 0;
      let last: { time: number; wot: boolean } | null = null;
      for (const sample of r.samples) {
        if (sample.group !== groupNumber) continue;
        const raw = view.getInt32(sample.offset + at * 4);
        const wot = !isStatusValue(raw) && raw >= WOT_RAW;
        if (last?.wot && wot) ms += sample.time - last.time;
        last = { time: sample.time, wot };
      }
      return ms / 1000;
    }
    return 0;
  };
  const wot = new Map(recordings.map((r) => [r, wotSeconds(r)]));
  const size = new Map(recordings.map((r) => [r, cellsOf(r)]));
  const kept = new Set<Block>();
  let budget = 0;
  // Passes first; then the smallest, so the burnouts and staging around a
  // pass fit before a long idle recording does.
  for (const r of [...recordings].sort((a, b) => wot.get(b)! - wot.get(a)! || size.get(a)! - size.get(b)!)) {
    const cells = size.get(r)!;
    if (budget + cells > cellLimit) continue;
    kept.add(r);
    budget += cells;
  }
  if (kept.size === 0 && recordings.length > 0) {
    throw new Error("This Haltech log is too large to open. Export a shorter recording from NSP.");
  }
  const recordingLabel = (r: Block, fallback: number) =>
    r.logNumber
      ? r.lastLogNumber && r.lastLogNumber !== r.logNumber
        ? `Log ${r.logNumber}–${r.lastLogNumber}`
        : `Log ${r.logNumber}`
      : `Session ${fallback}`;
  const skipped = recordings.filter((r) => !kept.has(r)).map((r) => recordingLabel(r, recordings.indexOf(r) + 1));

  const channelDefs: ChannelDef[] = [];
  const byName = new Map<string, ChannelDef>();
  const sessions: LogSession[] = [];
  let cellCount = 0;

  for (const current of recordings.filter((r) => kept.has(r))) {
    const times = [...new Set(current.samples.map((sample) => sample.time))];
    const rowCount = times.length;
    const rows = new Map(times.map((time, row) => [time, row]));
    const timestamps = Float64Array.from(times, (time) => (time - times[0]) / 1000);
    const groupDefs = new Map<number, ChannelDef[]>();
    const channels = new Map<string, Float64Array>();
    const statusHits = new Map<string, Map<number, number>>();
    const number = current.logNumber;
    const label = number
      ? current.lastLogNumber && current.lastLogNumber !== number
        ? `Log ${number}–${current.lastLogNumber}` : `Log ${number}`
      : `Session ${sessions.length + 1}`;

    for (const [groupNumber, group] of [...current.groups].sort(([a], [b]) => a - b)) {
      if (!group.ids || !group.descriptors || group.ids.length !== group.descriptors.length) {
        throw invalid("channel metadata does not match its ID table");
      }
      const defs = group.ids.map((id, index) => {
        const descriptor = group.descriptors![index];
        const quantity = quantitiesById.get(descriptor.unitType);
        const quantitySlug = quantity?.slug;
        const baseName = descriptor.name || descriptor.shortName || `Channel ${id}`;
        let name = baseName;
        let existing = byName.get(name);
        // Distinct channels may share a display name. Keep both, while joining
        // the same ID across repeated blocks or sampling groups.
        if (existing && (existing.id !== id || existing.type !== (quantity?.name ?? `Unit ${descriptor.unitType}`))) {
          name = `${baseName} (${id})`;
          let suffix = 2;
          while (byName.has(name) && (byName.get(name)!.id !== id || byName.get(name)!.type !== (quantity?.name ?? `Unit ${descriptor.unitType}`))) {
            name = `${baseName} (${id}, ${suffix++})`;
          }
          existing = byName.get(name);
        }
        if (!existing) {
          const convert = (raw: number) => isStatusValue(raw) ? Number.NaN : rawToCanonical(raw, quantitySlug);
          existing = {
            name, id, type: quantity?.name ?? `Unit ${descriptor.unitType}`, quantitySlug,
            index: channelDefs.length,
            displayMin: convert(descriptor.displayMin), displayMax: convert(descriptor.displayMax),
            shortName: descriptor.shortName || undefined,
            description: descriptor.description || undefined,
            enumValues: getChannelEnumValues(baseName),
          };
          channelDefs.push(existing);
          byName.set(name, existing);
        }
        if (!channels.has(name)) {
          cellCount += rowCount;
          if (cellCount > cellLimit) throw new Error("This Haltech log is too large to open. Export a shorter recording from NSP.");
          channels.set(name, new Float64Array(rowCount).fill(Number.NaN));
          statusHits.set(name, new Map());
        }
        return existing;
      });
      groupDefs.set(groupNumber, defs);
    }

    for (const sample of current.samples) {
      const row = rows.get(sample.time)!;
      const defs = groupDefs.get(sample.group)!;
      for (let index = 0; index < sample.count; index++) {
        const def = defs[index];
        const raw = view.getInt32(sample.offset + index * 4);
        const hits = statusHits.get(def.name)!;
        if (isStatusValue(raw)) {
          hits.set(row, statusCodeOf(raw));
          channels.get(def.name)![row] = Number.NaN;
        } else {
          hits.delete(row);
          channels.get(def.name)![row] = rawToCanonical(raw, def.quantitySlug);
        }
      }
    }
    const channelStatus = new Map<string, ChannelStatus>();
    for (const [name, values] of channels) {
      const def = byName.get(name)!;
      const hits = statusHits.get(name)!;
      fillSampleGaps(values, timestamps, isContinuousQuantity(def.quantitySlug) && !def.enumValues, hits);
      if (hits.size > 0) {
        channelStatus.set(name, statusSummary(hits, rowCount));
      }
    }
    sessions.push({ label, startTime: current.startTime, timestamps, channels, channelStatus, rowCount });
  }
  if (sessions.length === 0) throw new Error("No log samples found in this Haltech recording");
  return {
    format: "Haltech",
    metadata: {
      // Stored ECU headers can contain binary serial data; do not expose it as
      // control characters or guess an encoding from PC log headers.
      ...([...blocks[0].serial].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126) && blocks[0].serial
        ? { "ECU Serial": blocks[0].serial } : {}),
      "Log Source": blocks[0].source === 0 ? "PC" : "ECU",
      "Recording Date Source": blocks[0].dateSource,
      ...(skipped.length ? { "Recordings Left Out (too large to open together)": skipped.join(", ") } : {}),
    },
    channelDefs,
    sessions,
  };
}

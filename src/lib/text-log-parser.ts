import type { ChannelDef, ParsedLog } from "./log-types";

type TextFormat =
  | "ECUMaster"
  | "RomRaider"
  | "MegaSquirt / TunerStudio"
  | "BlueDriver"
  | "OBDLink"
  | "MHD Tuning"
  | "Motorsport Electronics"
  | "DynamicEFI"
  | "Holley CSV"
  | "Woolich Racing Tuned"
  | "RaceChrono"
  | "Locomotive Datalogger";

type TimeMode = "seconds" | "milliseconds" | "clock" | "date" | "dynamic-runtime";

interface TextLayout {
  format: TextFormat;
  headerIndex: number;
  delimiter: string;
  timeIndex: number;
  channelStart: number;
  skipColumns?: Set<number>;
  unitsIndex?: number;
  sourcesIndex?: number;
  decimalComma?: boolean;
  sparse?: boolean;
  timeMode: TimeMode;
  metadata: Record<string, string>;
}

interface ChannelInfo {
  name: string;
  path?: string;
  unit: string;
  quantitySlug?: string;
  convert: (value: number) => number;
}

const EMPTY_STATUS = () => new Map();

/** Decode the text export variants found in ECU tools, including UTF-16 BlueDriver logs. */
export function decodeLogText(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(data.subarray(2)).replace(/^\uFEFF/, "");
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(data.subarray(2)).replace(/^\uFEFF/, "");
  }
  // Some UTF-16 exporters omit the BOM. A NUL in most odd bytes is a strong
  // enough signal and avoids turning the file into thousands of one-letter cells.
  const probe = data.subarray(0, Math.min(data.length, 256));
  let oddNuls = 0;
  for (let i = 1; i < probe.length; i += 2) if (probe[i] === 0) oddNuls++;
  if (probe.length > 8 && oddNuls > probe.length / 8) {
    return new TextDecoder("utf-16le").decode(data).replace(/^\uFEFF/, "");
  }
  const utf8 = new TextDecoder("utf-8").decode(data);
  const decoded = utf8.includes("\uFFFD")
    ? new TextDecoder("windows-1252").decode(data)
    : utf8;
  return decoded.replace(/^\uFEFF/, "").replace(/\0/g, "");
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  if (!line.includes('"')) return line.split(delimiter).map((field) => field.trim());
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field.trim());
  return fields;
}

function firstContentLine(lines: string[]): number {
  return lines.findIndex((line) => line.trim().length > 0);
}

function findHeader(lines: string[], test: (line: string) => boolean): number {
  return lines.findIndex((line) => test(line.trim()));
}

function metadataBefore(lines: string[], headerIndex: number): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const raw of lines.slice(0, headerIndex)) {
    const line = raw.trim().replace(/^#/, "");
    if (!line) continue;
    const colon = line.indexOf(":");
    const comma = line.indexOf(",");
    const split = colon >= 0 && (comma < 0 || colon < comma) ? colon : comma;
    if (split > 0) metadata[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return metadata;
}

function detectLayout(text: string, lines: string[]): TextLayout | null {
  const firstIndex = firstContentLine(lines);
  if (firstIndex < 0) return null;
  const first = lines[firstIndex].trim();

  if (/racechrono/i.test(first) && lines.some((line) => /^Format\s*,\s*3\s*$/i.test(line.trim()))) {
    const headerIndex = findHeader(lines, (line) => /^timestamp\s*,/i.test(line));
    if (headerIndex >= 0) {
      return {
        format: "RaceChrono",
        headerIndex,
        delimiter: ",",
        timeIndex: 0,
        channelStart: 1,
        unitsIndex: headerIndex + 1,
        sourcesIndex: headerIndex + 2,
        sparse: true,
        timeMode: "seconds",
        metadata: metadataBefore(lines, headerIndex),
      };
    }
  }

  if (/^Tune Datalog export/i.test(first)) {
    const headerIndex = findHeader(lines, (line) => /^Frame\s*,\s*Duration\s*,/i.test(line));
    if (headerIndex >= 0) {
      return {
        format: "MegaSquirt / TunerStudio",
        headerIndex,
        delimiter: ",",
        timeIndex: 1,
        channelStart: 2,
        timeMode: "seconds",
        metadata: metadataBefore(lines, headerIndex),
      };
    }
  }

  if (/BlueDriver Data Log/i.test(first)) {
    const headerIndex = findHeader(lines, (line) => /^Time\s*\(s\)\s*,/i.test(line));
    if (headerIndex >= 0) {
      return {
        format: "BlueDriver",
        headerIndex,
        delimiter: ",",
        timeIndex: 0,
        channelStart: 1,
        timeMode: "seconds",
        metadata: { Date: lines[firstIndex + 1]?.trim() ?? "" },
      };
    }
  }

  if (/^TimeStamp\s*:/i.test(first)) {
    const headerIndex = findHeader(lines, (line) => /^TimeStamp\s*,/i.test(line));
    if (headerIndex >= 0) {
      return {
        format: "Locomotive Datalogger",
        headerIndex,
        delimiter: ",",
        timeIndex: 0,
        channelStart: 1,
        timeMode: "date",
        metadata: metadataBefore(lines, headerIndex),
      };
    }
  }

  const mhd = /#Ecu\s+(?:CALID|PRGID)|#VIN\s*:/i.test(text.slice(0, 4096));
  if (mhd) {
    const headerIndex = findHeader(lines, (line) => /^Time\s*,/i.test(line));
    if (headerIndex >= 0) {
      const headers = parseDelimitedLine(lines[headerIndex], ",");
      const skipColumns = new Set<number>();
      headers.forEach((header, index) => {
        if (/\.(?:bin|map)$/i.test(header.trim())) skipColumns.add(index);
      });
      return {
        format: "MHD Tuning",
        headerIndex,
        delimiter: ",",
        timeIndex: 0,
        channelStart: 1,
        skipColumns,
        sparse: true,
        timeMode: "seconds",
        metadata: metadataBefore(lines, headerIndex),
      };
    }
  }

  const normalizedFirst = first.replace(/^\uFEFF/, "");
  if (/^RUNTIME\s*,/i.test(normalizedFirst) && /,(?:BLM|BPC),/i.test(normalizedFirst)) {
    return {
      format: "DynamicEFI",
      headerIndex: firstIndex,
      delimiter: ",",
      timeIndex: 0,
      channelStart: 1,
      timeMode: "dynamic-runtime",
      metadata: {},
    };
  }
  if (/^Point Number\s*,\s*RTC\s*,\s*RPM\s*,/i.test(normalizedFirst)) {
    return {
      format: "Holley CSV",
      headerIndex: firstIndex,
      delimiter: ",",
      timeIndex: 1,
      channelStart: 2,
      unitsIndex: firstIndex + 1,
      timeMode: "seconds",
      metadata: {},
    };
  }
  if (/^Log Time\s*,/i.test(normalizedFirst)) {
    return {
      format: "Woolich Racing Tuned",
      headerIndex: firstIndex,
      delimiter: ",",
      timeIndex: 0,
      channelStart: 1,
      timeMode: "clock",
      metadata: {},
    };
  }
  if (/^TIME(?:;|\t)/.test(normalizedFirst)) {
    const delimiter = normalizedFirst.includes(";") ? ";" : "\t";
    return {
      format: "ECUMaster",
      headerIndex: firstIndex,
      delimiter,
      timeIndex: 0,
      channelStart: 1,
      decimalComma: delimiter === ";",
      sparse: true,
      timeMode: "seconds",
      metadata: {},
    };
  }

  const strippedHeaderIndex = findHeader(lines, (line) => /^Time\s*\(sec\)\s*,/i.test(line));
  if (strippedHeaderIndex >= 0 && lines.slice(0, strippedHeaderIndex).every((line) => !line.trim() || /^#/.test(line.trim()))) {
    return {
      format: "OBDLink",
      headerIndex: strippedHeaderIndex,
      delimiter: ",",
      timeIndex: 0,
      channelStart: 1,
      timeMode: "seconds",
      metadata: metadataBefore(lines, strippedHeaderIndex),
    };
  }

  if (/^Time\s*,/i.test(normalizedFirst) && /Sync status/i.test(normalizedFirst) && /MAP Raw/i.test(normalizedFirst)) {
    return {
      format: "Motorsport Electronics",
      headerIndex: firstIndex,
      delimiter: ",",
      timeIndex: 0,
      channelStart: 1,
      timeMode: "seconds",
      metadata: {},
    };
  }

  if (/^Time/i.test(normalizedFirst) && (normalizedFirst.includes(",") || normalizedFirst.includes(";"))) {
    const delimiter = normalizedFirst.includes(";") ? ";" : ",";
    const timeHeader = parseDelimitedLine(normalizedFirst, delimiter)[0]?.toLowerCase() ?? "";
    return {
      format: "RomRaider",
      headerIndex: firstIndex,
      delimiter,
      timeIndex: 0,
      channelStart: 1,
      decimalComma: delimiter === ";",
      timeMode: /msec|\bms\b/.test(timeHeader) ? "milliseconds" : "seconds",
      metadata: {},
    };
  }
  return null;
}

function parseNumeric(value: string, decimalComma: boolean): number {
  const normalized = decimalComma ? value.trim().replace(/,/g, ".") : value.trim();
  if (!normalized) return Number.NaN;
  switch (normalized.toUpperCase()) {
    case "ON":
    case "YES":
    case "TRUE":
    case "ACTIVE":
    case "Y":
      return 1;
    case "OFF":
    case "NO":
    case "FALSE":
    case "INACTIVE":
    case "N":
    case "P/N":
      return 0;
    case "D":
      return 4;
    case "R":
      return -1;
    case "L":
      return 1;
    default: {
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    }
  }
}

function parseClock(value: string): number {
  const parts = value.trim().split(":");
  if (parts.length !== 3) return Number.NaN;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  return [hours, minutes, seconds].every(Number.isFinite)
    ? hours * 3600 + minutes * 60 + seconds
    : Number.NaN;
}

function parseTime(value: string, mode: TimeMode, decimalComma: boolean): number {
  if (mode === "clock" || mode === "dynamic-runtime") return parseClock(value);
  if (mode === "date") {
    const timestamp = Date.parse(value.trim());
    return Number.isFinite(timestamp) ? timestamp / 1000 : Number.NaN;
  }
  const numeric = parseNumeric(value, decimalComma);
  return mode === "milliseconds" ? numeric / 1000 : numeric;
}

function normalizeUnit(raw: string): string {
  const unit = raw.trim().replace(/^\((.*)\)$/, "$1").replace(/^\[(.*)\]$/, "$1").trim();
  const lower = unit.toLowerCase().replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    "*c": "°C",
    ".c": "°C",
    c: "°C",
    degc: "°C",
    "°c": "°C",
    f: "°F",
    degf: "°F",
    "°f": "°F",
    rpm: "RPM",
    percent: "%",
    pct: "%",
    "%": "%",
    v: "V",
    volts: "V",
    mv: "mV",
    kmh: "km/h",
    kph: "km/h",
    "km/h": "km/h",
    mph: "mph",
    "m/s": "m/s",
    mbar: "mbar",
    bar: "bar",
    psi: "psi",
    psig: "psi",
    kpa: "kPa",
    inhg: "inHg",
    afr: "AFR",
    "a/f": "AFR",
    lambda: "λ",
    "λ": "λ",
    degrees: "°",
    deg: "°",
    "*": "°",
    "*crk": "°",
    "°": "°",
    ms: "ms",
    msec: "ms",
    s: "s",
    g: "g",
    "deg/s": "°/s",
    ".s": "s",
  };
  return aliases[lower] ?? unit;
}

function splitHeader(raw: string): { name: string; unit: string } {
  const header = raw.trim();
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(header);
  if (!match || !match[1].trim()) return { name: header, unit: "" };
  return { name: match[1].trim(), unit: normalizeUnit(match[2]) };
}

function titleWords(value: string): string {
  const spaced = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced.replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferUnit(name: string, format: TextFormat): string {
  const lower = name.toLowerCase();
  if (format === "DynamicEFI") {
    const source = lower.trim().split(/\s+/)[0];
    const units: Record<string, string> = {
      rpm: "RPM",
      mph: "mph",
      map: "kPa",
      bro: "kPa",
      psi: "psi",
      vac: "inHg",
      "ve%": "%",
      "dc%": "%",
      tps: "%",
      cts: "°F",
      iat: "°F",
      "i/c": "°F",
      o2: "mV",
      "g/s": "g/s",
      sa: "°",
      spw: "ms",
      apw: "ms",
      aepw: "ms",
      afr: "AFR",
      wb: "AFR",
      wb_0: "AFR",
    };
    if (source && units[source]) return units[source];
  }
  if (/^(rpm|engine rpm|engine speed)$/.test(lower) || /(?:^|[\s/])rpm(?:$|target|matching)/.test(lower)) return "RPM";
  if (/coolant|\bect\b|\bcts\b|intake air temp|\biat\b|temperature/.test(lower)) {
    return format === "DynamicEFI" ? "°F" : "°C";
  }
  if (/\bmap\b|manifold.*pressure|\biap\b|baro|ambient pressure|boost|fuel.*pressure|oil.*pressure/.test(lower)) {
    if (format === "RomRaider") return "psi";
    return "kPa";
  }
  if (/\btps\b|throttle|pedal pos|duty|trim|correction|percent/.test(lower)) return "%";
  if (/battery.*voltage|\bbatt v\b|voltage/.test(lower)) return "V";
  if (/afr|a\/f ratio/.test(lower)) return "AFR";
  if (/lambda|wideband/.test(lower)) return "λ";
  if (/timing|advance|ign\.|angle|knock.*(?:retard|correction)/.test(lower)) return "°";
  if (/vehicle speed|\bvss\b/.test(lower)) return format === "RomRaider" ? "mph" : "km/h";
  if (/pulse width|duration|dwell|dead time/.test(lower)) return "ms";
  if (/timer/.test(lower)) return "s";
  if (/flow/.test(lower)) return "cc/min";
  return "";
}

function normalizeName(sourceName: string): string {
  const leaf = sourceName.includes("/") ? sourceName.slice(sourceName.lastIndexOf("/") + 1) : sourceName;
  const readable = titleWords(leaf);
  const lower = readable.toLowerCase();
  if (/^(rpm|engine rpm|engine speed|plx engine speed)$/.test(lower)) return "RPM";
  if (/^(tps|throttle position)$/.test(lower)) return "Throttle Position";
  if (/^(map|iap|manifold absolute pressure|plx manifold absolute pressure)$/.test(lower)) return "Manifold Pressure";
  if (/^(ect|cts|coolant temp|coolant temperature)$/.test(lower)) return "Coolant Temperature";
  if (/^(iat|intake air temp|intake air temperature)$/.test(lower)) return "Intake Air Temperature";
  if (/^(vss|vehicle speed|mph)$/.test(lower)) return "Vehicle Speed";
  if (/^(a\/f ratio|afr|wideband|lambda bank 1)$/.test(lower)) return "Wideband O2 1";
  if (lower === "lambda bank 2") return "Wideband O2 2";
  return readable || sourceName;
}

function isAbsolutePressure(name: string): boolean {
  const lower = name.toLowerCase();
  return !/boost|vac|relative/.test(lower) && /\bmap\b|\biap\b|manifold|baro|ambient|atmos|\bpa\b/.test(lower);
}

function quantityAndConverter(name: string, unit: string): Pick<ChannelInfo, "quantitySlug" | "convert"> {
  const normalized = normalizeUnit(unit);
  const identity = (value: number) => value;
  if (normalized === "RPM") return { quantitySlug: "engine-speed", convert: identity };
  if (normalized === "%") return { quantitySlug: "percentage", convert: identity };
  if (normalized === "°C") return { quantitySlug: "temperature", convert: identity };
  if (normalized === "°F") return { quantitySlug: "temperature", convert: (value) => (value - 32) * 5 / 9 };
  if (normalized === "K") return { quantitySlug: "temperature", convert: (value) => value - 273.15 };
  if (["kPa", "bar", "mbar", "psi", "inHg"].includes(normalized)) {
    const absolute = isAbsolutePressure(name);
    return {
      quantitySlug: "pressure",
      convert: (value) => {
        let kpa: number;
        if (normalized === "bar") kpa = value * 100;
        else if (normalized === "mbar") kpa = value / 10;
        else if (normalized === "psi") kpa = value * 6.894757293;
        else if (normalized === "inHg") kpa = (/\bvac\b/i.test(name) ? -1 : 1) * value * 3.386389;
        else kpa = value;
        return absolute ? kpa - 101.3 : kpa;
      },
    };
  }
  if (normalized === "km/h") return { quantitySlug: "speed", convert: identity };
  if (normalized === "mph") return { quantitySlug: "speed", convert: (value) => value * 1.609344 };
  if (normalized === "m/s") return { quantitySlug: "speed", convert: (value) => value * 3.6 };
  if (normalized === "AFR") return { quantitySlug: "afr", convert: (value) => value / 14.7 };
  if (normalized === "λ") return { quantitySlug: "afr", convert: identity };
  if (normalized === "V") return { quantitySlug: "voltage", convert: identity };
  if (normalized === "mV") return { quantitySlug: "voltage", convert: (value) => value / 1000 };
  if (normalized === "°") return { quantitySlug: "angle", convert: identity };
  if (normalized === "ms") return { quantitySlug: "time-ms", convert: identity };
  if (normalized === "s") return { quantitySlug: "time-s", convert: identity };
  if (normalized === "g" && /acc|lateral|longitudinal|x_|y_|z_/i.test(name)) {
    return { quantitySlug: "acceleration", convert: (value) => value * 9.80665 };
  }
  if (normalized === "°/s") return { quantitySlug: "angular-velocity", convert: identity };
  return { convert: identity };
}

function buildUniqueRaceChronoNames(headers: string[], sources: string[]): string[] {
  const counts = new Map<string, number>();
  headers.forEach((header) => counts.set(header.toLowerCase(), (counts.get(header.toLowerCase()) ?? 0) + 1));
  const used = new Map<string, number>();
  return headers.map((header, index) => {
    if ((counts.get(header.toLowerCase()) ?? 0) <= 1) return header;
    const source = (sources[index] ?? "").replace(/^\d+\s*:\s*/, "").trim();
    const base = source ? `${header} (${source})` : header;
    const seen = used.get(base.toLowerCase()) ?? 0;
    used.set(base.toLowerCase(), seen + 1);
    return seen === 0 ? base : `${base} ${seen + 1}`;
  });
}

function channelInfo(rawHeader: string, explicitUnit: string, format: TextFormat): ChannelInfo {
  const parsed = splitHeader(rawHeader);
  const path = parsed.name.trim();
  const sourceName = format === "ECUMaster" ? path.slice(path.lastIndexOf("/") + 1) : path;
  const name = normalizeName(sourceName);
  const unit = normalizeUnit(explicitUnit || parsed.unit || inferUnit(`${path} ${name}`, format));
  return { name, path: path !== name ? path : undefined, unit, ...quantityAndConverter(`${path} ${name}`, unit) };
}

function normalizeTimes(rawTimes: number[], mode: TimeMode): number[] {
  if (rawTimes.length === 0) return [];
  if (mode === "dynamic-runtime") {
    const result = new Array<number>(rawTimes.length);
    let dayOffset = 0;
    let previous = rawTimes[0];
    let i = 0;
    while (i < rawTimes.length) {
      const raw = rawTimes[i];
      if (raw + 1 < previous) dayOffset += previous + 1;
      previous = raw;
      let end = i + 1;
      while (end < rawTimes.length && rawTimes[end] === raw) end++;
      const count = end - i;
      for (let j = 0; j < count; j++) result[i + j] = raw + dayOffset + j / count;
      i = end;
    }
    const base = result[0];
    return result.map((time) => time - base);
  }
  let dayOffset = 0;
  const adjusted = rawTimes.map((raw, index) => {
    if (mode === "clock" && index > 0 && raw + dayOffset + 1 < (rawTimes[index - 1] + dayOffset)) dayOffset += 86400;
    return raw + dayOffset;
  });
  // TunerStudio occasionally writes ECU uptime into its first row, then
  // switches to the actual log clock on row two.
  if (adjusted.length > 1 && adjusted[0] > adjusted[1]) {
    const base = adjusted[1];
    return adjusted.map((time, index) => index === 0 ? 0 : time - base);
  }
  const base = adjusted[0];
  return adjusted.map((time) => time - base);
}

function startTimeFor(layout: TextLayout, rawTimes: number[]): Date {
  if (layout.timeMode === "date" && rawTimes.length > 0) return new Date(rawTimes[0] * 1000);
  if (layout.format === "RaceChrono" && rawTimes.length > 0 && rawTimes[0] > 1_000_000_000) {
    return new Date(rawTimes[0] * 1000);
  }
  const date = layout.metadata.Date ?? layout.metadata.Created ?? layout.metadata.StartTime;
  const parsed = date ? Date.parse(date.replace(/,/g, " ")) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : new Date(0);
}

export function detectTextLog(text: string): TextFormat | null {
  const normalized = text.replace(/^\uFEFF/, "");
  return detectLayout(normalized, normalized.split(/\r?\n/))?.format ?? null;
}

/** Parse the interoperable CSV/text ECU formats documented by UltraLog. */
export function parseTextLog(text: string): ParsedLog {
  const normalized = text.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  const layout = detectLayout(normalized, lines);
  if (!layout) throw new Error("Unsupported ECU log format");

  const headers = parseDelimitedLine(lines[layout.headerIndex], layout.delimiter);
  const unitFields = layout.unitsIndex !== undefined
    ? parseDelimitedLine(lines[layout.unitsIndex] ?? "", layout.delimiter)
    : [];
  const sourceFields = layout.sourcesIndex !== undefined
    ? parseDelimitedLine(lines[layout.sourcesIndex] ?? "", layout.delimiter)
    : [];

  let displayHeaders = headers.slice();
  if (layout.format === "RaceChrono") {
    displayHeaders = buildUniqueRaceChronoNames(headers, sourceFields);
  }

  const columnIndexes: number[] = [];
  const infos: ChannelInfo[] = [];
  for (let index = layout.channelStart; index < headers.length; index++) {
    if (index === layout.timeIndex || layout.skipColumns?.has(index) || !headers[index]?.trim()) continue;
    columnIndexes.push(index);
    infos.push(channelInfo(displayHeaders[index], unitFields[index] ?? "", layout.format));
  }
  if (infos.length === 0) throw new Error(`${layout.format} log has no channels`);

  // Keep channel names unique even after normalizing familiar aliases such as
  // RPM and MAP. The original header remains in `path` for traceability.
  const names = new Map<string, number>();
  for (const info of infos) {
    const key = info.name.toLowerCase();
    const count = names.get(key) ?? 0;
    names.set(key, count + 1);
    if (count > 0) info.name = `${info.name} ${count + 1}`;
  }

  const rawTimes: number[] = [];
  const columns = infos.map(() => [] as number[]);
  const lastValues = infos.map(() => Number.NaN);
  const dataStart = Math.max(layout.headerIndex, layout.unitsIndex ?? 0, layout.sourcesIndex ?? 0) + 1;
  let previousTime = Number.NEGATIVE_INFINITY;

  for (let lineIndex = dataStart; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    if (!line) continue;
    const fields = parseDelimitedLine(line, layout.delimiter);
    const rawTime = parseTime(fields[layout.timeIndex] ?? "", layout.timeMode, layout.decimalComma ?? false);
    if (!Number.isFinite(rawTime)) continue;
    if (
      layout.format !== "MegaSquirt / TunerStudio" &&
      layout.timeMode !== "dynamic-runtime" &&
      layout.timeMode !== "clock" &&
      rawTime < previousTime
    ) continue;
    previousTime = rawTime;

    rawTimes.push(rawTime);
    for (let channelIndex = 0; channelIndex < infos.length; channelIndex++) {
      const raw = parseNumeric(fields[columnIndexes[channelIndex]] ?? "", layout.decimalComma ?? false);
      let value = raw;
      if (!Number.isFinite(value) && layout.sparse) value = lastValues[channelIndex];
      if (Number.isFinite(value)) lastValues[channelIndex] = value;
      columns[channelIndex].push(Number.isFinite(value) ? infos[channelIndex].convert(value) : Number.NaN);
    }
  }
  if (rawTimes.length === 0) throw new Error(`${layout.format} log has no data rows`);

  const times = normalizeTimes(rawTimes, layout.timeMode);
  const timestamps = Float64Array.from(times);
  const channels = new Map<string, Float64Array>();
  const channelDefs: ChannelDef[] = infos.map((info, index) => {
    const values = Float64Array.from(columns[index]);
    channels.set(info.name, values);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return {
      name: info.name,
      id: 0,
      type: info.unit || layout.format,
      unit: info.unit || undefined,
      displayMin: Number.isFinite(min) ? min : 0,
      displayMax: Number.isFinite(max) ? max : 0,
      index,
      quantitySlug: info.quantitySlug,
      path: info.path,
    };
  });

  return {
    format: layout.format,
    metadata: layout.metadata,
    channelDefs,
    sessions: [{
      label: layout.format,
      startTime: startTimeFor(layout, rawTimes),
      timestamps,
      channels,
      channelStatus: EMPTY_STATUS(),
      rowCount: timestamps.length,
    }],
  };
}

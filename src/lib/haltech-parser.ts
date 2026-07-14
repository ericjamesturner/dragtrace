import type { ParsedLog, ChannelDef, LogSession } from './log-types';

// --- Type conversions ---

interface ChannelTypeInfo {
  unit: string;
  convert: (raw: number) => number;
}

const identity = (x: number) => x;

const channelTypes: Record<string, ChannelTypeInfo> = {
  EngineSpeed:      { unit: 'RPM',    convert: identity },
  Pressure:         { unit: 'kPa',    convert: (x) => x / 10 - 101.3 },
  AbsPressure:      { unit: 'kPa',    convert: (x) => x / 10 },
  Temperature:      { unit: 'K',      convert: (x) => x / 10 },
  BatteryVoltage:   { unit: 'V',      convert: (x) => x / 1000 },
  AFR:              { unit: 'lambda', convert: (x) => x / 1000 },
  Speed:            { unit: 'km/h',   convert: (x) => x / 10 },
  Percentage:       { unit: '%',      convert: (x) => x / 10 },
  Angle:            { unit: 'deg',    convert: (x) => x / 10 },
  Decibel:          { unit: 'dB',     convert: (x) => x / 100 },
  Time_us:          { unit: 'ms',     convert: (x) => x / 1000 },
  Time_ms:          { unit: 'ms',     convert: identity },
  Time_ms_as_s:     { unit: 's',      convert: (x) => x / 1000 },
  Gear:             { unit: '',       convert: identity },
  Raw:              { unit: '',       convert: identity },
  GearRatio:        { unit: '',       convert: (x) => x / 100 },
  Ratio:            { unit: '',       convert: (x) => x / 100 },
  Flow:             { unit: 'cc/min', convert: identity },
  Frequency:        { unit: 'Hz',     convert: identity },
  DrivenDistance:    { unit: 'km',     convert: identity },
  MassPerCyl:       { unit: 'mg',     convert: identity },
  Current:          { unit: 'A',      convert: (x) => x / 1000 },
  Acceleration:     { unit: 'm/s^2',  convert: (x) => x / 10 },
  InjFuelVolume:    { unit: 'cc',     convert: identity },
};

const SENTINEL_THRESHOLD = -2147483600;

function convertRawValue(raw: number, type: string): number {
  if (raw <= SENTINEL_THRESHOLD) return NaN;
  const info = channelTypes[type];
  return info ? info.convert(raw) : raw;
}

// Enum mappings
const channelEnums: Record<string, Record<number, string>> = {
  'Engine Limiting Method': {
    0: 'None', 1: 'Fuel', 2: 'Ignition',
  },
  'Engine Limiting Function': {
    0: 'None', 1: 'Immobiliser', 2: 'Map version error',
    3: 'Electronic throttle error', 4: 'Electronic throttle redundancy error',
    5: 'Decel cut', 6: 'Over boost cut', 7: 'Ignition switch',
    8: 'Anti-flood', 9: 'Limp mode', 10: 'Rotational idle',
    11: 'Launch control', 12: 'Torque reduction', 13: 'Flat shift',
    14: 'Aux limiter', 15: 'Main limiter', 16: 'Speed limiter',
    17: 'Supervisor error', 18: 'Turbo Timer', 19: 'Engine Protection',
    20: 'Flood Clear', 21: 'Diagnostic trouble code', 22: 'LPG',
    23: 'Kill Switch', 24: 'Traction Control', 25: 'Rolling Anti-lag',
    26: 'Torque Management DS RPM', 27: 'Trans-Brake Control',
    28: 'Injection System Error', 29: 'Main Setup (F4) Page Error',
    30: 'Injection System Disable', 31: 'Torque Model',
    32: 'Start/Stop Button', 33: 'Throttle Blip', 34: 'IMU Calibration',
  },
};

function getChannelEnumValues(channelName: string): Record<number, string> | undefined {
  return channelEnums[channelName];
}

// --- Parser ---

function timeStrToMs(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const secParts = parts[2].split('.');
  const seconds = parseInt(secParts[0], 10);
  const millis = parseInt(secParts[1], 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000 + millis;
}

function parseSessionDateTime(dateStr: string): Date {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  const timeParts = dateStr.substring(9).split(':');
  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = parseInt(timeParts[2], 10);
  return new Date(year, month, day, hours, minutes, seconds);
}

export function detectHaltech(content: string): boolean {
  return content.startsWith('%DataLog%');
}

/**
 * Find the sample index where the race timer starts counting for the run.
 *
 * The timer holds a stale value from a previous run until it is re-armed
 * (reset to 0), gets triggered by burnouts and staging blips before the
 * actual pass, and can even jump straight from 0 back to a stale constant.
 * A real start is a 0 -> positive transition after which the timer keeps
 * counting up; the run is the last such start in the log. Falls back to
 * index 0 when the timer is already counting up from the first sample
 * (log starts mid-run); returns null when it never starts counting.
 */
export function detectRaceStartIndex(raceTimer: ArrayLike<number>): number | null {
  let lastStart: number | null = null;
  let armed = false;
  for (let i = 0; i < raceTimer.length; i++) {
    const v = raceTimer[i];
    if (v === 0) {
      armed = true;
    } else if (v > 0 && armed) {
      let counting = false;
      for (let j = i + 1; j < raceTimer.length; j++) {
        const w = raceTimer[j];
        if (Number.isNaN(w)) continue;
        if (w <= 0 || w < v) break;
        if (w > v) {
          counting = true;
          break;
        }
      }
      if (counting) lastStart = i;
      armed = false;
    }
  }
  if (lastStart !== null) return lastStart;
  if (raceTimer.length > 1 && raceTimer[0] > 0 && raceTimer[raceTimer.length - 1] > raceTimer[0]) {
    return 0;
  }
  return null;
}

export function parseHaltech(content: string): ParsedLog {
  const lines = content.split('\n');
  const metadata: Record<string, string> = {};
  const channelDefs: ChannelDef[] = [];
  const sessions: LogSession[] = [];
  const logNumbers: string[] = [];

  let lineIdx = 0;

  if (lines[lineIdx]?.trim() === '%DataLog%') lineIdx++;

  let currentChannel: Partial<ChannelDef> | null = null;
  let currentType = '';
  let channelIndex = 0;

  while (lineIdx < lines.length) {
    const line = lines[lineIdx].trim();

    if (line.startsWith('Log :') || line.startsWith('Log Source') || line.startsWith('Log Number')) {
      if (line.startsWith('Log Source') || line.startsWith('Log Number')) {
        const [key, val] = line.split(' : ');
        metadata[key.trim()] = val?.trim() ?? '';
        if (line.startsWith('Log Number') && val) logNumbers.push(val.trim());
        lineIdx++;
        continue;
      }
      if (currentChannel?.name) {
        const enumValues = getChannelEnumValues(currentChannel.name);
        channelDefs.push({
          name: currentChannel.name,
          id: currentChannel.id ?? 0,
          type: currentType,
          displayMax: currentChannel.displayMax ?? 0,
          displayMin: currentChannel.displayMin ?? 0,
          index: channelIndex++,
          metricUnit: channelTypes[currentType]?.unit,
          ...(enumValues && { enumValues }),
        });
      }
      break;
    }

    if (line.startsWith('Channel :')) {
      if (currentChannel?.name) {
        const enumValues = getChannelEnumValues(currentChannel.name);
        channelDefs.push({
          name: currentChannel.name,
          id: currentChannel.id ?? 0,
          type: currentType,
          displayMax: currentChannel.displayMax ?? 0,
          displayMin: currentChannel.displayMin ?? 0,
          index: channelIndex++,
          metricUnit: channelTypes[currentType]?.unit,
          ...(enumValues && { enumValues }),
        });
      }
      currentChannel = { name: line.substring(10).trim() };
      currentType = '';
    } else if (line.startsWith('ID :')) {
      if (currentChannel) currentChannel.id = parseInt(line.substring(5).trim(), 10);
    } else if (line.startsWith('Type :')) {
      currentType = line.substring(7).trim();
    } else if (line.startsWith('DisplayMaxMin :')) {
      const vals = line.substring(16).trim().split(',');
      if (currentChannel) {
        currentChannel.displayMax = parseInt(vals[0], 10);
        currentChannel.displayMin = parseInt(vals[1], 10);
      }
    } else if (line.includes(' : ')) {
      const colonIdx = line.indexOf(' : ');
      const key = line.substring(0, colonIdx).trim();
      const val = line.substring(colonIdx + 3).trim();
      metadata[key] = val;
    }

    lineIdx++;
  }

  const numChannels = channelDefs.length;
  const channelTypesList = channelDefs.map(ch => ch.type);

  // Haltech NSP can split one continuous recording into several "Log :" blocks
  // (consecutive Log Numbers); blocks whose data continues within MERGE_GAP_MS
  // of the previous block are merged into a single session.
  const MERGE_GAP_MS = 1000;

  const blocks: {
    startTime: Date;
    absMs: number[];
    rows: number[][];
    firstBlock: number;
    lastBlock: number;
  }[] = [];
  let blockCount = 0;

  while (lineIdx < lines.length) {
    const line = lines[lineIdx].trim();

    if (line.startsWith('Log :')) {
      const dateStr = line.substring(6).trim();
      const startTime = parseSessionDateTime(dateStr);

      lineIdx++;
      const absMs: number[] = [];
      const rows: number[][] = [];

      while (lineIdx < lines.length) {
        const dataLine = lines[lineIdx].trim();
        if (dataLine.startsWith('Log :') || dataLine === '') {
          if (dataLine === '') {
            lineIdx++;
            continue;
          }
          break;
        }

        const commaIdx = dataLine.indexOf(',');
        if (commaIdx === -1) {
          lineIdx++;
          continue;
        }

        absMs.push(timeStrToMs(dataLine.substring(0, commaIdx)));

        const values = dataLine.substring(commaIdx + 1).split(',');
        const row: number[] = new Array(numChannels);
        for (let i = 0; i < numChannels; i++) {
          const raw = parseInt(values[i], 10);
          row[i] = convertRawValue(raw, channelTypesList[i]);
        }
        rows.push(row);

        lineIdx++;
      }

      const blockIdx = blockCount++;
      if (absMs.length === 0) continue;

      const prev = blocks[blocks.length - 1];
      const gap = prev ? absMs[0] - prev.absMs[prev.absMs.length - 1] : Infinity;
      if (prev && gap >= 0 && gap <= MERGE_GAP_MS) {
        prev.absMs = prev.absMs.concat(absMs);
        prev.rows = prev.rows.concat(rows);
        prev.lastBlock = blockIdx;
      } else {
        blocks.push({ startTime, absMs, rows, firstBlock: blockIdx, lastBlock: blockIdx });
      }
    } else {
      lineIdx++;
    }
  }

  for (const block of blocks) {
    const rowCount = block.absMs.length;
    const baseMs = block.absMs[0];
    const timestamps = new Float64Array(rowCount);
    for (let r = 0; r < rowCount; r++) {
      timestamps[r] = (block.absMs[r] - baseMs) / 1000;
    }

    const channels = new Map<string, Float64Array>();
    for (let chIdx = 0; chIdx < numChannels; chIdx++) {
      const arr = new Float64Array(rowCount);
      for (let r = 0; r < rowCount; r++) {
        arr[r] = block.rows[r][chIdx];
      }
      channels.set(channelDefs[chIdx].name, arr);
    }

    const firstNum = logNumbers[block.firstBlock];
    const lastNum = logNumbers[block.lastBlock];
    const label = firstNum
      ? block.lastBlock > block.firstBlock && lastNum
        ? `Log ${firstNum}–${lastNum}`
        : `Log ${firstNum}`
      : `Session ${sessions.length + 1}`;

    sessions.push({
      label,
      startTime: block.startTime,
      timestamps,
      channels,
      rowCount,
    });
  }

  return {
    format: 'Haltech',
    metadata,
    channelDefs,
    sessions,
  };
}

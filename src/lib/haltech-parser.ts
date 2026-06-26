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

export function parseHaltech(content: string): ParsedLog {
  const lines = content.split('\n');
  const metadata: Record<string, string> = {};
  const channelDefs: ChannelDef[] = [];
  const sessions: LogSession[] = [];

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

  while (lineIdx < lines.length) {
    const line = lines[lineIdx].trim();

    if (line.startsWith('Log :')) {
      const dateStr = line.substring(6).trim();
      const startTime = parseSessionDateTime(dateStr);

      lineIdx++;
      const rowTimestamps: number[] = [];
      const rowData: number[][] = [];
      let baseMs = -1;

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

        const timeStr = dataLine.substring(0, commaIdx);
        const ms = timeStrToMs(timeStr);
        if (baseMs === -1) baseMs = ms;
        rowTimestamps.push((ms - baseMs) / 1000);

        const values = dataLine.substring(commaIdx + 1).split(',');
        const row: number[] = new Array(numChannels);
        for (let i = 0; i < numChannels; i++) {
          const raw = parseInt(values[i], 10);
          row[i] = convertRawValue(raw, channelTypesList[i]);
        }
        rowData.push(row);

        lineIdx++;
      }

      if (rowTimestamps.length === 0) continue;

      const timestamps = new Float64Array(rowTimestamps);
      const channels = new Map<string, Float64Array>();

      for (let chIdx = 0; chIdx < numChannels; chIdx++) {
        const arr = new Float64Array(rowTimestamps.length);
        for (let r = 0; r < rowTimestamps.length; r++) {
          arr[r] = rowData[r][chIdx];
        }
        channels.set(channelDefs[chIdx].name, arr);
      }

      const logNum = metadata['Log Number'] ?? '';
      const sessionIdx = sessions.length + 1;
      const label = logNum
        ? `Log ${parseInt(logNum, 10) + sessions.length}`
        : `Session ${sessionIdx}`;

      sessions.push({
        label,
        startTime,
        timestamps,
        channels,
        rowCount: rowTimestamps.length,
      });
    } else {
      lineIdx++;
    }
  }

  return {
    format: 'Haltech',
    metadata,
    channelDefs,
    sessions,
  };
}

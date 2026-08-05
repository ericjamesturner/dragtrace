export type UnitSystem = 'imperial' | 'metric';

export interface UnitOption {
  key: string;
  label: string;
  unit: string;
  convert: (v: number) => number;
  /** Inverse of convert: display units -> raw metric units. */
  invert: (v: number) => number;
}

const identity = (v: number) => v;

// cc/min -> lb/hr: v (cc/min) * density (g/cc) * 60 (min/hr) / 453.592 (g/lb)
const ccMinToLbHr = (density: number) => (v: number) => v * density * 60 / 453.592;
const lbHrToCcMin = (density: number) => (v: number) => v * 453.592 / 60 / density;
const GAS_DENSITY = 0.743;
const E85_DENSITY = 0.781;
const METH_DENSITY = 0.7918;

export const UNIT_OPTIONS: Record<string, UnitOption[]> = {
  lambda: [
    { key: 'lambda', label: 'Lambda', unit: 'λ', convert: identity, invert: identity },
    { key: 'afr_gas', label: 'AFR Gas', unit: 'AFR', convert: (v) => v * 14.7, invert: (v) => v / 14.7 },
    { key: 'afr_e85', label: 'AFR E85', unit: 'AFR E85', convert: (v) => v * 9.765, invert: (v) => v / 9.765 },
    { key: 'afr_meth', label: 'AFR Meth', unit: 'AFR Meth', convert: (v) => v * 6.46, invert: (v) => v / 6.46 },
    { key: 'afr_diesel', label: 'AFR Diesel', unit: 'AFR Diesel', convert: (v) => v * 14.5, invert: (v) => v / 14.5 },
  ],
  kPa: [
    { key: 'psi', label: 'PSI', unit: 'PSI', convert: (v) => v * 0.145038, invert: (v) => v / 0.145038 },
    { key: 'kpa', label: 'kPa', unit: 'kPa', convert: identity, invert: identity },
    { key: 'bar', label: 'bar', unit: 'bar', convert: (v) => v / 100, invert: (v) => v * 100 },
    { key: 'inhg', label: 'inHg', unit: 'inHg', convert: (v) => v * 0.2953, invert: (v) => v / 0.2953 },
  ],
  K: [
    { key: 'F', label: '°F', unit: '°F', convert: (v) => (v - 273.15) * 9 / 5 + 32, invert: (v) => (v - 32) * 5 / 9 + 273.15 },
    { key: 'C', label: '°C', unit: '°C', convert: (v) => v - 273.15, invert: (v) => v + 273.15 },
    { key: 'K', label: 'K', unit: 'K', convert: identity, invert: identity },
  ],
  'km/h': [
    { key: 'mph', label: 'mph', unit: 'mph', convert: (v) => v * 0.621371, invert: (v) => v / 0.621371 },
    { key: 'kmh', label: 'km/h', unit: 'km/h', convert: identity, invert: identity },
  ],
  km: [
    { key: 'mi', label: 'mi', unit: 'mi', convert: (v) => v * 0.621371, invert: (v) => v / 0.621371 },
    { key: 'km', label: 'km', unit: 'km', convert: identity, invert: identity },
  ],
  'm/s^2': [
    { key: 'g', label: 'g', unit: 'g', convert: (v) => v / 9.80665, invert: (v) => v * 9.80665 },
    { key: 'ms2', label: 'm/s²', unit: 'm/s²', convert: identity, invert: identity },
  ],
  'cc/min': [
    { key: 'ccmin', label: 'cc/min', unit: 'cc/min', convert: identity, invert: identity },
    { key: 'lbhr_gas', label: 'lb/hr Gas', unit: 'lb/hr Gas', convert: ccMinToLbHr(GAS_DENSITY), invert: lbHrToCcMin(GAS_DENSITY) },
    { key: 'lbhr_e85', label: 'lb/hr E85', unit: 'lb/hr E85', convert: ccMinToLbHr(E85_DENSITY), invert: lbHrToCcMin(E85_DENSITY) },
    { key: 'lbhr_meth', label: 'lb/hr Meth', unit: 'lb/hr Meth', convert: ccMinToLbHr(METH_DENSITY), invert: lbHrToCcMin(METH_DENSITY) },
  ],
};

const IMPERIAL_DEFAULTS: Record<string, string> = {
  lambda: 'lambda',
  kPa: 'psi',
  K: 'F',
  'km/h': 'mph',
  km: 'mi',
  'm/s^2': 'g',
  'cc/min': 'ccmin',
};

const METRIC_DEFAULTS: Record<string, string> = {
  lambda: 'lambda',
  kPa: 'kpa',
  K: 'C',
  'km/h': 'kmh',
  km: 'km',
  'm/s^2': 'ms2',
  'cc/min': 'ccmin',
};

export type UnitOverrides = Record<string, string>;

function resolveOption(metricUnit: string, system: UnitSystem, overrides?: UnitOverrides): UnitOption | null {
  const options = UNIT_OPTIONS[metricUnit];
  if (!options) return null;
  const chosenKey = overrides?.[metricUnit]
    ?? (system === 'imperial' ? IMPERIAL_DEFAULTS[metricUnit] : METRIC_DEFAULTS[metricUnit]);
  return options.find(o => o.key === chosenKey) ?? options[0];
}

export function convertForDisplay(value: number, metricUnit: string, system: UnitSystem, overrides?: UnitOverrides): number {
  const opt = resolveOption(metricUnit, system, overrides);
  if (!opt) return value;
  return opt.convert(value);
}

/** Inverse of convertForDisplay: a value typed in display units -> raw metric units. */
export function convertFromDisplay(value: number, metricUnit: string, system: UnitSystem, overrides?: UnitOverrides): number {
  const opt = resolveOption(metricUnit, system, overrides);
  if (!opt) return value;
  return opt.invert(value);
}

export function getDisplayUnit(metricUnit: string, system: UnitSystem, overrides?: UnitOverrides): string {
  const opt = resolveOption(metricUnit, system, overrides);
  if (!opt) return metricUnit;
  return opt.unit;
}

export function cycleUnit(metricUnit: string, system: UnitSystem, overrides: UnitOverrides): UnitOverrides {
  const options = UNIT_OPTIONS[metricUnit];
  if (!options || options.length <= 1) return overrides;
  const current = resolveOption(metricUnit, system, overrides);
  const idx = options.findIndex(o => o.key === current?.key);
  const next = options[(idx + 1) % options.length];
  return { ...overrides, [metricUnit]: next.key };
}

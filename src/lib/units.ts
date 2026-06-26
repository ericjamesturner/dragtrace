export type UnitSystem = 'imperial' | 'metric';

export interface UnitOption {
  key: string;
  label: string;
  unit: string;
  convert: (v: number) => number;
}

const identity = (v: number) => v;

export const UNIT_OPTIONS: Record<string, UnitOption[]> = {
  lambda: [
    { key: 'lambda', label: 'Lambda', unit: 'λ', convert: identity },
    { key: 'afr_gas', label: 'AFR Gas', unit: 'AFR', convert: (v) => v * 14.7 },
    { key: 'afr_e85', label: 'AFR E85', unit: 'AFR E85', convert: (v) => v * 9.765 },
    { key: 'afr_meth', label: 'AFR Meth', unit: 'AFR Meth', convert: (v) => v * 6.46 },
    { key: 'afr_diesel', label: 'AFR Diesel', unit: 'AFR Diesel', convert: (v) => v * 14.5 },
  ],
  kPa: [
    { key: 'psi', label: 'PSI', unit: 'PSI', convert: (v) => v * 0.145038 },
    { key: 'kpa', label: 'kPa', unit: 'kPa', convert: identity },
    { key: 'bar', label: 'bar', unit: 'bar', convert: (v) => v / 100 },
    { key: 'inhg', label: 'inHg', unit: 'inHg', convert: (v) => v * 0.2953 },
  ],
  K: [
    { key: 'F', label: '°F', unit: '°F', convert: (v) => (v - 273.15) * 9 / 5 + 32 },
    { key: 'C', label: '°C', unit: '°C', convert: (v) => v - 273.15 },
    { key: 'K', label: 'K', unit: 'K', convert: identity },
  ],
  'km/h': [
    { key: 'mph', label: 'mph', unit: 'mph', convert: (v) => v * 0.621371 },
    { key: 'kmh', label: 'km/h', unit: 'km/h', convert: identity },
  ],
  km: [
    { key: 'mi', label: 'mi', unit: 'mi', convert: (v) => v * 0.621371 },
    { key: 'km', label: 'km', unit: 'km', convert: identity },
  ],
  'm/s^2': [
    { key: 'g', label: 'g', unit: 'g', convert: (v) => v / 9.80665 },
    { key: 'ms2', label: 'm/s²', unit: 'm/s²', convert: identity },
  ],
};

const IMPERIAL_DEFAULTS: Record<string, string> = {
  lambda: 'lambda',
  kPa: 'psi',
  K: 'F',
  'km/h': 'mph',
  km: 'mi',
  'm/s^2': 'g',
};

const METRIC_DEFAULTS: Record<string, string> = {
  lambda: 'lambda',
  kPa: 'kpa',
  K: 'C',
  'km/h': 'kmh',
  km: 'km',
  'm/s^2': 'ms2',
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

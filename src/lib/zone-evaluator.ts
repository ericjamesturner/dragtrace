import type { LogSession } from "./log-types";

/** Resolve a name used in an expression to an actual channel name */
function resolveChannelName(input: string, channelNames: string[]): string | null {
  if (channelNames.includes(input)) return input;
  const lower = input.toLowerCase();
  for (const name of channelNames) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

/**
 * Evaluate a zone expression against a log session.
 * Returns a Float64Array where 1 = true, 0 = false, NaN = error.
 *
 * Supports:
 * - {Channel Name} references
 * - derivative({Channel Name}) for finite differences
 * - Math helpers: abs, sqrt, pow, min, max, log, log10, floor, ceil, round, PI, E
 */
export function evaluateZoneExpression(
  expression: string,
  session: LogSession,
  convertValue?: (channelName: string, value: number) => number,
): Float64Array {
  const channelNames = [...session.channels.keys()];
  const refs: { resolved: string; varName: string }[] = [];
  const derivativeRefs: { resolved: string; varName: string }[] = [];
  let varIdx = 0;

  // First pass: find derivative({Channel Name}) calls and replace them
  let code = expression.replace(/derivative\(\{([^}]+)\}\)/g, (_, rawName: string) => {
    const name = rawName.trim();
    const resolved = resolveChannelName(name, channelNames);
    if (!resolved) throw new Error(`Channel not found: ${name}`);

    const existing = derivativeRefs.find((r) => r.resolved === resolved);
    if (existing) return existing.varName;

    const varName = `_dch${varIdx++}`;
    derivativeRefs.push({ resolved, varName });
    return varName;
  });

  // Second pass: replace {Channel Name} references
  code = code.replace(/\{([^}]+)\}/g, (_, rawName: string) => {
    const name = rawName.trim();
    const resolved = resolveChannelName(name, channelNames);
    if (!resolved) throw new Error(`Channel not found: ${name}`);

    const existing = refs.find((r) => r.resolved === resolved);
    if (existing) return existing.varName;

    const varName = `_ch${varIdx++}`;
    refs.push({ resolved, varName });
    return varName;
  });

  // Get data arrays
  const arrays = refs.map((r) => {
    const data = session.channels.get(r.resolved);
    if (!data) throw new Error(`Channel not found: ${r.resolved}`);
    return data;
  });

  // Compute derivative arrays: (v[i+1] - v[i]) / (t[i+1] - t[i])
  const ts = session.timestamps;
  const len = ts.length;
  const derivArrays = derivativeRefs.map((r) => {
    const data = session.channels.get(r.resolved);
    if (!data) throw new Error(`Channel not found: ${r.resolved}`);
    const deriv = new Float64Array(len);
    for (let i = 0; i < len - 1; i++) {
      const dt = ts[i + 1] - ts[i];
      if (dt === 0) {
        deriv[i] = 0;
      } else {
        const v0 = convertValue ? convertValue(r.resolved, data[i]) : data[i];
        const v1 = convertValue ? convertValue(r.resolved, data[i + 1]) : data[i + 1];
        deriv[i] = (v1 - v0) / dt;
      }
    }
    if (len > 0) deriv[len - 1] = deriv[len - 2] ?? 0;
    return deriv;
  });

  // Build function
  const allVarNames = [...refs.map((r) => r.varName), ...derivativeRefs.map((r) => r.varName)];
  const helperNames = [
    "abs", "sqrt", "pow", "min", "max", "log", "log10",
    "floor", "ceil", "round", "PI", "E",
  ];
  const fn = new Function(...allVarNames, ...helperNames, `return ${code}`);
  const helpers = [
    Math.abs, Math.sqrt, Math.pow, Math.min, Math.max,
    Math.log, Math.log10, Math.floor, Math.ceil, Math.round,
    Math.PI, Math.E,
  ];

  const result = new Float64Array(len);

  for (let i = 0; i < len; i++) {
    const channelValues = convertValue
      ? arrays.map((a, ci) => convertValue(refs[ci].resolved, a[i]))
      : arrays.map((a) => a[i]);
    const derivValues = derivArrays.map((a) => a[i]);

    try {
      const v = fn(...channelValues, ...derivValues, ...helpers);
      result[i] = v ? 1 : 0;
    } catch {
      result[i] = NaN;
    }
  }

  return result;
}

/** Validate an expression without computing — returns error message or null */
export function validateZoneExpression(
  expression: string,
  channelNames: string[],
): string | null {
  try {
    let varIdx = 0;
    const varNames: string[] = [];

    // Handle derivative() calls
    let code = expression.replace(/derivative\(\{([^}]+)\}\)/g, (_, rawName: string) => {
      const name = rawName.trim();
      const resolved = resolveChannelName(name, channelNames);
      if (!resolved) throw new Error(`Channel not found: ${name}`);
      const varName = `_dch${varIdx++}`;
      varNames.push(varName);
      return varName;
    });

    // Handle {Channel} refs
    code = code.replace(/\{([^}]+)\}/g, (_, rawName: string) => {
      const name = rawName.trim();
      const resolved = resolveChannelName(name, channelNames);
      if (!resolved) throw new Error(`Channel not found: ${name}`);
      const varName = `_ch${varIdx++}`;
      varNames.push(varName);
      return varName;
    });

    const helperNames = [
      "abs", "sqrt", "pow", "min", "max", "log", "log10",
      "floor", "ceil", "round", "PI", "E",
    ];
    new Function(...varNames, ...helperNames, `return ${code}`);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Scan a boolean mask for contiguous true regions. Returns {start, end} pairs in time. */
export function scanTrueRegions(
  mask: Float64Array,
  timestamps: Float64Array,
  offset: number,
): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = [];
  let inRegion = false;
  let regionStart = 0;

  for (let i = 0; i < mask.length; i++) {
    const isTrue = mask[i] === 1;
    if (isTrue && !inRegion) {
      inRegion = true;
      regionStart = timestamps[i] + offset;
    } else if (!isTrue && inRegion) {
      inRegion = false;
      regions.push({ start: regionStart, end: timestamps[i] + offset });
    }
  }

  if (inRegion && mask.length > 0) {
    regions.push({ start: regionStart, end: timestamps[timestamps.length - 1] + offset });
  }

  return regions;
}

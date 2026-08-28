export interface ChannelSignalFilter {
  kind: "zeroPhaseLowPass";
  /** Exponential smoothing time constant in milliseconds. */
  timeConstantMs: number;
}

const filteredSeriesCache = new WeakMap<
  Float64Array,
  WeakMap<Float64Array, Map<string, Float64Array>>
>();

function filterKey(filter: ChannelSignalFilter): string {
  return `${filter.kind}:${filter.timeConstantMs}`;
}

/**
 * Apply a symmetric exponential kernel to a sampled signal. The forward and
 * backward weighted passes make this zero-phase: peaks may be softened, but
 * they do not move earlier or later on the timeline.
 *
 * The decay is based on elapsed time rather than sample count, so the same
 * setting behaves consistently across logs recorded at different rates.
 * NaNs and large timestamp gaps split the signal into independent segments.
 */
export function applyChannelSignalFilter(
  timestamps: Float64Array,
  values: Float64Array,
  filter?: ChannelSignalFilter,
): Float64Array {
  if (
    !filter ||
    filter.kind !== "zeroPhaseLowPass" ||
    !Number.isFinite(filter.timeConstantMs) ||
    filter.timeConstantMs <= 0 ||
    values.length < 2
  ) {
    return values;
  }

  let byTimestamp = filteredSeriesCache.get(values);
  if (!byTimestamp) {
    byTimestamp = new WeakMap();
    filteredSeriesCache.set(values, byTimestamp);
  }
  let byFilter = byTimestamp.get(timestamps);
  if (!byFilter) {
    byFilter = new Map();
    byTimestamp.set(timestamps, byFilter);
  }
  const key = filterKey(filter);
  const cached = byFilter.get(key);
  if (cached) return cached;

  const length = Math.min(timestamps.length, values.length);
  const output = new Float64Array(values.length);
  output.fill(Number.NaN);
  if (length === 0) {
    byFilter.set(key, output);
    return output;
  }

  const tauSeconds = filter.timeConstantMs / 1000;
  // Do not let a long recording pause pull values across the empty interval.
  // For small filters, one second is already effectively zero weight; for a
  // large custom filter, eight time constants has the same practical effect.
  const resetGapSeconds = Math.max(1, tauSeconds * 8);
  const leftSum = new Float64Array(length);
  const leftWeight = new Float64Array(length);
  const rightSum = new Float64Array(length);
  const rightWeight = new Float64Array(length);

  let segmentActive = false;
  for (let i = 0; i < length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) {
      segmentActive = false;
      continue;
    }
    const dt = i > 0 ? timestamps[i] - timestamps[i - 1] : Number.NaN;
    if (!segmentActive || !Number.isFinite(dt) || dt <= 0 || dt > resetGapSeconds) {
      leftSum[i] = value;
      leftWeight[i] = 1;
    } else {
      const decay = Math.exp(-dt / tauSeconds);
      leftSum[i] = value + decay * leftSum[i - 1];
      leftWeight[i] = 1 + decay * leftWeight[i - 1];
    }
    segmentActive = true;
  }

  segmentActive = false;
  for (let i = length - 1; i >= 0; i--) {
    const value = values[i];
    if (!Number.isFinite(value)) {
      segmentActive = false;
      continue;
    }
    const dt = i + 1 < length ? timestamps[i + 1] - timestamps[i] : Number.NaN;
    if (!segmentActive || !Number.isFinite(dt) || dt <= 0 || dt > resetGapSeconds) {
      rightSum[i] = value;
      rightWeight[i] = 1;
    } else {
      const decay = Math.exp(-dt / tauSeconds);
      rightSum[i] = value + decay * rightSum[i + 1];
      rightWeight[i] = 1 + decay * rightWeight[i + 1];
    }
    segmentActive = true;
  }

  for (let i = 0; i < length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    // The current sample appears in both passes; subtract one copy before
    // normalising the combined symmetric kernel.
    const weight = leftWeight[i] + rightWeight[i] - 1;
    output[i] = weight > 0
      ? (leftSum[i] + rightSum[i] - value) / weight
      : value;
  }

  byFilter.set(key, output);
  return output;
}

// LTTB (Largest Triangle Three Buckets) downsampling

export function lttbDownsample(
  timestamps: Float64Array,
  values: Float64Array,
  threshold: number,
): { timestamps: Float64Array; values: Float64Array } {
  const len = timestamps.length;
  if (len <= threshold) {
    return { timestamps, values };
  }

  const sampledTs = new Float64Array(threshold);
  const sampledVals = new Float64Array(threshold);

  // Always keep first point
  sampledTs[0] = timestamps[0];
  sampledVals[0] = values[0];

  const bucketSize = (len - 2) / (threshold - 2);
  let a = 0;
  let sampledIdx = 1;

  for (let i = 0; i < threshold - 2; i++) {
    const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len);

    const nextBucketStart = Math.floor((i + 2) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, len);

    let avgX = 0, avgY = 0;
    const nextLen = nextBucketEnd - nextBucketStart;
    if (nextLen > 0) {
      for (let j = nextBucketStart; j < nextBucketEnd; j++) {
        avgX += timestamps[j];
        avgY += values[j];
      }
      avgX /= nextLen;
      avgY /= nextLen;
    } else {
      avgX = timestamps[len - 1];
      avgY = values[len - 1];
    }

    let maxArea = -1;
    let maxIdx = bucketStart;
    const aX = timestamps[a];
    const aY = values[a];

    for (let j = bucketStart; j < bucketEnd; j++) {
      const val = values[j];
      if (val !== val) continue; // skip NaN
      const area = Math.abs(
        (aX - avgX) * (val - aY) - (aX - timestamps[j]) * (avgY - aY)
      );
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }

    sampledTs[sampledIdx] = timestamps[maxIdx];
    sampledVals[sampledIdx] = values[maxIdx];
    a = maxIdx;
    sampledIdx++;
  }

  // Always keep last point
  sampledTs[sampledIdx] = timestamps[len - 1];
  sampledVals[sampledIdx] = values[len - 1];

  return { timestamps: sampledTs, values: sampledVals };
}

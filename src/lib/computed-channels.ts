import type { ParsedLog, ChannelDef } from "./log-types";

const BANK_CHANNELS: { name: string; cylinders: number[] }[] = [
  { name: "Bank 1 Average", cylinders: [1, 3, 5, 7] },
  { name: "Bank 2 Average", cylinders: [2, 4, 6, 8] },
];

/**
 * Add computed (math) channels derived from the raw Haltech channels:
 * per-bank wideband O2 averages. NaN-aware — each sample averages whichever
 * cylinders have data. Marked `computed: true` so the UI can distinguish
 * them from real logged channels.
 */
export function addComputedChannels(parsed: ParsedLog): void {
  for (const bank of BANK_CHANNELS) {
    if (parsed.channelDefs.some((d) => d.name === bank.name)) continue;

    const sourceNames = bank.cylinders.map((c) => `Wideband O2 Cylinder ${c}`);
    const sourceDefs = sourceNames
      .map((n) => parsed.channelDefs.find((d) => d.name === n))
      .filter((d): d is ChannelDef => !!d);
    if (sourceDefs.length < 2) continue;

    let hasData = false;
    for (const session of parsed.sessions) {
      const sources = sourceNames
        .map((n) => session.channels.get(n))
        .filter((a): a is Float64Array => !!a);
      if (sources.length < 2) continue;

      const rowCount = session.timestamps.length;
      const avg = new Float64Array(rowCount);
      for (let i = 0; i < rowCount; i++) {
        let sum = 0;
        let count = 0;
        for (const src of sources) {
          const v = src[i];
          if (v === v) {
            sum += v;
            count++;
          }
        }
        avg[i] = count > 0 ? sum / count : NaN;
      }
      session.channels.set(bank.name, avg);
      hasData = true;
    }
    if (!hasData) continue;

    const proto = sourceDefs[0];
    parsed.channelDefs.push({
      name: bank.name,
      id: -1,
      type: proto.type,
      displayMax: proto.displayMax,
      displayMin: proto.displayMin,
      index: parsed.channelDefs.length,
      metricUnit: proto.metricUnit,
      computed: true,
    });
  }
}

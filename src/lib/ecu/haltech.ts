import type { EcuAdapter, ChannelIdentity } from "./types";
import { HALTECH_TYPE_TO_SLUG, normalizeTypeToken } from "./quantities.generated";

/**
 * A channel with no valid reading reports `0x80000000 | code` rather than a
 * number. Read as a signed 32-bit int that is a large negative value, so the
 * floor sits just above the most negative one; `0x7FFFFFFF` is also reserved.
 */
export const STATUS_FLOOR = -2147483600;
export const STATUS_MAX = 2147483647;

export function isStatusValue(raw: number): boolean {
  return raw <= STATUS_FLOOR || raw === STATUS_MAX;
}

/** Recover the status code from a sentinel value. */
export function statusCodeOf(raw: number): number {
  if (raw === STATUS_MAX) return 0;
  // 0x80000000 | code, read as a signed int.
  return raw - -2147483648;
}

/**
 * Status code names. Haltech's definition files carry these per channel; until
 * a definition pack is loaded these are the codes common to every ECU we've
 * seen, so a fault reads as a reason rather than a blank gap.
 */
const STATUS_LABELS: Record<number, string> = {
  1: "No Data",
  2: "No Signal",
  3: "Open Circuit",
  4: "Short Circuit",
  5: "Short To Ground",
  6: "Short To Battery",
  7: "Out Of Range",
  8: "Calibrating",
  9: "Not Calibrated",
  10: "Error",
  11: "Not Installed",
  12: "Disabled",
  13: "Not Ready",
  14: "Free Air",
  15: "Sensor Cold",
  16: "Heater Open Circuit",
  17: "Heater Short Circuit",
  18: "Engine Stopped",
  19: "Uncalibrated - No Free Air Calibration",
  20: "Decalibration (sensor changed)",
};

export const haltechAdapter: EcuAdapter = {
  ecuType: "haltech",
  displayName: "Haltech",

  quantitySlugForType(typeToken: string): string | undefined {
    return HALTECH_TYPE_TO_SLUG[normalizeTypeToken(typeToken)];
  },

  identifyChannel(): ChannelIdentity | undefined {
    // Filled in by the definition-pack join; without a pack we have only what
    // the log itself carries.
    return undefined;
  },

  statusLabel(code: number): string | undefined {
    return STATUS_LABELS[code];
  },
};

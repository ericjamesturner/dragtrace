import type { EcuAdapter, ChannelIdentity } from "./types";
import { HALTECH_TYPE_TO_SLUG, normalizeTypeToken } from "./quantities.generated";

/**
 * A channel with no valid reading reports `0x80000000 | code` rather than a
 * number. Read as a signed 32-bit int that is a large negative value, so the
 * floor sits just above the most negative one; `0x7FFFFFFF` is also reserved.
 */
export const STATUS_FLOOR = -2147483000;
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
  0: "No Signal",
  1: "Calibrating",
  2: "No I/O",
  3: "Not Calibrated",
  4: "Device Time Out",
  5: "Error",
  6: "Battery Low",
  7: "Battery High",
  8: "Short Circuit",
  9: "Open Circuit",
  10: "Sensor Cold",
  11: "Free Air",
  12: "Heater Short Circuit",
  13: "Condensation Phase",
  14: "Controller Inactive",
  15: "Min Error",
  16: "Max Error",
  17: "Engine Stopped",
  18: "Condition Not Met",
  19: "Error in source channel",
  20: "Not In Use",
  21: "Heap Error",
  22: "Heater Open Circuit",
  23: "Calibration Failure",
  24: "Decalibration (sensor changed)",
  25: "I/O Error",
  26: "File Access",
  27: "No Current Monitoring",
  28: "Uninitialised",
  29: "Invalid Signal Type",
  30: "Setting has invalid value",
  31: "No Signal",
  32: "Signal Not Supported",
  33: "Connection Configured on Dash",
  34: "Stopped",
  35: "Uncalibrated - Calibration Resistor Error",
  36: "Uncalibrated - Calibration Resistor Changed",
  37: "Uncalibrated - No Free Air Calibration",
  38: "Uncalibrated - Free Air Calibration Too High",
  39: "Uncalibrated - Free Air Calibration Too Low",
  40: "Connection Conflicts with Dash",
  41: "Connection Conflicts with Dash",
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

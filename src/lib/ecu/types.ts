export type UnitSystem = 'imperial' | 'metric';

/**
 * One way of displaying a quantity. `scale`/`offset` convert from the raw
 * integer the ECU logs: `display = raw * scale + offset`.
 */
export interface UnitAlternate {
  key: string;
  label: string;
  /** Decimal places this unit is conventionally shown to. */
  dp: number;
  scale: number;
  offset: number;
}

/**
 * Something measurable — pressure, temperature, air/fuel ratio — independent of
 * which ECU logged it. Channels reference a quantity by slug, and a user's unit
 * preference is stored per quantity, so choosing psi applies to every pressure
 * channel from every vendor.
 */
export interface Quantity {
  slug: string;
  name: string;
  /** Vendor unit-type id this was derived from; for tracing only. */
  sourceId?: number;
  alternates: UnitAlternate[];
  metricKey: string;
  imperialKey: string;
}

/** Per-channel identity resolved from a vendor's definition data. */
export interface ChannelIdentity {
  /** Full human name, e.g. "Injection Stage 2 Average Duty Cycle". */
  longName?: string;
  /** Compact name for legends, e.g. "InjStg2 AvgDC". */
  shortName?: string;
  /** Vendor's own description, for tooltips. */
  description?: string;
  /** Canonical path, e.g. "Settings/InjectionSystem/STAGE_1/AVERAGE_DUTY_CYCLE". */
  path?: string;
  /** Enumerated value labels, e.g. { 0: "Off", 1: "On" }. */
  enumValues?: Record<number, string>;
}

/**
 * Everything vendor-specific about reading one manufacturer's logs. Adding a
 * new ECU means implementing this and registering it — nothing outside
 * `src/lib/ecu/` should branch on which vendor produced a log.
 */
export interface EcuAdapter {
  /** Stable key, also used as the `ecuType` column in Convex. */
  ecuType: string;
  displayName: string;
  /** Map a vendor channel-type token to a quantity slug. */
  quantitySlugForType(typeToken: string): string | undefined;
  /** Resolve a channel's identity from the vendor's definition data. */
  identifyChannel(channelId: number, channelName: string): ChannelIdentity | undefined;
  /** Label for a sensor-fault status code, e.g. 12 -> "Open Circuit". */
  statusLabel(code: number, channelId?: number): string | undefined;
}

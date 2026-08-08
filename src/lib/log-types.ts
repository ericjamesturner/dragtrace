export interface ChannelDef {
  name: string;
  id: number;
  type: string;
  displayMax: number;
  displayMin: number;
  index: number;
  quantitySlug?: string;
  enumValues?: Record<number, string>;
  /** Derived math channel (computed client-side, not logged by the ECU). */
  computed?: boolean;
  // --- Filled in from the ECU definition pack, when one is available ---
  /** The manufacturer's description of this channel, for tooltips. */
  description?: string;
  /** Compact name for legends, e.g. "InjStg2 AvgDC". */
  shortName?: string;
  /** Position in the ECU's own hierarchy. */
  path?: string;
  /** Fault-code names for this specific channel, keyed by status code. */
  statusLabels?: Record<number, string>;
  /** Values meaning "not applicable" — excluded from the plotted series. */
  sentinels?: number[];
}

/** Summary of the sensor faults a channel reported over one session. */
export interface ChannelStatus {
  /** How many samples were a fault rather than a reading. */
  samples: number;
  rowCount: number;
  dominantCode: number;
  dominantLabel?: string;
  codes: number[];
}

export interface LogSession {
  label: string;
  startTime: Date;
  timestamps: Float64Array;
  channels: Map<string, Float64Array>;
  /** Only channels that reported at least one fault appear here. */
  channelStatus: Map<string, ChannelStatus>;
  rowCount: number;
}

export interface ParsedLog {
  format: string;
  metadata: Record<string, string>;
  channelDefs: ChannelDef[];
  sessions: LogSession[];
}

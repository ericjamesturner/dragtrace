export interface ChannelDef {
  name: string;
  id: number;
  type: string;
  displayMax: number;
  displayMin: number;
  index: number;
  metricUnit?: string;
  enumValues?: Record<number, string>;
}

export interface LogSession {
  label: string;
  startTime: Date;
  timestamps: Float64Array;
  channels: Map<string, Float64Array>;
  rowCount: number;
}

export interface ParsedLog {
  format: string;
  metadata: Record<string, string>;
  channelDefs: ChannelDef[];
  sessions: LogSession[];
}

import type { PageConfig } from "./viewer-types";
import type { ParsedLog } from "./log-types";
import type { Id } from "../../convex/_generated/dataModel";
import { cylinderChannels, isCheckedLevel, readBoost, readLevels, readLimiter, targetChannel, wideOpenEnd } from "./anomalies";

/**
 * A Health value clicked on the run sheet, handed to the viewer: which pass,
 * which channels, and which stretch of the run to show. The viewer opens it
 * as a temporary page and never saves it. Passed through session storage
 * rather than the URL, which the app rewrites on every navigation — and a
 * reload dropping a one-off look is fine.
 */
export interface HealthFocus {
  fileId: string;
  /** The tab's name: "Fuel Pressure", "Lean spike". */
  label: string;
  /** Channels by name. */
  channels?: string[];
  /** Per-cylinder sensors by label ("C5", "B2"), or every one in the group. */
  cylinders?: { kind: "lambda" | "egt"; labels: string[] | "all"; withTarget?: boolean };
  /** Seconds after the launch to show, and the moment to mark. */
  from: number;
  to: number;
  at?: number;
}

const KEY = "dragtrace.healthFocus";

export function setHealthFocus(focus: HealthFocus) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(focus));
  } catch {
    // Blocked storage: the log still opens, just without the focus.
  }
}

/**
 * The focus waiting for one of `fileIds`. Reading leaves it in place (a React
 * initializer can run twice); clearHealthFocus drops it once it's been used.
 */
export function readHealthFocus(fileIds: string[]): HealthFocus | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const focus = JSON.parse(raw) as HealthFocus;
    return fileIds.includes(focus.fileId) ? focus : null;
  } catch {
    return null;
  }
}

/** So a later open of the same log doesn't reuse an old focus. */
export function clearHealthFocus() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing stored to clear
  }
}


/** The vehicle's permanent Health tab, and its traces, by fixed id so they can be found and topped up. */
export const HEALTH_PAGE_ID = "page-health";
const TRACE_IDS = {
  pressure: "health-pressures",
  temperature: "health-temperatures",
  boost: "health-boost",
  battery: "health-battery",
  limiter: "health-limiter",
  lambda: "health-widebands",
  egt: "health-egts",
} as const;

type HealthLog = {
  fileId: Id<"files">;
  parsed: ParsedLog;
  activeSessionIndex: number;
  raceStartTime: number | null;
};

/**
 * Every health channel of the loaded logs, one trace per kind so pressures,
 * volts and lambda each get their own scale: the supply pressures the checks
 * watch, the battery, the widebands with their target, and any EGTs. The
 * pressures are the ones the run sheet shows — read off the log the same
 * way, so a sensor on an unused system stays out. Null when no log has any.
 */
export function buildHealthPage(logs: HealthLog[]): PageConfig | null {
  const byTrace: Record<keyof typeof TRACE_IDS, { logFileId: Id<"files">; channelName: string }[]> = {
    pressure: [],
    temperature: [],
    boost: [],
    battery: [],
    limiter: [],
    lambda: [],
    egt: [],
  };
  for (const log of logs) {
    const session = log.parsed.sessions[log.activeSessionIndex];
    if (session && log.raceStartTime != null) {
      const end = wideOpenEnd(log.parsed, session, log.raceStartTime, null);
      for (const l of readLevels(log.parsed, session, log.raceStartTime, end)) {
        if (!isCheckedLevel(l)) continue;
        const trace = l.quantitySlug === "pressure" ? "pressure" : l.quantitySlug === "temperature" ? "temperature" : "battery";
        byTrace[trace].push({ logFileId: log.fileId, channelName: l.name });
        if (l.shortfall) byTrace.pressure.push({ logFileId: log.fileId, channelName: l.shortfall.expectedName });
      }
      const boost = readBoost(log.parsed, session, log.raceStartTime, end);
      if (boost) {
        byTrace.boost.push({ logFileId: log.fileId, channelName: boost.mapName });
        if (boost.targetName) byTrace.boost.push({ logFileId: log.fileId, channelName: boost.targetName });
      }
      const limiter = readLimiter(log.parsed, session, log.raceStartTime, end);
      if (limiter) byTrace.limiter.push({ logFileId: log.fileId, channelName: limiter.name });
    }
    const defs = log.parsed.channelDefs;
    const widebands = cylinderChannels(defs, "lambda").map((m) => m.name);
    const target = targetChannel(defs);
    for (const name of target && widebands.length ? [...widebands, target] : widebands) {
      byTrace.lambda.push({ logFileId: log.fileId, channelName: name });
    }
    for (const m of cylinderChannels(defs, "egt")) byTrace.egt.push({ logFileId: log.fileId, channelName: m.name });
  }
  const traces = (Object.keys(TRACE_IDS) as (keyof typeof TRACE_IDS)[])
    .filter((k) => byTrace[k].length)
    .map((k) => ({ id: TRACE_IDS[k], channels: byTrace[k], height: 200 }));
  return traces.length ? { id: HEALTH_PAGE_ID, label: "Health", traces } : null;
}

/** Whether `config` already has every channel of `page` (so nothing needs adding). Works for any automatic tab. */
export function hasHealthPage(pages: PageConfig[], page: PageConfig): boolean {
  const have = pages.find((p) => p.id === page.id);
  if (!have) return false;
  return page.traces.every((t) => {
    const ht = have.traces.find((x) => x.id === t.id);
    return !!ht && t.channels.every((c) => ht.channels.some((h) => h.logFileId === c.logFileId && h.channelName === c.channelName));
  });
}

/** The channels a focus is about, by name, for one log: the named ones, or the cylinders (and target) it picks. */
export function focusChannelNames(focus: HealthFocus, defs: { name: string; quantitySlug?: string }[]): string[] {
  let names = focus.channels ?? [];
  if (focus.cylinders) {
    const { kind, labels, withTarget } = focus.cylinders;
    names = cylinderChannels(defs, kind)
      .filter((m) => labels === "all" || labels.includes(m.label))
      .map((m) => m.name);
    const target = withTarget ? targetChannel(defs) : undefined;
    if (target) names.push(target);
  }
  return names.filter((n) => defs.some((d) => d.name === n));
}

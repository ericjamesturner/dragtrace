import type { PageConfig } from "./viewer-types";
import type { ParsedLog } from "./log-types";
import type { Id } from "../../convex/_generated/dataModel";
import { cylinderChannels, targetChannel } from "./anomalies";

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


export const HEALTH_PAGE_ID = "__health";

/**
 * The temporary page for a focus: one trace with the channels it names that
 * this log has, the first carrying a marker at the moment. Null when the log
 * has none of them.
 */
export function healthPage(
  focus: HealthFocus,
  log: { fileId: Id<"files">; parsed: ParsedLog },
): PageConfig | null {
  const defs = log.parsed.channelDefs;
  let names = focus.channels ?? [];
  if (focus.cylinders) {
    const { kind, labels, withTarget } = focus.cylinders;
    names = cylinderChannels(defs, kind)
      .filter((m) => labels === "all" || labels.includes(m.label))
      .map((m) => m.name);
    const target = withTarget ? targetChannel(defs) : undefined;
    if (target) names.push(target);
  }
  names = names.filter((n) => defs.some((d) => d.name === n));
  if (!names.length) return null;
  return {
    id: HEALTH_PAGE_ID,
    label: `Health: ${focus.label}`,
    traces: [
      {
        id: `${HEALTH_PAGE_ID}-trace`,
        height: 300,
        channels: names.map((channelName, i) => ({
          logFileId: log.fileId,
          channelName,
          // Hundredths, as the ruler under the chart labels it: 0.43, not 0.4259999.
          ...(i === 0 && focus.at !== undefined ? { markers: { times: [Math.round(focus.at * 100) / 100] } } : {}),
        })),
      },
    ],
  };
}

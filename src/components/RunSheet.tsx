import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { TimeslipForm } from "./TimeslipForm";
import { SlipCompareDialog, type CompareSlipRef } from "./SlipCompareDialog";
import { TuneChangeList } from "./TuneChangeList";
import { SEGMENTS, segmentTimes, type SegmentKey } from "@/lib/timeslip-segments";
import { estimatePowerFromTimeslip, type WeightPowerEstimates } from "@/lib/drag-performance";
import { formatLaunch, type LaunchLine } from "@/lib/launch-readings";
import { convertForDisplay, getDisplayPrecision, getDisplayUnit, type UnitOverrides, type UnitSystem } from "@/lib/units";
import { setHealthFocus, type HealthFocus } from "@/lib/health-focus";
import { checksCut, findAnomalies, isCheckedLevel, offsetsOf, spinOf, spreadOf, targetRatios, TARGET_OFF, type InjectorReading, type SlipReading, type Anomaly, type BoostReading, type CylinderGroup, type FaultReading, type LimiterReading, type PassChecks, type PassLevel } from "@/lib/anomalies";
import { correctionFactor } from "@/lib/weather-correction";
import { categoryLabel } from "@/lib/changes";
import { timeFromName } from "@/lib/tune-changes";
import { parsePreview } from "@/lib/preview";
import { DRIVESHAFT_TIMES, type BoxReading, type DriveshaftReading, type ShiftReading } from "@/lib/pass-readings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ArrowUpIcon,
  DownloadIcon,
  GripVerticalIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import {
  RpmTrace,
  readLift,
  usePassPreview,
  type LiftAnalysis,
  type RaceTimingInfo,
} from "./RpmPreview";

/** Where lower is quicker. `rt` only counts non-negative lights — a red
 *  light is a foul, not a good reaction. */
export const LOW_METRICS = ["rt", "sixtyFt", "threeThirty", "eighthEt", "thousandFt", "et"] as const;
/** Where higher is faster. */
export const HIGH_METRICS = ["eighthMph", "mph"] as const;
export type MetricKey = (typeof LOW_METRICS)[number] | (typeof HIGH_METRICS)[number];
export type MetricBests = Partial<Record<MetricKey | SegmentKey, number>>;
/** The event's spread of one metric across its passes. */
interface MetricRange {
  best: number;
  worst: number;
  count: number;
}
export type MetricRanges = Partial<Record<MetricKey | SegmentKey, MetricRange>>;

/** One flat pass's contribution to a ratio: its finish clock, the earlier
 *  split it is divided by, and the ratio those two make. */
export interface RefDetail {
  final: number;
  split: number;
  ratio: number;
}

/** A lifted pass's projected finish, with the full working behind each
 *  number so the sheet can teach the math in a popover. */
export interface PassEstimate {
  scope: "event" | "all";
  et?: {
    value: number;
    splitLabel: string;
    splitValue: number;
    ratio: number;
    refs: RefDetail[];
  };
  mph?: {
    value: number;
    eighthMph: number;
    ratio: number;
    refs: RefDetail[];
  };
}

/** Dash knobs that moved between a pass and the car's pass before it. */
export interface KnobMoves {
  moves: { name: string; from: number; to: number }[];
  fromLabel: string;
}

/** A tune or firmware change shown on a pass, with the pass it's measured from. */
export interface TuneTabChange {
  change: Doc<"changes">;
  fromLabel?: string;
}

/** Tailwind green-400 — the event-best colour — as a literal for color-mix. */
const BEST_GREEN = "oklch(79.2% 0.209 151.711)";

/**
 * How far off the event best a result must be to fade all the way to grey,
 * in the metric's own units. Set by what each gap means at the track: a
 * thousandth on the 60' is real, a tenth on the quarter is a lot.
 */
const FADE_AT: Record<MetricKey | SegmentKey, number> = {
  rt: 0.04,
  sixtyFt: 0.03,
  threeThirty: 0.05,
  eighthEt: 0.06,
  thousandFt: 0.08,
  et: 0.1,
  eighthMph: 3,
  mph: 4,
  seg60_330: 0.03,
  seg330_660: 0.03,
  seg660_1000: 0.03,
  seg1000_1320: 0.03,
};

/**
 * Shades a result toward the event's best: the best keeps its solid green
 * and every other result fades toward grey by how far off it is, on a fixed
 * racing scale per metric. The square root spreads the small gaps apart, so
 * one thousandth already reads as a step down from the best.
 */
function shadeStyle(
  k: MetricKey | SegmentKey,
  v: number | undefined,
  ranges: MetricRanges,
): React.CSSProperties | undefined {
  const r = ranges[k];
  if (!r || v === undefined || r.count < 2 || v === r.best) return undefined;
  if (k === "rt" && v < 0) return undefined;
  return fadeStyle(Math.abs(v - r.best), FADE_AT[k]);
}

/** The colour for a result `gap` off the best, fully grey at `fadeAt`. */
function fadeStyle(gap: number, fadeAt: number): React.CSSProperties {
  const t = Math.min(1, Math.sqrt(gap / fadeAt));
  // Only the best is solid green; everything else tops out a step below it.
  const green = Math.round(80 * (1 - t));
  return { color: `color-mix(in oklab, ${BEST_GREEN} ${green}%, var(--muted-foreground))` };
}

/** This much short of the event's most power is fully grey. */
const HP_FADE_AT = 60;

/** A package this far off the event's best is fully grey. */
const PACKAGE_FADE_AT = 0.03;

/**
 * Reaction time plus how far over the dial the pass ran — the number a
 * bracket race is decided on. Only for a slip with a dial and a light; the
 * finish is the full E.T. when there is one, else the eighth.
 */
function packageOf(slip: Doc<"timeslips"> | undefined) {
  if (!slip || slip.dialIn === undefined || slip.rt === undefined) return null;
  const finish = slip.et !== undefined || slip.mph !== undefined ? slip.et : slip.eighthEt;
  if (finish === undefined) return null;
  const over = finish - slip.dialIn;
  return {
    value: Math.round((slip.rt + over) * 1000) / 1000,
    /** A red light or a breakout: the package doesn't count. */
    foul: slip.rt < 0 || over < 0,
    /** What the sheet shows for a foul instead of the package. */
    foulText:
      slip.rt < 0
        ? "RED"
        : over < 0
          ? // When both break out, the smaller breakout wins: how far under is the number that matters.
            `BO ${(-over).toFixed(3).replace(/^0/, "")}`
          : null,
  };
}

/** Tailwind amber-400 and sky-400, for readings above and below the event's usual. */
const ABOVE_AMBER = "oklch(82.8% 0.189 84.429)";
const BELOW_SKY = "oklch(74.6% 0.16 232.661)";

/**
 * Colours a reading by how far it sits from the event's usual (the median):
 * amber above, blue below, plain when typical. Readings aren't results, so
 * there's no best — what's worth seeing is the pass that was different. The
 * scale is the event's own spread, so a 2 °F wobble on a steady day still
 * reads as steady. `higherIsBetter` flips the colours where up is good, so in
 * the air rows amber always means worse air.
 */
function spreadStyler(values: (number | undefined)[], higherIsBetter = false) {
  const nums = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  if (nums.length < 3) return () => undefined;
  const median = medianOf(nums);
  const mad = medianOf(nums.map((v) => Math.abs(v - median)));
  const scale = Math.max(mad * 3, Math.abs(median) * 0.005, 1e-9);
  return (v: number | undefined): React.CSSProperties | undefined => {
    if (v === undefined || !Number.isFinite(v)) return undefined;
    const t = Math.min(1, Math.abs(v - median) / scale);
    if (t < 0.35) return undefined;
    const up = v > median !== higherIsBetter;
    return { color: `color-mix(in oklab, ${up ? ABOVE_AMBER : BELOW_SKY} ${Math.round(80 * t)}%, var(--foreground))` };
  };
}

function medianOf(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "head 6.5" -> -6.5, "tail 2.5" -> 2.5: positive helps the clocks. */
function windHelp(dir: string | undefined): number | undefined {
  const m = dir && /^(head|tail)\s*(-?[\d.]+)/i.exec(dir.trim());
  if (!m) return undefined;
  return (m[1].toLowerCase() === "head" ? -1 : 1) * Number(m[2]);
}

/** Wind on the clocks: a headwind in amber, a tailwind in blue, stronger as it blows harder. */
function windStyle(help: number | undefined): React.CSSProperties | undefined {
  if (help === undefined || Math.abs(help) < 1) return undefined;
  const t = Math.min(1, Math.abs(help) / 10);
  return { color: `color-mix(in oklab, ${help < 0 ? ABOVE_AMBER : BELOW_SKY} ${Math.round(80 * t)}%, var(--foreground))` };
}

/** Everything one pass's column shows, worked out once. */
interface Col {
  file: Doc<"files">;
  /** The pass's slip. A file holds at most one in practice; the first wins. */
  slip?: Doc<"timeslips">;
  /** How long the pass ran on the slip's clock: its furthest split. */
  passLen: number | null;
  lift: LiftAnalysis | null;
  launch: LaunchLine[];
  driveshaft: DriveshaftReading[];
  shifts: ShiftReading[];
  levels: PassLevel[];
  cylinders: CylinderGroup[];
  boost: BoostReading | null;
  limiter: LimiterReading | null;
  faults: FaultReading[] | null;
  /** The last gear's RPM-to-driveshaft ratio. */
  convSlip: SlipReading | null;
  injectors: InjectorReading[] | null;
  /** The delay box as the log measured it. */
  box: BoxReading | null;
  /** The health checks stopped short of the finish: the throttle came off early. */
  checksCut: number | null;
  /** Seconds after the launch the health checks ran to. */
  checksTo: number | null;
  /** What the pass did that this vehicle's other passes usually don't. */
  anomalies: Anomaly[];
  segs: Partial<Record<SegmentKey, number>>;
  cf?: number;
  power: WeightPowerEstimates | null;
  estimate?: PassEstimate;
  /** The day it ran, as shown: NSP's stamp in the file name, else the upload day. */
  day: string;
  /** Unticked by the racer: shown grey, and left out of bests, colours and averages. */
  excluded: boolean;
}

const SPREAD_PCT_KEY = "dragtrace.runSheet.spreadPct";

/** A slip number as the scoreboard prints it: thousandths for times, hundredths for speeds. */
function slipNumber(key: MetricKey, v: number): string {
  return v.toFixed(key === "mph" || key === "eighthMph" ? 2 : 3);
}

/** The log's box delay and the slip's agree to within this (the log samples every few ms). */
const BOX_MATCH_S = 0.01;

/** Tailwind green-500: a pass that counts. */
const COUNTS_GREEN = "oklch(72.3% 0.219 149.579)";

/** The average column: set off from the passes by a rule. */
const AVG_COL = "border-l border-l-foreground/15";
/** An unticked pass: its numbers stay readable, but plainly out of play. */
const EXCLUDED = "opacity-35 grayscale";

/** The row's mean over the passes that count; undefined when fewer than two have a number. */
function meanOf(r: Row, cols: Col[]): number | undefined {
  if (!r.avg) return undefined;
  const nums = cols.flatMap((c) => {
    if (c.excluded) return [];
    const v = r.avg!.num(c);
    return v !== undefined && Number.isFinite(v) ? [v] : [];
  });
  return nums.length < 2 ? undefined : nums.reduce((a, b) => a + b) / nums.length;
}

/**
 * Fastest to slowest (or high to low) over the passes that count, to the
 * average's own precision. Blank when fewer than two have a number.
 */
function spreadText(r: Row, cols: Col[], mean: number | undefined, asPct: boolean): string | null {
  if (!r.avg || mean === undefined) return null;
  const nums = cols.flatMap((c) => {
    if (c.excluded) return [];
    const v = r.avg!.num(c);
    return v !== undefined && Number.isFinite(v) ? [v] : [];
  });
  if (nums.length < 2) return null;
  const spread = Math.max(...nums) - Math.min(...nums);
  if (asPct && r.avg.pct && mean !== 0) return formatPct((spread / Math.abs(mean)) * 100);
  const places = /\.(\d+)/.exec(r.avg.fmt(mean))?.[1].length ?? 0;
  return spread.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places, useGrouping: false });
}

/** "0.68%", "1.7%", "12%": two significant figures, enough to compare rows. */
function formatPct(p: number): string {
  return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

/**
 * Beside a hovered pass's number: which way it sits from the event average,
 * with the gap in the tooltip, to the row's own precision.
 */
function AvgArrow({ r, c, mean }: { r: Row; c: Col; mean: number | undefined }) {
  const v = r.avg?.num(c);
  if (mean === undefined || v === undefined || !Number.isFinite(v)) return null;
  const shown = r.avg!.fmt(mean);
  const places = /\.(\d+)/.exec(shown)?.[1].length ?? 0;
  const gap = v - mean;
  if (Math.abs(gap) < 0.5 * 10 ** -places) return null;
  const Icon = gap > 0 ? ArrowUpIcon : ArrowDownIcon;
  const better = r.avg!.better;
  const tone = !better ? "text-muted-foreground" : (gap < 0) === (better === "low") ? "text-green-400" : "text-red-400";
  const size = Math.abs(gap).toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places });
  return (
    <Tip
      content={`${gap > 0 ? "+" : "−"}${size}${
        r.avg!.pct && mean !== 0 ? ` (${formatPct((Math.abs(gap) / Math.abs(mean)) * 100)})` : ""
      } from the average (${shown})`}
      delay={0}
    >
      <span className={`mr-0.5 inline-flex cursor-help ${tone}`}>
        <Icon className="size-3" />
      </span>
    </Tip>
  );
}

/** Shifts this far apart in time, on different passes, are different shifts. */
const SHIFT_SLOT_GAP_S = 0.4;

/**
 * The event's shifts lined up by time: each slot is one shift (1-2, 2-3, ...)
 * holding the pass that made it. Slots form where the passes' shift times
 * bunch; a pass's shift goes to the nearest one, at most one per pass.
 */
function shiftSlots(cols: Col[]): Map<string, ShiftReading>[] {
  const times = cols.flatMap((c) => c.shifts.map((s) => s.at)).sort((a, b) => a - b);
  const centers: number[] = [];
  let group: number[] = [];
  for (const t of times) {
    if (group.length && t - group[group.length - 1] > SHIFT_SLOT_GAP_S) {
      centers.push(group.reduce((a, b) => a + b) / group.length);
      group = [];
    }
    group.push(t);
  }
  if (group.length) centers.push(group.reduce((a, b) => a + b) / group.length);
  const slots = centers.map(() => new Map<string, ShiftReading>());
  for (const c of cols) {
    for (const s of c.shifts) {
      let best = 0;
      for (let k = 1; k < centers.length; k++) {
        if (Math.abs(centers[k] - s.at) < Math.abs(centers[best] - s.at)) best = k;
      }
      if (!slots[best].has(c.file._id)) slots[best].set(c.file._id, s);
    }
  }
  // A gear change shows on most passes. A dip that only one or two passes
  // have, where the rest have nothing, is the tires or the converter.
  const counted = (m: Map<string, ShiftReading>) => cols.filter((c) => !c.excluded && m.has(c.file._id)).length;
  const most = Math.max(0, ...slots.map(counted));
  return slots.filter((m) => counted(m) * 2 >= most && (most === 0 || counted(m) > 0));
}

/** "16:25" -> "4:25 pm". Anything that isn't HH:MM shows as typed. */
function formatRunTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

const DASH = <span className="text-muted-foreground/30">—</span>;

/** A label with its unit kept lower case: the label column is set in capitals, and "0.1 S" misreads. */
function withUnit(name: string, unit: string) {
  return (
    <>
      {name} <span className="normal-case">{unit}</span>
    </>
  );
}

/** One row of the sheet: a label once on the left, a value under every pass. */
interface Row {
  key: string;
  label: React.ReactNode;
  cell: (c: Col) => React.ReactNode;
  bold?: boolean;
  /** Sits beside the label, at the right of the label column. */
  extra?: React.ReactNode;
  /** A warning: stays in full colour on a pass that's switched off — it still needs seeing. */
  alert?: boolean;
  /** The row's number per pass, for the average column. Rows without one leave it blank. */
  avg?: {
    num: (c: Col) => number | undefined;
    fmt: (v: number) => string;
    /** Which way is better, for the hover arrow's colour. Unset: neither — a reading, not a result. */
    better?: "low" | "high";
    /**
     * The spread reads as a share of the average. Only where the number has
     * a true zero and sits well away from it: not a reaction time, a wind
     * that crosses from head to tail, or a temperature in °F.
     */
    pct?: boolean;
  };
}

interface Section {
  key: string;
  title: string;
  /** Show the title as its own row: only where the labels need it to make sense. */
  caption?: boolean;
  rows: Row[];
}

/**
 * The event's passes side by side, like a run sheet: the slip's labels once
 * down the left, one column per pass in the order the weekend ran. Rows that
 * no pass here has a value for are left out.
 */
export function RunSheet({
  files,
  slipsByFile,
  eighthOnly,
  raceWeightLb,
  unitSystem,
  unitOverrides,
  bestFileId,
  airBest,
  eventBests,
  eventRanges,
  estimates,
  estScope,
  onEstScopeChange,
  alignWindow,
  onRaceTiming,
  changesAt,
  tuneAt,
  knobMovesAt,
  slipRefs,
  levelPool,
  onOpenViewer,
  onOpenLogs,
  onDelete,
  onMove,
}: {
  files: Doc<"files">[];
  slipsByFile: Map<string, Doc<"timeslips">[]>;
  eighthOnly: boolean;
  raceWeightLb?: number;
  unitSystem: UnitSystem;
  unitOverrides: UnitOverrides;
  bestFileId: string | null;
  /** The pass that was quickest once the air is evened out, when it isn't simply the quickest. */
  airBest: { id: string; margin: number } | null;
  eventBests: MetricBests;
  eventRanges: MetricRanges;
  estimates: Record<string, PassEstimate>;
  estScope: "event" | "all";
  onEstScopeChange: (scope: "event" | "all") => void;
  alignWindow?: { preRace: number; postRace: number };
  onRaceTiming: (fileId: string, info: RaceTimingInfo | null) => void;
  /** Hardware changes, on the first pass that ran them. */
  changesAt: Map<string, Doc<"changes">[]>;
  tuneAt: Map<string, TuneTabChange[]>;
  knobMovesAt: Map<string, KnobMoves>;
  slipRefs: CompareSlipRef[];
  /** Every counted pass of the vehicle's stored checks, by file: what "usual" means. */
  levelPool: Map<string, PassChecks>;
  onOpenViewer: (fileId: Id<"files">) => void;
  onOpenLogs: (fileIds: Id<"files">[]) => void;
  onDelete: (file: Doc<"files">) => void;
  /** Move the pass at `from` so it lands before the pass now at `to`. */
  onMove: (from: number, to: number) => void;
}) {
  const cols = useMemo<Col[]>(
    () =>
      files.map((file) => {
        const slip = slipsByFile.get(file._id)?.[0];
        const splits = slip
          ? [slip.sixtyFt, slip.threeThirty, slip.eighthEt, slip.thousandFt, slip.et].filter(
              (x): x is number => x !== undefined && x > 0
            )
          : [];
        const passLen = splits.length ? Math.max(...splits) : null;
        // Any stored version that has them, so they don't blink while the
        // preview is rebuilt to the current one.
        const preview = parsePreview(file.preview);
        const launch = preview?.launch;
        return {
          file,
          slip,
          passLen,
          lift: readLift(file.preview, passLen),
          launch: launch ? formatLaunch(launch, unitSystem, unitOverrides) : [],
          driveshaft: preview?.driveshaft ?? [],
          shifts: preview?.shifts ?? [],
          levels: preview?.levels ?? [],
          cylinders: preview?.cylinders ?? [],
          checksCut: checksCut(preview?.checksTo ?? undefined, passLen) ? preview!.checksTo! : null,
          checksTo: preview?.checksTo ?? null,
          boost: preview?.boost ?? null,
          limiter: preview?.limiter ?? null,
          faults: preview?.faults ?? null,
          convSlip: preview?.slip ?? null,
          injectors: preview?.injectors ?? null,
          box: preview?.box ?? null,
          anomalies: findAnomalies(
            {
              levels: preview?.levels ?? [],
              cylinders: preview?.cylinders ?? [],
              boost: preview?.boost,
              limiter: preview?.limiter,
              faults: preview?.faults,
              driveshaft: preview?.driveshaft,
              sixtyFt: slip?.sixtyFt,
              slip: preview?.slip,
              injectors: preview?.injectors,
            },
            [...levelPool].filter(([id]) => id !== file._id).map(([, checks]) => checks),
          ),
          segs: slip ? segmentTimes(slip) : {},
          cf: slip ? correctionFactor(slip) ?? undefined : undefined,
          power:
            slip && raceWeightLb
              ? estimatePowerFromTimeslip({
                  raceWeightLb,
                  quarterEt: slip.et,
                  quarterMph: slip.mph,
                  eighthEt: slip.eighthEt,
                  eighthMph: slip.eighthMph,
                })
              : null,
          estimate: estimates[file._id],
          excluded: !!file.excluded,
          day: new Date(timeFromName(file.fileName) ?? file.uploadedAt).toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
        };
      }),
    [files, slipsByFile, unitSystem, unitOverrides, raceWeightLb, estimates, levelPool]
  );

  // Column reordering: the drag only starts from a column's grip, so text in
  // the header stays selectable.
  const [armedIdx, setArmedIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const armDrag = useCallback((i: number) => {
    setArmedIdx(i);
    window.addEventListener("mouseup", () => setArmedIdx(null), { once: true });
  }, []);
  const dropIdxAt = (e: React.DragEvent<HTMLElement>) => {
    let at = 0;
    for (const el of e.currentTarget.querySelectorAll<HTMLElement>("[data-col-head]")) {
      const r = el.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2) at = Number(el.dataset.colHead) + 1;
    }
    return at;
  };
  const showDrop = dragIdx !== null && dropIdx !== null && dropIdx !== dragIdx && dropIdx !== dragIdx + 1;

  // Crosshair: the column under the pointer lights up with its row.
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  // The row under the pointer stays bright; every other row dims back.
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const setExcluded = useMutation(api.files.setExcluded);
  // Raw spread or a share of the average: a viewing preference, kept per browser.
  const [spreadPct, setSpreadPct] = useState(() => {
    try {
      return localStorage.getItem(SPREAD_PCT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleSpreadPct = () =>
    setSpreadPct((on) => {
      try {
        localStorage.setItem(SPREAD_PCT_KEY, on ? "0" : "1");
      } catch {
        // Private mode or blocked storage: the toggle still works for this visit.
      }
      return !on;
    });
  const dimmed = (key: string) => (hoverRow !== null && hoverRow !== key ? "opacity-30" : "");

  // Every other row carries a faint band so a row reads across the whole sheet.
  // Solid, so the pinned label column can wear it too.
  const STRIPE = "bg-[color-mix(in_oklab,var(--muted)_65%,var(--card))]";
  const colClass = (i: number, striped = false) =>
    [
      hoverCol === i ? "bg-muted/60" : striped ? STRIPE : "",
      // A faint rule where a new day starts.
      i > 0 && cols[i].day !== cols[i - 1].day ? "border-l border-l-foreground/15" : "",
      showDrop && dropIdx === i ? "shadow-[inset_2px_0_0_0_var(--color-primary)]" : "",
      showDrop && dropIdx === cols.length && i === cols.length - 1
        ? "shadow-[inset_-2px_0_0_0_var(--color-primary)]"
        : "",
      dragIdx === i ? "opacity-30" : "",
    ].join(" ");

  const sections = useMemo<Section[]>(() => {
    const any = (f: (c: Col) => unknown) => cols.some((c) => {
      const v = f(c);
      return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
    });
    // The passes that count: an unticked pass still shows, but sets nothing.
    const inc = cols.filter((c) => !c.excluded);
    const metric = (
      key: MetricKey,
      label: string,
      opts: { bold?: boolean } = {}
    ): Row => ({
      key,
      label,
      bold: opts.bold,
      avg: {
        num: (c) => {
          const v = c.slip?.[key];
          return key === "rt" && v !== undefined && v < 0 ? undefined : v;
        },
        fmt: (v) => v.toFixed(key === "mph" || key === "eighthMph" ? 2 : 3),
        better: key === "mph" || key === "eighthMph" ? "high" : "low",
        pct: key !== "rt",
      },
      cell: (c) => {
        const v = c.slip?.[key];
        if (v === undefined) return DASH;
        // Fixed places so the digits line up down the column: 1.080, not 1.08.
        const text = slipNumber(key, v);
        if (key === "rt" && v < 0) return <span className="text-red-400">{text}</span>;
        // Only the hero ET shows a breakout; the rows rank the passes, nothing more.
        if (v === eventBests[key]) return <span className="text-green-400">{text}</span>;
        return <span style={shadeStyle(key, v, eventRanges)}>{text}</span>;
      },
    });
    // Only a clean package can be the event's best; with one, there's nothing to rank.
    const clean = inc.flatMap((c) => {
      const pkg = packageOf(c.slip);
      return pkg && !pkg.foul ? [pkg.value] : [];
    });
    const bestPackage = clean.length >= 2 ? Math.min(...clean) : undefined;
    const out: Section[] = [
      {
        key: "start",
        title: "Start",
        rows: [
          {
            key: "dial",
            label: "Dial",
            cell: (c) => {
              const dial = c.slip?.dialIn;
              if (dial === undefined) return DASH;
              // Dials read in hundredths: 4.70, not 4.7. A finer dial keeps its digits.
              const places = Math.max(2, (String(dial).split(".")[1] ?? "").length);
              return <span className="text-amber-300/90">{dial.toFixed(places)}</span>;
            },
          },
          {
            key: "box",
            label: "Box",
            cell: (c) => (c.slip?.delayBox !== undefined ? c.slip.delayBox.toFixed(3) : DASH),
          },
          {
            // What the log says the box did: button let go to transbrake let go.
            // Red when it doesn't match the box written on the slip.
            key: "box-log",
            label: "Box Log",
            cell: (c) => {
              if (!c.box) return DASH;
              const text = c.box.delay.toFixed(3);
              const slipBox = c.slip?.delayBox;
              const off = slipBox !== undefined && Math.abs(c.box.delay - slipBox) > BOX_MATCH_S;
              return (
                <Tip
                  content={`The log: ${c.box.delay.toFixed(3)} s from letting go of the transbrake button to the transbrake letting go.${
                    slipBox !== undefined ? (off ? ` The slip says ${slipBox} — they don't match.` : ` Matches the slip's ${slipBox}.`) : ""
                  }`}
                >
                  <span className={off ? "font-bold text-red-400" : ""}>{text}</span>
                </Tip>
              );
            },
          },
          metric("rt", "R.T."),
          {
            key: "package",
            label: "Package",
            avg: {
              num: (c) => {
                const pkg = packageOf(c.slip);
                return pkg && !pkg.foul ? pkg.value : undefined;
              },
              fmt: (v) => v.toFixed(3),
              better: "low",
            },
            cell: (c) => {
              const pkg = packageOf(c.slip);
              if (!pkg) return DASH;
              const text = pkg.value.toFixed(3);
              if (pkg.foulText) {
                return (
                  <Tip content={`Package ${text}`}>
                    <span className="text-red-400">{pkg.foulText}</span>
                  </Tip>
                );
              }
              if (bestPackage === undefined) return text;
              if (pkg.value === bestPackage) return <span className="text-green-400">{text}</span>;
              return <span style={fadeStyle(pkg.value - bestPackage, PACKAGE_FADE_AT)}>{text}</span>;
            },
          },
        ],
      },
      {
        key: "clocks",
        title: "Clocks",
        rows: [
          metric("sixtyFt", "60'"),
          metric("threeThirty", "330'"),
          metric("eighthEt", "1/8"),
          metric("eighthMph", eighthOnly ? "MPH" : "1/8 MPH"),
          ...(eighthOnly
            ? []
            : [
                metric("thousandFt", "1000'"),
                metric("et", "1/4", { bold: true }),
                metric("mph", "1/4 MPH", { bold: true }),
              ]),
        ],
      },
      {
        key: "splits",
        title: "Splits",
        rows: (eighthOnly ? SEGMENTS.slice(0, 2) : SEGMENTS).map((s) => ({
          key: s.key,
          label: s.label,
          avg: { num: (c: Col) => c.segs[s.key], fmt: (v: number) => v.toFixed(3), better: "low" as const, pct: true },
          cell: (c: Col) => {
            const v = c.segs[s.key];
            if (v === undefined) return DASH;
            // Always 3dp so the splits line up down the column.
            const text = v.toFixed(3);
            return v === eventBests[s.key] ? (
              <span className="text-green-400">{text}</span>
            ) : (
              <span style={shadeStyle(s.key, v, eventRanges)}>{text}</span>
            );
          },
        })),
      },
    ];

    // Right under the splits, which they are worked out from.
    if (raceWeightLb !== undefined) {
      const hpOf = (c: Col, method: "E.T." | "MPH") => (method === "E.T." ? c.power?.etHp : c.power?.mphHp);
      // Most power in green, fading as it falls short — like the clocks.
      const bestHp = (method: "E.T." | "MPH") => {
        const all = inc.flatMap((c) => {
          const hp = hpOf(c, method);
          return hp === undefined ? [] : [Math.round(hp)];
        });
        return all.length >= 2 ? Math.max(...all) : undefined;
      };
      const powerRow = (method: "E.T." | "MPH"): Row => ({
        key: `power-${method}`,
        avg: { num: (c) => hpOf(c, method), fmt: (v) => Math.round(v).toLocaleString(), better: "high", pct: true },
        label: (
          <Tip content={`Estimated from the ${raceWeightLb.toLocaleString()} lb race weight`}>
            <span>≈ HP from {method}</span>
          </Tip>
        ),
        cell: (c) => {
          const hp = method === "E.T." ? c.power?.etHp : c.power?.mphHp;
          const d = c.power?.distance;
          const observed = d === "1/4" ? (method === "E.T." ? c.slip?.et : c.slip?.mph) : method === "E.T." ? c.slip?.eighthEt : c.slip?.eighthMph;
          if (hp === undefined || d === undefined || observed === undefined) return DASH;
          return (
            <EstimateLine
              value={(() => {
                const best = bestHp(method);
                const text = Math.round(hp).toLocaleString();
                if (best === undefined) return text;
                if (Math.round(hp) === best) return <span className="text-green-400">{text}</span>;
                return <span style={fadeStyle(best - Math.round(hp), HP_FADE_AT)}>{text}</span>;
              })()}
            >
              <WeightPowerExplainer
                method={method}
                distance={d}
                raceWeightLb={raceWeightLb}
                observed={observed}
                estimateHp={hp}
              />
            </EstimateLine>
          );
        },
      });
      out.push({
        key: "power",
        title: "Power",
        rows: [powerRow("E.T."), powerRow("MPH")],
      });
    }

    // How long before the stripe the throttle came out. A clean pass is a
    // non-event, so "none" fades back.
    const liftRows: Row[] = [];
    if (any((c) => c.lift?.finalLift ?? undefined)) {
      liftRows.push({
        key: "lift",
        label: "Lifted early",
        cell: (c) =>
          c.lift === null || c.passLen === null ? (
            DASH
          ) : c.lift.finalLift === null ? (
            <span className="text-muted-foreground/40">none</span>
          ) : (
            <Tip content="How long before the finish the throttle came out">
              <span className="text-amber-300/90">{Math.max(0, c.passLen - c.lift.finalLift).toFixed(2)}s</span>
            </Tip>
          ),
      });
    }
    if (any((c) => c.lift?.pedals)) {
      liftRows.push({
        key: "pedal",
        label: "Pedal",
        cell: (c) =>
          c.lift?.pedals.length ? (
            <span className="text-red-400">
              {c.lift.pedals[0].toFixed(1)}s{c.lift.pedals.length > 1 ? ` ×${c.lift.pedals.length}` : ""}
            </span>
          ) : (
            DASH
          ),
      });
    }
    const lifted = (c: Col) => c.lift?.finalLift != null && c.passLen !== null;
    if (any((c) => (lifted(c) ? c.estimate?.et : undefined))) {
      liftRows.push({
        key: "est-et",
        label: "No-lift E.T.",
        cell: (c) => {
          const e = c.estimate?.et;
          if (!e || !lifted(c)) return DASH;
          return (
            <EstimateLine value={`≈ ${e.value.toFixed(3)}`}>
              <EstimateExplainer
                metric="E.T."
                value={e.value.toFixed(3)}
                intro={`The driver lifted ${(c.passLen! - c.lift!.finalLift!).toFixed(2)}s before the finish, so the final clock reads slow. The math rebuilds it from the ${e.splitLabel} — the last clock the car passed at full throttle.`}
                step1={`Take the car's no-lift passes. Divide each finish E.T. by its ${e.splitLabel} time — the ratio barely moves:`}
                refs={e.refs}
                ratio={e.ratio}
                step2={`Multiply this pass's ${e.splitLabel} time by that ratio:`}
                calcLeft={`${e.splitValue} × ${e.ratio.toFixed(4)}`}
                scope={estScope}
              />
            </EstimateLine>
          );
        },
      });
    }
    if (any((c) => (lifted(c) ? c.estimate?.mph : undefined))) {
      liftRows.push({
        key: "est-mph",
        label: "No-lift MPH",
        cell: (c) => {
          const e = c.estimate?.mph;
          if (!e || !lifted(c)) return DASH;
          return (
            <EstimateLine value={`≈ ${e.value.toFixed(2)}`}>
              <EstimateExplainer
                metric="MPH"
                value={e.value.toFixed(2)}
                intro="The lift killed the charge to the stripe, so the trap speed reads slow. The math rebuilds it from the 1/8-mile speed, trapped before the lift."
                step1="Take the car's no-lift passes. Divide each trap speed by its 1/8-mile speed — the ratio barely moves:"
                refs={e.refs}
                ratio={e.ratio}
                step2="Multiply this pass's 1/8-mile speed by that ratio:"
                calcLeft={`${e.eighthMph} × ${e.ratio.toFixed(4)}`}
                scope={estScope}
              />
            </EstimateLine>
          );
        },
      });
    }
    // The estimates' reference pool: this event's flat passes, or the car's.
    const firstEstimate = liftRows.find((r) => r.key.startsWith("est-"));
    if (firstEstimate) {
      firstEstimate.extra = (
        <Tip content="Which no-lift passes the estimate learns from">
        <span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="font-sans text-[10px] normal-case tracking-normal text-muted-foreground/60 transition-colors hover:text-foreground" />
            }
          >
            {estScope === "event" ? "event" : "all"} ▾
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onEstScopeChange("event")}>This event</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEstScopeChange("all")}>All data</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </span>
        </Tip>
      );
    }
    if (liftRows.length) out.push({ key: "lift", title: "Lift", rows: liftRows });

    // The air, as the slip or the weather station gave it.
    // Amber is worse air than the event's usual, blue better.
    const airRow = (
      key: string,
      label: string,
      get: (c: Col) => number | undefined,
      show: (v: number) => string,
      higherIsBetter = false,
      /** False where neither way is better air, like the track temperature. */
      ranked = true,
      pct = false,
    ) => {
      const style = spreadStyler(inc.map(get), higherIsBetter);
      const better: "low" | "high" | undefined = ranked ? (higherIsBetter ? "high" : "low") : undefined;
      return {
        key,
        label,
        has: get,
        avg: { num: get, fmt: show, better, pct },
        cell: (c: Col) => {
          const v = get(c);
          return v === undefined ? DASH : <span style={style(v)}>{show(v)}</span>;
        },
      };
    };
    const air: Row[] = [
      { key: "time", label: "Time", has: (c: Col) => c.slip?.runTime, cell: (c: Col) => c.slip?.runTime ? formatRunTime(c.slip.runTime) : DASH },
      { key: "lane", label: "Lane", has: (c: Col) => c.slip?.lane, cell: (c: Col) => c.slip?.lane ? (c.slip.lane === "left" ? "Left" : "Right") : DASH },
      airRow("air", "Air °F", (c) => c.slip?.airTemperatureF, (v) => String(Math.round(v * 10) / 10)),
      airRow("track", "Track °F", (c) => c.slip?.trackTemperatureF, (v) => String(Math.round(v * 10) / 10), false, false),
      airRow("humidity", "Humidity %", (c) => c.slip?.humidityPct, (v) => String(Math.round(v * 10) / 10)),
      airRow("baro", "Baro inHg", (c) => c.slip?.barometricPressureInHg, (v) => String(Math.round(v * 1000) / 1000), true, true, true),
      airRow("da", "D.A. ft", (c) => c.slip?.densityAltitudeFt, (v) => Math.round(v).toLocaleString(), false, true, true),
      airRow("cf", "Corr.", (c) => c.cf, (v) => v.toFixed(4), false, true, true),
      {
        key: "wind",
        label: "Wind mph",
        has: (c: Col) => c.slip?.windSpeedMph ?? c.slip?.windDirection,
        avg: {
          num: (c: Col) => windHelp(c.slip?.windDirection),
          fmt: (v: number) => (Math.abs(v) < 0.05 ? "0" : `${v < 0 ? "head" : "tail"} ${Math.abs(v).toFixed(1)}`),
          better: "high" as const,
        },
        cell: (c: Col) => {
          const speed = c.slip?.windSpeedMph;
          const dir = c.slip?.windDirection;
          if (speed === undefined && !dir) return DASH;
          // The head/tail part is what moves the clocks; the gust speed rides on hover.
          return (
            <Tip content={[speed !== undefined ? `${speed} mph` : "", dir].filter(Boolean).join(" · ")}>
              <span style={windStyle(windHelp(dir))}>{dir || speed}</span>
            </Tip>
          );
        },
      },
    ].filter((r) => any(r.has));
    if (air.length) out.push({ key: "air", title: "Air", rows: air });

    // Temperatures and line readings from each log, just before the launch.
    const launchLabels: string[] = [];
    for (const c of cols) for (const l of c.launch) if (!launchLabels.includes(l.label)) launchLabels.push(l.label);
    if (launchLabels.length) {
      out.push({
        key: "launch",
        title: "At launch",
        caption: true,
        rows: launchLabels.map((label) => {
          // "152 °F" -> label "Engine °F", value "152", when every pass shares the unit.
          const parts = cols.flatMap((c) => {
            const v = c.launch.find((l) => l.label === label)?.value;
            const m = v === undefined ? null : /^(-?[\d.,]+)\s*(\S.*)$/.exec(v);
            return v === undefined ? [] : [m ? { n: m[1], unit: m[2] } : { n: v, unit: "" }];
          });
          const unit = parts[0]?.unit ?? "";
          const shared = unit !== "" && parts.every((p) => p.unit === unit);
          const num = (c: Col) => {
            const v = c.launch.find((l) => l.label === label)?.value;
            const n = v === undefined ? NaN : Number(v.replace(/[^\d.-]/g, ""));
            return Number.isFinite(n) ? n : undefined;
          };
          // Hotter than usual in amber, cooler in blue.
          const style = spreadStyler(inc.map(num));
          // The average keeps the readings' own decimals.
          const places = (parts[0]?.n.split(".")[1] ?? "").length;
          return {
            key: `launch-${label}`,
            label: shared ? `${label} ${unit}` : label,
            avg: {
              num,
              fmt: (v: number) => (places ? v.toFixed(places) : String(Math.round(v))),
              // Engine speed has a true zero; temperatures and gauge boost don't.
              pct: /^rpm$/i.test(label),
            },
            cell: (c: Col) => {
              const v = c.launch.find((l) => l.label === label)?.value;
              if (v === undefined) return DASH;
              return <span style={style(num(c))}>{shared ? v.slice(0, v.length - unit.length).trim() : v}</span>;
            },
          };
        }),
      });
    }

    // Driveshaft speed off the line, from the full-rate log.
    // Faster than usual in amber — on a pass whose 60' is no better, that's spin — slower in blue.
    const dsStyles = new Map(
      DRIVESHAFT_TIMES.map((after) => [after, spreadStyler(inc.map((c) => c.driveshaft.find((d) => d.after === after)?.rpm))]),
    );
    if (any((c) => c.driveshaft.length || undefined)) {
      out.push({
        key: "driveshaft",
        title: "Driveshaft",
        caption: true,
        rows: DRIVESHAFT_TIMES.map((after) => ({
          key: `ds-${after}`,
          // ".25", "1.0": the seconds go without saying.
          label: after < 1 ? String(after).replace(/^0(?=\.)/, "") : Number.isInteger(after) ? after.toFixed(1) : String(after),
          avg: {
            num: (c: Col) => c.driveshaft.find((d) => d.after === after)?.rpm,
            fmt: (v: number) => String(Math.round(v)),
            pct: true,
          },
          cell: (c: Col) => {
            const r = c.driveshaft.find((d) => d.after === after);
            return r ? <span style={dsStyles.get(after)?.(r.rpm)}>{Math.round(r.rpm)}</span> : DASH;
          },
        })),
      });
    }

    // Each upshift: when the RPM peaked into it, how long the pull-down took,
    // and how far it fell. A row is one shift across every pass, matched by
    // when it happened, so a pass that missed one doesn't slide the rest up.
    const slots = shiftSlots(cols);
    slots.forEach((slot, k) => {
      const at = (c: Col) => slot.get(c.file._id);
      const rpm = spreadStyler(inc.map((c) => at(c)?.rpm));
      const when = spreadStyler(inc.map((c) => at(c)?.at));
      const takes = spreadStyler(inc.map((c) => at(c)?.takes));
      const drop = spreadStyler(inc.map((c) => at(c)?.drop));
      out.push({
        key: `shift-${k}`,
        title: k === 0 ? "Shift" : `Shift ${k + 1}`,
        caption: true,
        rows: [
          {
            key: `shift-${k}-rpm`,
            label: "RPM",
            avg: { num: (c) => at(c)?.rpm, fmt: (v) => String(Math.round(v)), pct: true },
            cell: (c) => {
              const v = at(c)?.rpm;
              return v === undefined ? DASH : <span style={rpm(v)}>{Math.round(v)}</span>;
            },
          },
          { key: `shift-${k}-when`, label: "When", avg: { num: (c) => at(c)?.at, fmt: (v) => v.toFixed(2), pct: true }, cell: (c) => (at(c) ? <span style={when(at(c)!.at)}>{at(c)!.at.toFixed(2)}</span> : DASH) },
          { key: `shift-${k}-takes`, label: "Duration", avg: { num: (c) => at(c)?.takes, fmt: (v) => v.toFixed(2), pct: true }, cell: (c) => (at(c) ? <span style={takes(at(c)!.takes)}>{at(c)!.takes.toFixed(2)}</span> : DASH) },
          {
            key: `shift-${k}-drop`,
            label: withUnit("Drop", "rpm"),
            avg: { num: (c) => at(c)?.drop, fmt: (v) => Math.round(v).toLocaleString(), pct: true },
            cell: (c) => (at(c) ? <span style={drop(at(c)!.drop)}>{Math.round(at(c)!.drop).toLocaleString()}</span> : DASH),
          },
        ],
      });
    });

    // The pass's health against this vehicle's usual: every check's number on
    // every pass in grey, and in red where the pass did what it usually doesn't
    // — a pressure falling away, a cylinder going lean, an EGT out of line.
    if (any((c) => c.levels.length || c.cylinders.length || undefined)) {
      // In the vehicle's own units, at each unit's usual precision.
      const show = (v: number, slug: string | undefined) => {
        if (!slug) return v.toFixed(1);
        const shown = convertForDisplay(v, slug, unitSystem, unitOverrides);
        return shown.toFixed(getDisplayPrecision(slug, unitSystem, unitOverrides) ?? 1);
      };
      // A difference, not a reading: no offset (a 50 °C gap is 90 °F, not 122).
      const showGap = (v: number, slug: string | undefined) => {
        if (!slug) return v.toFixed(0);
        const gap = convertForDisplay(v, slug, unitSystem, unitOverrides) - convertForDisplay(0, slug, unitSystem, unitOverrides);
        // Temperatures in whole degrees; pressures at their usual precision.
        return slug === "temperature" ? Math.round(gap).toString() : gap.toFixed(getDisplayPrecision(slug, unitSystem, unitOverrides) ?? 1);
      };
      const unitOf = (slug: string | undefined) => (slug ? getDisplayUnit(slug, unitSystem, unitOverrides) ?? "" : "");
      const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
      const tempGap = (c: number) => `${showGap(c, "temperature")} ${unitOf("temperature")}`;
      // "C5" -> "Cylinder 5", "B2" -> "Bank 2", for the sentences.
      const sensor = (label: string) => `${label.startsWith("B") ? "Bank" : "Cylinder"} ${label.slice(1)}`;
      const usualNote = "“Usual” means this vehicle's other passes that are switched on — at least 3 of them.";

      // One plain sentence for a flag: what happened, then what's normal in brackets.
      const describe = (a: Anomaly): { text: string; tip: string } => {
        switch (a.kind) {
          case "low": {
            const { level } = a;
            const unit = unitOf(level.quantitySlug);
            return {
              text: `↓ ${show(level.min, level.quantitySlug)}`,
              tip: `${level.name} fell to ${show(level.min, level.quantitySlug)} ${unit} at ${level.minAt.toFixed(2)} s (normally bottoms out at ${show(a.usualMin, level.quantitySlug)} ${unit}).`,
            };
          }
          case "high": {
            const { level } = a;
            const unit = unitOf(level.quantitySlug);
            return {
              text: `↑ ${show(level.max!, level.quantitySlug)}`,
              tip: `${level.name} rose to ${show(level.max!, level.quantitySlug)} ${unit} at ${(level.maxAt ?? 0).toFixed(2)} s (normally peaks at ${show(a.usualMax, level.quantitySlug)} ${unit}).`,
            };
          }
          case "short": {
            const sf = a.level.shortfall!;
            const unit = unitOf(a.level.quantitySlug);
            return {
              text: `−${showGap(sf.gap, a.level.quantitySlug)}`,
              tip: `${a.level.name} ran ${showGap(sf.gap, a.level.quantitySlug)} ${unit} (${Math.round((sf.gap / sf.expected) * 100)}%) below expected at ${sf.at.toFixed(2)} s: ${show(sf.actual, a.level.quantitySlug)} against ${show(sf.expected, a.level.quantitySlug)} ${unit} expected.`,
            };
          }
          case "target-lean":
            return {
              text: `${a.label} +${pct(a.ratio)}`,
              tip: `${sensor(a.label)} averaged ${pct(a.ratio)} lean of target from 1 s until the throttle came off.`,
            };
          case "lean":
            return {
              text: `${a.label} ${a.seconds.toFixed(2)}s`,
              tip: `${sensor(a.label)} went ${Math.round((a.worst - 1) * 100)}% lean of target for ${a.seconds.toFixed(2)} s, starting at ${a.at.toFixed(2)} s.`,
            };
          case "drift":
            return a.group === "lambda"
              ? {
                  text: `${a.label} ${pct(a.offset)} lean`,
                  tip: `${sensor(a.label)} ran leaner than usual: ${pct(a.offset)} leaner than the other cylinders (normally ${pct(a.usual)}).`,
                }
              : {
                  text: `${a.label} ${a.offset < a.usual ? "cold" : "hot"}`,
                  tip: `${sensor(a.label)} ran ${a.offset < a.usual ? "colder" : "hotter"} than usual: ${showGap(Math.abs(a.offset), a.quantitySlug)} ${unitOf(a.quantitySlug)} ${a.offset < 0 ? "below" : "above"} the other cylinders (normally ${showGap(Math.abs(a.usual), a.quantitySlug)} ${unitOf(a.quantitySlug)} ${a.usual < 0 ? "below" : "above"}).`,
                };
          case "spread":
            return a.group === "lambda"
              ? { text: pct(a.spread), tip: `The cylinders spread ${pct(a.spread)} apart (normally ${pct(a.usual)}).` }
              : {
                  text: `${showGap(a.spread, a.quantitySlug)}°`,
                  tip: `The EGTs spread ${showGap(a.spread, a.quantitySlug)} ${unitOf(a.quantitySlug)} apart (normally ${showGap(a.usual, a.quantitySlug)} ${unitOf(a.quantitySlug)}).`,
                };
          case "egt-odd":
            return {
              text: `${a.label} ${a.offset < 0 ? "cold" : "hot"}`,
              tip: `${sensor(a.label)} ran ${showGap(Math.abs(a.offset), a.quantitySlug)} ${unitOf(a.quantitySlug)} ${a.offset < 0 ? "colder" : "hotter"} than the other cylinders${a.offset < 0 ? " — check it's firing." : " — check it isn't lean."}`,
            };
          case "egt-spike":
            return {
              text: `${a.label} ${show(a.peak, a.quantitySlug)}`,
              tip: `${sensor(a.label)} peaked at ${show(a.peak, a.quantitySlug)} ${unitOf(a.quantitySlug)} (normally about ${show(a.usual, a.quantitySlug)} ${unitOf(a.quantitySlug)}).`,
            };
          case "hot": {
            const unit = unitOf(a.level.quantitySlug);
            return {
              text: `↑ ${show(a.level.max!, a.level.quantitySlug)}`,
              tip: `${a.level.name} reached ${show(a.level.max!, a.level.quantitySlug)} ${unit} — past the ${show(a.limit, a.level.quantitySlug)} ${unit} limit.`,
            };
          }
          case "boost":
            return {
              text: `${a.boost.peak < a.usual ? "↓" : "↑"} ${show(a.boost.peak, "pressure")}`,
              tip: `Boost peaked at ${show(a.boost.peak, "pressure")} ${unitOf("pressure")} at ${a.boost.peakAt.toFixed(2)} s (normally ${show(a.usual, "pressure")} ${unitOf("pressure")}).`,
            };
          case "boost-target":
            return {
              text: `−${showGap(a.boost.targetGap!, "pressure")}`,
              tip: `Boost fell ${showGap(a.boost.targetGap!, "pressure")} ${unitOf("pressure")} short of its target.`,
            };
          case "limiter":
            return {
              text: `${a.limiter.seconds.toFixed(2)}s`,
              tip: `${a.limiter.name} was cutting for ${a.limiter.seconds.toFixed(2)} s, from ${a.limiter.at.toFixed(2)} s.`,
            };
          case "spin":
            return {
              text: `+${(a.ahead * 100).toFixed(1)}%`,
              tip: `The driveshaft ran ${(a.ahead * 100).toFixed(1)}% ahead of usual at ${a.at.toFixed(2)} s, but the 60' was no quicker — the tires spun.`,
            };
          case "slip":
            return {
              text: a.slip.ratio.toFixed(3),
              tip: `The last gear ran ${a.slip.ratio.toFixed(3)} engine turns per driveshaft turn (normally ${a.usual.toFixed(3)}) — slipping more than usual.`,
            };
          case "duty":
            return {
              text: `${a.injector.max.toFixed(0)}%`,
              tip: `${a.injector.name} reached ${a.injector.max.toFixed(1)}% at ${a.injector.at.toFixed(2)} s — out of room.`,
            };
          case "fault":
            return {
              text: shortName(a.fault.name),
              tip: `${a.fault.name} reported a sensor fault for ${a.fault.seconds.toFixed(2)} s, from ${a.fault.at.toFixed(2)} s.`,
            };
        }
      };

      /** A health row: the pass's number in grey, or its flag in red. */
      const healthRow = (
        row: string,
        label: string,
        explain: string[],
        /** `tone: "rich"` shows it blue: off, but the safe way. */
        normal: (c: Col) => { text: string; tip: string; tone?: "rich" } | null,
        /** What the log should show when the value is clicked. */
        focus: (c: Col) => Omit<HealthFocus, "fileId" | "label"> | null,
      ): Row => ({
        key: `health-${row}`,
        alert: true,
        label: (
          <Tip content={<div className="max-w-xs space-y-1">{explain.map((l, i) => <div key={i}>{l}</div>)}</div>}>
            <span className="block max-w-[7.25rem] truncate">{label}</span>
          </Tip>
        ),
        cell: (c: Col) => {
          // Clicking a value opens the log on the moment it's about.
          const f = focus(c);
          const open = f
            ? () => {
                setHealthFocus({ ...f, label, fileId: c.file._id });
                onOpenViewer(c.file._id);
              }
            : undefined;
          // A pass whose throttle came off early was only checked that far:
          // its numbers fade to italics, and say so.
          const cutNote = c.checksCut !== null ? `Only checked to ${c.checksCut.toFixed(2)} s — the throttle came off early.` : null;
          const hits = c.anomalies.filter((a) => a.row === row);
          if (hits.length) {
            const parts = hits.map(describe);
            return (
              <Tip
                content={
                  <div className="space-y-1">
                    {parts.map((p, i) => <div key={i}>{p.tip}</div>)}
                    {cutNote && <div>{cutNote}</div>}
                  </div>
                }
              >
                <span
                  className={`min-w-0 truncate text-right text-xs font-bold text-red-400 ${cutNote ? "italic" : ""} ${open ? "cursor-pointer hover:underline" : ""}`}
                  onClick={open}
                >
                  {parts.map((p) => p.text).join(" ")}
                </span>
              </Tip>
            );
          }
          const n = normal(c);
          if (!n) return DASH;
          return (
            <Tip content={cutNote ? <div className="space-y-1"><div>{n.tip}</div><div>{cutNote}</div></div> : n.tip}>
              <span
                className={`min-w-0 truncate text-right text-xs ${
                  n.tone === "rich" ? `text-sky-400 ${cutNote ? "italic opacity-50" : ""}` : cutNote ? "italic text-muted-foreground/30" : "text-muted-foreground/60"
                } ${open ? "cursor-pointer hover:text-foreground hover:underline" : ""}`}
                onClick={open}
              >
                {n.text}
              </span>
            </Tip>
          );
        },
      });

      // Health is grouped by system, in this order; a group with nothing to
      // show is left out. Labels inside a group drop its name: "Temp", not
      // "Coolant temp".
      const GROUPS = ["Fuel", "Oil", "Coolant", "Trans", "Traction", "Boost", "Engine", "Wideband", "EGT"] as const;
      type Group = (typeof GROUPS)[number];
      const grouped = new Map<Group, Row[]>(GROUPS.map((g) => [g, []]));
      const put = (g: Group, ...rows: Row[]) => grouped.get(g)!.push(...rows);
      const groupOfLevel = (name: string): Group =>
        /battery/i.test(name)
          ? "Engine"
          : /trans|converter|line pressure/i.test(name)
            ? "Trans"
            : /coolant/i.test(name)
              ? "Coolant"
              : /oil/i.test(name)
                ? "Oil"
                : "Fuel";
      // Short and alike, one row each: "Oil Press", "Trans Temp", "Conv Press".
      const inGroup = (name: string, g: Group) => {
        if (/battery/i.test(name)) return "Battery";
        if (/converter/i.test(name)) return "Conv Press";
        const kind = /temp/i.test(name) ? "Temp" : "Press";
        return g === "Fuel" && !/fuel/i.test(name) ? shortName(name) : `${g} ${kind}`;
      };

      // Supplies: one row per pressure the checks watch, and the battery.
      // "Device Battery Voltage" -> "Battery", "Transmission Line Pressure" -> "Trans Line Pressure".
      // Labels that fit the column: "Trans Oil Temperature" -> "Trans temp",
      // "Transmission Line Pressure" -> "Line press.". The full name is in the tooltip.
      const shortName = (name: string) => {
        if (/battery voltage/i.test(name)) return "Battery";
        return name
          .replace(/^Transmission (Line|Oil)\b/i, (_m, part: string) => (part.toLowerCase() === "line" ? "Line" : "Trans"))
          .replace(/^Transmission\b/i, "Trans")
          .replace(/^Torque Converter\b/i, "Conv.")
          .replace(/\bTemperature\b/i, "temp")
          .replace(/\bPressure\b/i, "press.");
      };
      const levelNames: string[] = [];
      for (const c of cols) {
        for (const l of c.levels) {
          if (isCheckedLevel(l) && !levelNames.includes(l.name)) levelNames.push(l.name);
        }
      }
      for (const name of levelNames) {
        const isTemp = cols.some((c) => c.levels.some((l) => l.name === name && l.quantitySlug === "temperature"));
        put(
          groupOfLevel(name),
          healthRow(
            name,
            inGroup(name, groupOfLevel(name)),
            isTemp
              ? [
                  `${name}: the highest it got, from the line until the throttle comes off.`,
                  `Red when it runs ${tempGap(8)} or more above its usual high, or reaches a limit no engine or transmission should — that one from the very first pass.`,
                  usualNote,
                ]
              : [
              `${name}: the lowest point while the throttle is wide open, smoothed over 25 ms so one bad sample can't set it off.`,
              "Red when it falls well below its usual low, or rises well above its usual high: more than 3 times its normal variation, and at least 10% of its level on the line.",
              ...(cols.some((c) => c.levels.some((l) => l.name === name && l.shortfall))
                ? [`Also red, from the very first pass, when it runs 10% or more below ${name} Expected.`]
                : []),
              "Italics: the throttle came off early, so only part of that pass was checked.",
              usualNote,
            ],
            (c) => {
              const l = c.levels.find((x) => x.name === name);
              if (!l) return null;
              const unit = unitOf(l.quantitySlug);
              if (l.quantitySlug === "temperature" && l.max !== undefined) {
                return {
                  text: show(l.max, l.quantitySlug),
                  tip: `Highest ${show(l.max, l.quantitySlug)} ${unit} at ${(l.maxAt ?? 0).toFixed(2)} s, from ${show(l.base, l.quantitySlug)} ${unit} on the line.`,
                };
              }
              return {
                text: show(l.min, l.quantitySlug),
                tip: `Lowest ${show(l.min, l.quantitySlug)} ${unit} at ${l.minAt.toFixed(2)} s${
                  l.max !== undefined ? `, highest ${show(l.max, l.quantitySlug)} ${unit} at ${(l.maxAt ?? 0).toFixed(2)} s` : ""
                }, from ${show(l.base, l.quantitySlug)} ${unit} on the line.${
                  l.shortfall ? ` At most ${showGap(Math.max(0, l.shortfall.gap), l.quantitySlug)} ${unit} below expected.` : ""
                }`,
              };
            },
            // A second either side of the moment that matters: the high when
            // that's what was flagged, otherwise the low.
            (c) => {
              const l = c.levels.find((x) => x.name === name);
              if (!l) return null;
              const flagged = (kind: string) => c.anomalies.some((a) => a.kind === kind && a.row === name);
              // With an expected channel, show it beside the actual.
              const channels = l.shortfall ? [name, l.shortfall.expectedName] : [name];
              const at = flagged("short") && !flagged("low")
                ? l.shortfall!.at
                : (flagged("high") || flagged("hot") || l.quantitySlug === "temperature") && !flagged("low")
                  ? l.maxAt ?? l.minAt
                  : l.minAt;
              return { channels, from: Math.max(-0.5, at - 1), to: at + 1, at };
            },
          ),
        );
      }

      const wholeRunOf = (c: Col) => ({ from: 0, to: c.checksTo ?? 5 });
      if (cols.some((c) => c.boost)) {
        put(
          "Boost",
          healthRow(
            "Boost",
            "Boost",
            [
              "The highest boost while the throttle is wide open, smoothed over 50 ms.",
              `Red when it peaks well away from its usual peak, either way: more than 3 times its normal variation and at least ${showGap(14, "pressure")} ${unitOf("pressure")}.`,
              usualNote,
            ],
            (c) =>
              c.boost
                ? { text: show(c.boost.peak, "pressure"), tip: `Peak ${show(c.boost.peak, "pressure")} ${unitOf("pressure")} at ${c.boost.peakAt.toFixed(2)} s.` }
                : null,
            (c) =>
              c.boost
                ? {
                    channels: c.boost.targetName ? [c.boost.mapName, c.boost.targetName] : [c.boost.mapName],
                    from: Math.max(-0.5, c.boost.peakAt - 1),
                    to: c.boost.peakAt + 1,
                    at: c.boost.peakAt,
                  }
                : null,
          ),
        );
      }
      if (cols.some((c) => c.boost?.targetGap !== undefined)) {
        put(
          "Boost",
          healthRow(
            "Boost vs target",
            "Boost Vs Target",
            [
              "How far boost fell short of its commanded target, from 1 s until the throttle comes off, held 50 ms.",
              `Red at ${showGap(21, "pressure")} ${unitOf("pressure")} or more short, from the very first pass — a leak, a wastegate, or turbos out of map.`,
            ],
            (c) =>
              c.boost?.targetGap !== undefined
                ? { text: showGap(c.boost.targetGap, "pressure"), tip: `At most ${showGap(c.boost.targetGap, "pressure")} ${unitOf("pressure")} below target.` }
                : null,
            (c) =>
              c.boost?.targetName
                ? { channels: [c.boost.mapName, c.boost.targetName], ...wholeRunOf(c) }
                : null,
          ),
        );
      }
      if (cols.some((c) => c.injectors?.length)) {
        put(
          "Fuel",
          healthRow(
            "Injector duty",
            "Inj Duty",
            [
              "The busiest injector stage's highest duty cycle, held 25 ms, from the launch until the throttle comes off.",
              "Red at 90% or more — the injectors are out of room, and any more power runs lean.",
            ],
            (c) => {
              const top = c.injectors?.length ? c.injectors.reduce((a, b) => (b.max > a.max ? b : a)) : null;
              return top ? { text: `${top.max.toFixed(0)}%`, tip: `${top.name}: ${top.max.toFixed(1)}% at ${top.at.toFixed(2)} s.` } : null;
            },
            (c) => {
              const top = c.injectors?.length ? c.injectors.reduce((a, b) => (b.max > a.max ? b : a)) : null;
              return top ? { channels: c.injectors!.map((i) => i.name), from: Math.max(-0.5, top.at - 1), to: top.at + 1, at: top.at } : null;
            },
          ),
        );
      }
      if (cols.some((c) => c.convSlip)) {
        put(
          "Trans",
          healthRow(
            "Converter slip",
            "Conv Slip",
            [
              "Engine RPM over driveshaft RPM in the last gear, from just after the last shift until the throttle comes off.",
              "Red when it runs 3% or more above its usual — a converter or a clutch slipping more than it should.",
              usualNote,
            ],
            (c) => (c.convSlip ? { text: c.convSlip.ratio.toFixed(3), tip: `${c.convSlip.ratio.toFixed(3)} engine turns per driveshaft turn, from ${c.convSlip.from.toFixed(2)} s.` } : null),
            (c) => (c.convSlip ? { channels: ["RPM", "Driveshaft RPM"], from: c.convSlip.from, to: c.checksTo ?? c.convSlip.from + 2 } : null),
          ),
        );
      }
      if (cols.some((c) => c.driveshaft.length)) {
        const others = (c: Col) => [...levelPool].filter(([id]) => id !== c.file._id).map(([, x]) => x);
        put(
          "Traction",
          healthRow(
            "Tire spin",
            "Tire Spin",
            [
              "How far the driveshaft ran ahead of its usual speed at the same moment, from 0.5 s to 1.5 s.",
              "Red at 7% or more ahead with a 60' no quicker than usual — the tires spun. A real hook comes with a better 60'.",
              usualNote,
            ],
            (c) => {
              const s = spinOf({ levels: [], cylinders: [], driveshaft: c.driveshaft }, others(c));
              if (!s) return null;
              return s.ahead > 0
                ? { text: `+${(s.ahead * 100).toFixed(1)}%`, tip: `Driveshaft ${(s.ahead * 100).toFixed(1)}% ahead of usual at ${s.at.toFixed(2)} s.` }
                : { text: "0.0%", tip: "Never ahead of its usual speed." };
            },
            (c) => ({ channels: ["Driveshaft RPM", "RPM"], from: 0, to: 2, at: spinOf({ levels: [], cylinders: [], driveshaft: c.driveshaft }, others(c))?.at }),
          ),
        );
      }
      if (cols.some((c) => c.limiter)) {
        put(
          "Engine",
          healthRow(
            "Limiter",
            "Limiter",
            [
              "How long the rev limiter or an engine cut was cutting, from 0.3 s (after the launch limiter lets go) until the throttle comes off.",
              "Red at 0.05 s or more — it should never cut during the pass.",
            ],
            (c) =>
              c.limiter
                ? c.limiter.seconds > 0
                  ? { text: `${c.limiter.seconds.toFixed(2)}s`, tip: `Cutting ${c.limiter.seconds.toFixed(2)} s from ${c.limiter.at.toFixed(2)} s.` }
                  : { text: "none", tip: "No cut during the pass." }
                : null,
            (c) =>
              c.limiter
                ? { channels: [c.limiter.name], ...(c.limiter.seconds > 0 ? { from: Math.max(-0.5, c.limiter.at - 1), to: c.limiter.at + 1, at: c.limiter.at } : wholeRunOf(c)) }
                : null,
          ),
        );
      }
      if (cols.some((c) => c.faults)) {
        put(
          "Engine",
          healthRow(
            "Sensor faults",
            "Sensor Faults",
            [
              "Any sensor that read fine for the 2 s before the launch, then reported a fault during the pass for 0.02 s or more.",
              "Always red — a sensor dropping out mid-pass is worth a look.",
            ],
            (c) => (c.faults ? { text: "none", tip: "Every sensor that read on the line kept reading." } : null),
            (c) => {
              const f = c.faults?.[0];
              return f ? { channels: c.faults!.map((x) => x.name), from: Math.max(-0.5, f.at - 1), to: f.at + 1, at: f.at } : null;
            },
          ),
        );
      }

      const groupOf = (c: Col, kind: "lambda" | "egt") => c.cylinders.find((g) => g.kind === kind);
      // The whole checked stretch of the pass, for rows about averages.
      const wholeRun = (c: Col) => ({ from: 0, to: c.checksTo ?? 5 });
      if (cols.some((c) => groupOf(c, "lambda")?.lean)) {
        put("Wideband", 
          healthRow(
            "Lean spike",
            "O2 Lean",
            [
              "The longest time any one wideband stays 10% or more lean of target, from 0.15 s until the throttle comes off.",
              "Red at 0.1 s or longer, so a spike anywhere in the pass shows.",
            ],
            (c) => {
              const lean = groupOf(c, "lambda")?.lean;
              if (!lean) return null;
              return lean.label
                ? { text: `${lean.label} ${lean.seconds.toFixed(2)}s`, tip: `Longest: ${sensor(lean.label)}, ${lean.seconds.toFixed(2)} s from ${lean.at.toFixed(2)} s.` }
                : { text: "0.00s", tip: "No wideband went 10% lean of target." };
            },
            (c) => {
              const lean = groupOf(c, "lambda")?.lean;
              if (!lean) return null;
              return lean.label
                ? { cylinders: { kind: "lambda", labels: [lean.label], withTarget: true }, from: Math.max(-0.5, lean.at - 0.5), to: lean.at + lean.seconds + 0.5, at: lean.at }
                : { cylinders: { kind: "lambda", labels: "all", withTarget: true }, ...wholeRun(c) };
            },
          ),
        );
      }
      if (cols.some((c) => { const g = groupOf(c, "lambda"); return g ? targetRatios(g) : null; })) {
        put("Wideband", 
          healthRow(
            "Wideband vs target",
            "O2 Vs Target",
            [
              "Each wideband's average against Target Lambda's average, from 1 s until the throttle comes off. Shown: the one furthest off — + is lean, − is rich.",
              `Red when one averages ${pct(TARGET_OFF)} or more lean of target, from the very first pass. Blue when it's that far rich: off, but the safe way. Grey within ${pct(TARGET_OFF)}.`,
              "Averages hide short spikes — Lean spike catches those.",
            ],
            (c) => {
              const g = groupOf(c, "lambda");
              const r = g ? targetRatios(g) : null;
              if (!g || !r) return null;
              const k = r.reduce((best, v, i) => (Math.abs(v) > Math.abs(r[best]) ? i : best), 0);
              const sign = r[k] >= 0 ? "+" : "−";
              return {
                text: `${g.labels[k]} ${sign}${pct(Math.abs(r[k]))}`,
                tip: `Furthest off: ${sensor(g.labels[k])}, ${pct(Math.abs(r[k]))} ${r[k] >= 0 ? "lean" : "rich"} of target.`,
                tone: r[k] <= -TARGET_OFF ? "rich" : undefined,
              };
            },
            (c) => {
              const hit = c.anomalies.find((a) => a.kind === "target-lean");
              return groupOf(c, "lambda")
                ? {
                    cylinders: { kind: "lambda", labels: hit && hit.kind === "target-lean" ? [hit.label] : "all", withTarget: true },
                    ...wholeRun(c),
                  }
                : null;
            },
          ),
        );
      }
      if (cols.some((c) => groupOf(c, "lambda"))) {
        put("Wideband", 
          healthRow(
            "Wideband drift",
            "O2 Drift",
            [
              "Each wideband's average from 1 s until the throttle comes off, against the average of all of them. Shown: the leanest one.",
              "Red when a cylinder runs 1.7% or more leaner against the others than it usually does, and is now leaner than average.",
              "Averages hide short spikes — Lean spike catches those.",
              usualNote,
            ],
            (c) => {
              const g = groupOf(c, "lambda");
              if (!g) return null;
              const o = offsetsOf(g);
              const k = o.indexOf(Math.max(...o));
              return { text: `${g.labels[k]} ${pct(o[k])}`, tip: `Leanest: ${sensor(g.labels[k])}, ${pct(o[k])} leaner than the average.` };
            },
            (c) => (groupOf(c, "lambda") ? { cylinders: { kind: "lambda", labels: "all" }, ...wholeRun(c) } : null),
          ),
          healthRow(
            "Wideband spread",
            "O2 Spread",
            ["Leanest wideband minus richest, from their averages after 1 s.", "Red when 2.5% or more wider than usual.", usualNote],
            (c) => {
              const g = groupOf(c, "lambda");
              return g ? { text: pct(spreadOf(g)), tip: `Leanest to richest: ${pct(spreadOf(g))}.` } : null;
            },
            (c) => (groupOf(c, "lambda") ? { cylinders: { kind: "lambda", labels: "all" }, ...wholeRun(c) } : null),
          ),
        );
      }
      if (cols.some((c) => groupOf(c, "egt"))) {
        put("EGT", 
          healthRow(
            "EGT spike",
            "EGT Spike",
            [
              "Each EGT's highest point from 0.15 s until the throttle comes off, held at least 50 ms. Shown: the hottest.",
              `Red when a cylinder peaks ${tempGap(100)} or more above its usual peak — or, with no history yet, ${tempGap(200)} above the other cylinders.`,
              usualNote,
            ],
            (c) => {
              const g = groupOf(c, "egt");
              if (!g?.peaks) return null;
              const k = g.peaks.indexOf(Math.max(...g.peaks));
              return { text: `${g.labels[k]} ${show(g.peaks[k], g.quantitySlug)}`, tip: `Hottest peak: ${sensor(g.labels[k])}, ${show(g.peaks[k], g.quantitySlug)} ${unitOf(g.quantitySlug)}.` };
            },
            (c) => (groupOf(c, "egt") ? { cylinders: { kind: "egt", labels: "all" }, ...wholeRun(c) } : null),
          ),
          healthRow(
            "EGT drift",
            "EGT Drift",
            [
              "Each EGT's average from 1 s until the throttle comes off, against the average of all of them. Shown: the one furthest off.",
              `Red when a cylinder sits ${tempGap(50)} or more hotter or colder against the others than it usually does.`,
              usualNote,
            ],
            (c) => {
              const g = groupOf(c, "egt");
              if (!g) return null;
              const o = offsetsOf(g);
              const k = o.reduce((best, v, i) => (Math.abs(v) > Math.abs(o[best]) ? i : best), 0);
              return {
                text: `${g.labels[k]} ${o[k] < 0 ? "−" : "+"}${showGap(Math.abs(o[k]), g.quantitySlug)}`,
                tip: `Furthest off: ${sensor(g.labels[k])}, ${showGap(Math.abs(o[k]), g.quantitySlug)} ${unitOf(g.quantitySlug)} ${o[k] < 0 ? "below" : "above"} the average.`,
              };
            },
            (c) => (groupOf(c, "egt") ? { cylinders: { kind: "egt", labels: "all" }, ...wholeRun(c) } : null),
          ),
          healthRow(
            "EGT spread",
            "EGT Spread",
            [`Hottest EGT minus coldest, from their averages after 1 s. Red when ${tempGap(75)} or more wider than usual.`, usualNote],
            (c) => {
              const g = groupOf(c, "egt");
              return g ? { text: `${showGap(spreadOf(g), g.quantitySlug)}°`, tip: `Hottest to coldest: ${showGap(spreadOf(g), g.quantitySlug)} ${unitOf(g.quantitySlug)}.` } : null;
            },
            (c) => (groupOf(c, "egt") ? { cylinders: { kind: "egt", labels: "all" }, ...wholeRun(c) } : null),
          ),
        );
        // Only with no history to judge drift by; shown when it fires.
        if (cols.some((c) => c.anomalies.some((a) => a.kind === "egt-odd"))) {
          put("EGT", 
            healthRow(
              "EGT odd one out",
              "EGT Odd",
              [
                `With fewer than 3 earlier passes to compare against: a cylinder whose EGT averages ${tempGap(150)} or more off the others.`,
                "Cold can mean it isn't firing; hot can mean it's lean.",
              ],
              () => null,
              (c) => (groupOf(c, "egt") ? { cylinders: { kind: "egt", labels: "all" }, ...wholeRun(c) } : null),
            ),
          );
        }
      }

      // One list, in system order; the labels say which system. Inside a
      // system, pressure before temperature — except coolant, temperature first.
      const kindOrder = (g: Group, r: Row) => {
        const temp = /temp/i.test(r.key);
        return g === "Coolant" ? (temp ? 0 : 1) : temp ? 1 : 0;
      };
      const rows = GROUPS.flatMap((g) => [...grouped.get(g)!].sort((a, b) => kindOrder(g, a) - kindOrder(g, b)));
      if (rows.length) out.push({ key: "health", title: "Health", caption: true, rows });
    }

    if (any((c) => changesAt.get(c.file._id) ?? tuneAt.get(c.file._id) ?? knobMovesAt.get(c.file._id))) {
      out.push({
        key: "changes",
        title: "Changes",
        rows: [
          {
            key: "changes",
            label: "Changes",
            cell: (c) => (
              <ChangesCell
                hardware={changesAt.get(c.file._id) ?? []}
                tune={tuneAt.get(c.file._id) ?? []}
                knobs={knobMovesAt.get(c.file._id)}
              />
            ),
          },
        ],
      });
    }
    return out;
  }, [cols, eighthOnly, eventBests, eventRanges, estScope, onEstScopeChange, raceWeightLb, changesAt, tuneAt, knobMovesAt, unitSystem, unitOverrides]);

  const means = useMemo(
    () => new Map(sections.flatMap((s) => s.rows.map((r) => [r.key, meanOf(r, cols)] as const))),
    [sections, cols],
  );

  const labelCell =
    "sticky left-0 z-10 flex items-center justify-end gap-1 border-r px-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground group-hover:bg-muted";
  const valueCell =
    "flex h-5 items-center justify-end whitespace-nowrap px-2 text-right font-mono text-[13px] tabular-nums group-hover:bg-muted/40";

  return (
    <div className="mt-3 w-fit max-w-full overflow-x-auto rounded-lg border bg-card font-mono">
      <div
        className="grid"
        style={{ gridTemplateColumns: `8.5rem repeat(${cols.length}, 6.5rem) 6.5rem 6.5rem` }}
        onMouseLeave={() => {
          setHoverCol(null);
          setHoverRow(null);
        }}
        onDragOver={(e) => {
          if (dragIdx === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropIdx(dropIdxAt(e));
        }}
        onDrop={(e) => {
          e.preventDefault();
          const to = dropIdxAt(e);
          if (dragIdx !== null && to !== dragIdx && to !== dragIdx + 1) onMove(dragIdx, to);
          setDragIdx(null);
          setDropIdx(null);
        }}
      >
        {/* One date over each day's passes. */}
        <div className="sticky left-0 z-10 bg-card" />
        {cols.reduce<{ day: string; start: number; span: number }[]>((days, c, i) => {
          const last = days[days.length - 1];
          if (last && last.day === c.day) last.span++;
          else days.push({ day: c.day, start: i, span: 1 });
          return days;
        }, []).map((d) => (
          <div
            key={d.start}
            className={`truncate px-2 pt-1.5 text-center text-[10px] font-medium text-muted-foreground ${
              d.start > 0 ? "border-l border-l-foreground/15" : ""
            }`}
            style={{ gridColumn: `span ${d.span}` }}
          >
            {d.day}
          </div>
        ))}
        <div className={AVG_COL} />
        <div />

        {/* Whether each pass counts toward the bests, colours and averages. */}
        <div className="sticky left-0 z-10 bg-card" />
        {cols.map((c, i) => (
          <div
            key={c.file._id}
            className={`flex justify-center pt-1.5 ${colClass(i)}`}
            onMouseEnter={() => {
              setHoverCol(i);
              setHoverRow(null);
            }}
          >
            <Switch
              checked={!c.excluded}
              color={COUNTS_GREEN}
              onChange={(on) => void setExcluded({ id: c.file._id, excluded: !on })}
              title={c.excluded ? "Count this pass again" : "Leave this pass out of the colours and averages"}
            />
          </div>
        ))}
        <div className={AVG_COL} />
        <div />

        {/* A plain way into each pass's log. */}
        <div className="sticky left-0 z-10 bg-card" />
        {cols.map((c, i) => (
          <div
            key={c.file._id}
            className={`px-1.5 pt-1 ${colClass(i)}`}
            onMouseEnter={() => {
              setHoverCol(i);
              setHoverRow(null);
            }}
          >
            <Button
              variant="outline"
              size="xs"
              className="h-5 w-full text-[10px]"
              onClick={() => onOpenViewer(c.file._id)}
            >
              Open
            </Button>
          </div>
        ))}
        <div className={AVG_COL} />
        <div />

        {/* Column heads */}
        <div className={`${labelCell} border-b bg-card`} />
        {cols.map((c, i) => (
          <PassHead
            key={c.file._id}
            col={c}
            index={i}
            className={colClass(i)}
            draggable={armedIdx === i}
            onDragStart={(e) => {
              setDragIdx(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setArmedIdx(null);
              setDragIdx(null);
              setDropIdx(null);
            }}
            onMouseEnter={() => {
              setHoverCol(i);
              setHoverRow(null);
            }}
            onArmDrag={() => armDrag(i)}
            isBest={c.file._id === bestFileId}
            bestForAirMargin={airBest && airBest.id === c.file._id && airBest.id !== bestFileId ? airBest.margin : undefined}
            eventBests={eventBests}
            alignWindow={alignWindow}
            onRaceTiming={onRaceTiming}
            onOpenViewer={() => onOpenViewer(c.file._id)}
            onOpenLogs={onOpenLogs}
            onDelete={() => onDelete(c.file)}
            slipRefs={slipRefs}
          />
        ))}
        <div className={`${AVG_COL} flex items-end justify-end border-b px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-violet-300`}>
          Average
        </div>
        <div className="flex items-end justify-end border-b px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-violet-300/60">
          <Tip content={spreadPct ? "Showing the spread as a share of the average. Click for the raw spread." : "Click to show the spread as a share of the average"}>
            <button type="button" className="cursor-pointer uppercase tracking-wider hover:text-violet-300" onClick={toggleSpreadPct}>
              Spread {spreadPct ? "%" : "±"}
            </button>
          </Tip>
        </div>

        {/* Groups part with a rule; only a group whose labels need it gets a caption. */}
        {(() => {
          let stripe = 0;
          return sections.map((s) => (
          <div key={s.key} className="contents">
            {s.caption && (
              <>
                <div className={`${labelCell} h-5 border-t bg-card pt-1 text-[9px] text-muted-foreground/50`}>{s.title}</div>
                <div className="border-t" style={{ gridColumn: `span ${cols.length + 2}` }} />
              </>
            )}
            {s.rows.map((r, ri) => {
              const rule = ri === 0 && !s.caption ? "border-t" : "";
              const striped = stripe++ % 2 === 1;
              return (
                <div key={r.key} className="group contents">
                  <div
                    className={`${labelCell} ${rule} ${striped ? STRIPE : "bg-card"}`}
                    onMouseEnter={() => setHoverRow(r.key)}
                  >
                    {r.extra && <span className={`mr-auto transition-opacity ${dimmed(r.key)}`}>{r.extra}</span>}
                    <span className={`transition-opacity ${dimmed(r.key)}`}>{r.label}</span>
                  </div>
                  {cols.map((c, i) => (
                    <div
                      key={c.file._id}
                      className={`${valueCell} ${rule} ${r.bold ? "font-bold" : ""} ${colClass(i, striped)}`}
                      onMouseEnter={() => {
                        setHoverCol(i);
                        setHoverRow(r.key);
                      }}
                    >
                      {hoverCol === i && <AvgArrow r={r} c={c} mean={means.get(r.key)} />}
                      <span className={`transition-opacity ${dimmed(r.key)}`}>
                        {c.excluded && !r.alert ? <span className={EXCLUDED}>{r.cell(c)}</span> : r.cell(c)}
                      </span>
                    </div>
                  ))}
                  <div
                    className={`${valueCell} ${rule} ${r.bold ? "font-bold" : ""} ${AVG_COL} ${striped ? STRIPE : ""} text-violet-300`}
                    onMouseEnter={() => {
                      setHoverCol(null);
                      setHoverRow(r.key);
                    }}
                  >
                    <span className={`transition-opacity ${dimmed(r.key)}`}>
                      {means.get(r.key) !== undefined ? r.avg!.fmt(means.get(r.key)!) : null}
                    </span>
                  </div>
                  <div
                    className={`${valueCell} ${rule} ${striped ? STRIPE : ""} text-violet-300/60`}
                    onMouseEnter={() => {
                      setHoverCol(null);
                      setHoverRow(r.key);
                    }}
                  >
                    <span className={`transition-opacity ${dimmed(r.key)}`}>{spreadText(r, cols, means.get(r.key), spreadPct)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          ));
        })()}

        <div className={`${labelCell} border-t bg-card py-1`}>Notes</div>
        {cols.map((c, i) => (
          <div key={c.file._id} className={`min-w-0 border-t px-2 py-1 ${colClass(i)}`} onMouseEnter={() => {
              setHoverCol(i);
              setHoverRow(null);
            }}>
            <NotesCell file={c.file} />
          </div>
        ))}
        <div className={`${AVG_COL} border-t`} />
        <div className="border-t" />
      </div>
    </div>
  );
}

/** A pass's column head: round, headline numbers, trace on hover, and its menu. */
function PassHead({
  col,
  index,
  className,
  draggable,
  onDragStart,
  onDragEnd,
  onMouseEnter,
  onArmDrag,
  isBest,
  bestForAirMargin,
  eventBests,
  alignWindow,
  onRaceTiming,
  onOpenViewer,
  onOpenLogs,
  onDelete,
  slipRefs,
}: {
  col: Col;
  index: number;
  className: string;
  draggable: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onMouseEnter: () => void;
  onArmDrag: () => void;
  isBest: boolean;
  /** Set when this pass was the best for its air; how far ahead on equal air. */
  bestForAirMargin?: number;
  eventBests: MetricBests;
  alignWindow?: { preRace: number; postRace: number };
  onRaceTiming: (fileId: string, info: RaceTimingInfo | null) => void;
  onOpenViewer: () => void;
  onOpenLogs: (fileIds: Id<"files">[]) => void;
  onDelete: () => void;
  slipRefs: CompareSlipRef[];
}) {
  const { file, slip } = col;
  const url = useQuery(api.files.getUrl, { fileId: file._id });
  const updateRound = useMutation(api.files.updateRound);
  const renameFile = useMutation(api.files.rename);
  const removeTimeslip = useMutation(api.timeslips.remove);
  const [editingRound, setEditingRound] = useState(false);
  const [roundDraft, setRoundDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [showSlipForm, setShowSlipForm] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  // Every pass builds its preview, trace shown or not: the lift and launch
  // rows read it.
  const reportTiming = useCallback((info: RaceTimingInfo | null) => onRaceTiming(file._id, info), [onRaceTiming, file._id]);
  const preview = usePassPreview(file, reportTiming);

  // The round lives on the file so it exists before any slip; slips entered
  // before that field existed carry it as a fallback.
  const passRound = file.round ?? slip?.round;
  // Unset round: the one in the file name ("BOISE GAMBLERS E1 4.696"), else the pass number.
  const shownRound =
    passRound ?? file.fileName.split(/\s+/).find((w) => /^[A-Z]{1,2}\d{1,2}$/i.test(w))?.toUpperCase();
  const name = file.fileName.replace(/\.[^.]+$/, "");

  // The headline: full ET when the slip has one, otherwise the eighth-mile pair.
  const quarter = slip?.et !== undefined || slip?.mph !== undefined;
  const heroEt = quarter ? slip?.et : slip?.eighthEt;
  const heroMph = quarter ? slip?.mph : slip?.eighthMph;
  // Ran under the dial — a breakout reads red, like it costs you the round.
  const breakout = slip?.dialIn !== undefined && heroEt !== undefined && heroEt < slip.dialIn;
  const etBest = heroEt !== undefined && heroEt === eventBests[quarter ? "et" : "eighthEt"];
  const mphBest = heroMph !== undefined && heroMph === eventBests[quarter ? "mph" : "eighthMph"];

  /**
   * Opening the signed URL hands back a storage-id filename, and a browser will
   * often render a log in the tab instead of saving it. Pull the blob and save
   * it under the name the racer uploaded.
   */
  const downloadFile = async () => {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const objectUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Big logs on a bad connection are the usual cause; the tab fallback
      // still gets the file even if it lands with the storage id as its name.
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  const saveName = () => {
    let trimmed = nameDraft.trim();
    const ext = file.fileName.match(/\.[^.]+$/)?.[0];
    if (trimmed && ext && !trimmed.endsWith(ext)) trimmed += ext;
    if (trimmed && trimmed !== file.fileName) void renameFile({ id: file._id, fileName: trimmed });
    setEditingName(false);
  };

  return (
    <>
      <div
        data-col-head={index}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onMouseEnter={onMouseEnter}
        className={`group/head relative flex min-w-0 flex-col border-b px-2 pb-1 pt-1 ${className}`}
      >
        <Tip content="Drag to reorder">
          <span
            className="absolute left-0 top-1 cursor-grab text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground active:cursor-grabbing group-hover/head:opacity-100"
            onMouseDown={onArmDrag}
          >
            <GripVerticalIcon className="size-3" />
          </span>
        </Tip>
        <div className="flex items-center">
          {editingRound ? (
            <input
              className="w-12 border-b border-primary bg-transparent font-mono text-xs font-semibold uppercase outline-none"
              value={roundDraft}
              autoFocus
              placeholder="Q1"
              onChange={(e) => setRoundDraft(e.target.value.toUpperCase())}
              onBlur={() => {
                void updateRound({ id: file._id, round: roundDraft.trim().toUpperCase() || undefined });
                setEditingRound(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingRound(false);
              }}
            />
          ) : (
            <Tip content={`${name} — click to set the round`}>
            <button
              type="button"
              className="min-w-0 cursor-text truncate font-mono text-xs font-semibold uppercase tracking-wider decoration-muted-foreground/50 hover:underline"
              onClick={() => {
                setRoundDraft(passRound ?? "");
                setEditingRound(true);
              }}
            >
              {shownRound ?? <span className="text-muted-foreground/60">#{index + 1}</span>}
            </button>
            </Tip>
          )}
          <div className="ml-auto -mr-1 flex items-center">
            <Popover>
              <PopoverTrigger
                openOnHover
                delay={150}
                nativeButton={false}
                render={
                  <span
                    className="cursor-pointer rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-foreground"
                    onClick={onOpenViewer}
                    aria-label="Trace — click to open the log"
                  />
                }
              >
                <ActivityIcon className="size-3" />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[26rem] p-2">
                <div className="h-[120px] cursor-pointer" onClick={onOpenViewer}>
                  <RpmTrace status={preview} alignWindow={alignWindow} height={120} />
                </div>
                <div className="mt-1 flex gap-3 px-1 text-[10px] text-muted-foreground">
                  <span className="text-red-400">RPM</span>
                  <span className="text-green-400">Throttle</span>
                  <span className="text-blue-400">Driveshaft</span>
                  <span className="ml-auto truncate">{name}</span>
                </div>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" />}
              >
                <MoreVerticalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                <DropdownMenuItem
                  onClick={() => {
                    setRoundDraft(passRound ?? "");
                    // After the menu closes — it hands focus back to its trigger,
                    // which would blur the editor shut the moment it mounts.
                    setTimeout(() => setEditingRound(true), 120);
                  }}
                >
                  <PencilIcon />
                  Set round
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setNameDraft(name);
                    setTimeout(() => setEditingName(true), 120);
                  }}
                >
                  <PencilIcon />
                  Rename pass
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!url || downloading} onClick={() => void downloadFile()}>
                  <DownloadIcon />
                  {downloading ? "Downloading…" : "Download log"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowSlipForm(true)}>
                  {slip ? <PencilIcon /> : <PlusIcon />}
                  {slip ? "Edit timeslip" : "Add timeslip"}
                </DropdownMenuItem>
                {slip && (
                  <>
                    <DropdownMenuItem
                      // One slip is this one; a second gives it an opponent.
                      disabled={slipRefs.length < 2}
                      onClick={() => setShowCompare(true)}
                    >
                      <ArrowLeftRightIcon />
                      Compare slip
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm("Delete this timeslip?")) void removeTimeslip({ id: slip._id });
                      }}
                    >
                      <TrashIcon />
                      Delete timeslip
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <TrashIcon />
                  Delete file
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {editingName ? (
          <input
            className="w-full border-b border-primary bg-transparent text-[11px] outline-none"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditingName(false);
            }}
          />
        ) : slip ? (
          <button
            type="button"
            className="cursor-pointer text-right font-mono leading-tight tabular-nums"
            onClick={onOpenViewer}
          >
            <Tip content={breakout ? "Broke out — ran under the dial. Click to open the log" : "Click to open the log"}>
              <span
                className={`block text-[15px] font-semibold ${breakout ? "text-red-400" : etBest || isBest ? "text-green-400" : ""}`}
              >
                {heroEt !== undefined ? heroEt.toFixed(3) : "—"}
              </span>
            </Tip>
            <span className="flex items-center justify-end gap-1 text-[11px]">
              {isBest && (
                // The win light: solid green, black text, like the bulb at the stripe.
                <Tip content="Quickest pass of the event">
                  <span className="mr-auto rounded-sm bg-green-500 px-0.5 font-sans text-[8px] font-bold uppercase tracking-wider text-black">
                    Best
                  </span>
                </Tip>
              )}
              {bestForAirMargin !== undefined && (
                <Tip
                  content={`Quickest pass once the air is evened out — ${bestForAirMargin.toFixed(3)}s ahead of the next on equal air. Track conditions aren't counted.`}
                >
                  <span className="mr-auto rounded-sm border border-sky-400/70 px-0.5 font-sans text-[8px] font-bold uppercase tracking-wider text-sky-300">
                    Air
                  </span>
                </Tip>
              )}
              {heroMph !== undefined && (
                <span className={mphBest ? "text-green-400" : "text-muted-foreground"}>{heroMph.toFixed(2)}</span>
              )}
            </span>
          </button>
        ) : (
          <Button variant="outline" size="xs" className="mt-1 self-end" onClick={() => setShowSlipForm(true)}>
            <PlusIcon />
            Slip
          </Button>
        )}
      </div>

      <TimeslipForm
        open={showSlipForm}
        onOpenChange={setShowSlipForm}
        fileId={file._id}
        round={passRound}
        timeslip={slip}
        onDone={() => setShowSlipForm(false)}
      />
      {slip && (
        <SlipCompareDialog
          open={showCompare}
          onOpenChange={setShowCompare}
          currentId={slip._id}
          slips={slipRefs}
          onOpenLogs={onOpenLogs}
        />
      )}
    </>
  );
}

/** What changed before this pass: hardware in amber, tune and knobs behind a popover. */
function ChangesCell({
  hardware,
  tune,
  knobs,
}: {
  hardware: Doc<"changes">[];
  tune: TuneTabChange[];
  knobs?: KnobMoves;
}) {
  if (!hardware.length && !tune.length && !knobs) return DASH;
  const tuneLabel = tune.length ? "Tune" : "Knobs";
  return (
    <div className="flex min-w-0 flex-col items-end gap-1 py-0.5 font-sans">
      {hardware.map((c) => (
        <Tip
          key={c._id}
          content={
            <div>
              <div>
                {categoryLabel(c.category)}: {c.title}
              </div>
              {(c.items ?? []).map((l) => (
                <div key={l} className="pl-2">
                  {l}
                </div>
              ))}
            </div>
          }
        >
          <span className="max-w-full truncate rounded border border-amber-400/50 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-amber-300">
            {categoryLabel(c.category)} · {c.title}
          </span>
        </Tip>
      ))}
      {(tune.length > 0 || knobs) && (
        <Popover>
          <PopoverTrigger
            openOnHover
            delay={150}
            nativeButton={false}
            render={
              <span
                className="flex cursor-pointer items-center gap-1 rounded border border-sky-400/40 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-sky-300 transition-colors hover:bg-sky-400/10"
              />
            }
          >
            <span className="size-1.5 rounded-full bg-sky-400" />
            {tuneLabel}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <TuneChanges changes={tune} knobMoves={knobs} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** What this pass ran differently from the one before. */
function TuneChanges({ changes, knobMoves }: { changes: TuneTabChange[]; knobMoves?: KnobMoves }) {
  return (
    <div className="space-y-3">
      {knobMoves && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Knobs since {knobMoves.fromLabel}
          </div>
          <div className="mt-1 divide-y divide-border/50">
            {knobMoves.moves.map((m) => (
              <p key={m.name} className="py-2 text-[13px] leading-snug text-foreground/90">
                Moved {m.name} from row {m.from} to <span className="font-semibold text-foreground">row {m.to}</span>
              </p>
            ))}
          </div>
        </div>
      )}
      {changes.map(({ change, fromLabel }) => (
        <div key={change._id}>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {change.category === "firmware" ? "ECU firmware" : `Changed since ${fromLabel ?? "the pass before"}`}
          </div>
          {change.category === "firmware" && <div className="mt-1 text-sm font-medium">{change.title}</div>}
          <div className="mt-1">
            <TuneChangeList change={change} compact />
          </div>
          {change.notes && <p className="mt-1 text-[10px] leading-snug text-muted-foreground/60">{change.notes}</p>}
        </div>
      ))}
    </div>
  );
}

/** The pass's note, edited in place. */
function NotesCell({ file }: { file: Doc<"files"> }) {
  const updateNotes = useMutation(api.files.updateNotes);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(file.notes ?? "");
  const save = async () => {
    await updateNotes({ id: file._id, notes: notes.trim() || undefined });
    setEditing(false);
  };
  return editing ? (
    <Textarea
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      placeholder="Run notes, observations..."
      rows={3}
      autoFocus
      className="min-h-0 px-1.5 py-1 text-xs"
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setNotes(file.notes ?? "");
          setEditing(false);
        }
      }}
    />
  ) : (
    <Tip content="Click to edit the note">
      <p
        className={`cursor-text whitespace-pre-wrap break-words text-xs ${file.notes ? "text-muted-foreground" : "text-muted-foreground/30"}`}
        onClick={() => {
          setNotes(file.notes ?? "");
          setEditing(true);
        }}
      >
        {file.notes || "Add a note"}
      </p>
    </Tip>
  );
}

/** An estimated value that opens its math lesson on hover or click. */
function EstimateLine({ value, children }: { value: React.ReactNode; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        nativeButton={false}
        render={<span className="cursor-help decoration-muted-foreground/40 decoration-dotted underline-offset-2 hover:underline" />}
      >
        {value}
      </PopoverTrigger>
      <PopoverContent align="end">{children}</PopoverContent>
    </Popover>
  );
}

/** One numbered step marker in the estimate lesson. */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[10px] font-bold text-primary-foreground">
      {n}
    </span>
  );
}

/** The full working behind one estimated number, spelled out step by step:
 *  the ratio each no-lift pass teaches, their average, and the multiply. */
function EstimateExplainer({
  metric,
  value,
  intro,
  step1,
  refs,
  ratio,
  step2,
  calcLeft,
  scope,
}: {
  metric: string;
  value: string;
  intro: string;
  step1: string;
  refs: RefDetail[];
  ratio: number;
  step2: string;
  calcLeft: string;
  scope: "event" | "all";
}) {
  const SHOW = 4;
  return (
    <div className="space-y-3 text-left font-sans">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          No-lift estimate · {metric}
        </div>
        <div className="font-mono text-2xl font-semibold tabular-nums text-green-400">≈ {value}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{intro}</p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-start gap-2 text-xs leading-relaxed">
          <StepBadge n={1} />
          <p>{step1}</p>
        </div>
        <div className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs tabular-nums">
          {refs.slice(0, SHOW).map((r, i) => (
            <div key={i} className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">
                {r.final} ÷ {r.split}
              </span>
              <span className="text-amber-300">{r.ratio.toFixed(4)}</span>
            </div>
          ))}
          {refs.length > SHOW && (
            <div className="py-0.5 text-muted-foreground/60">…and {refs.length - SHOW} more</div>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-border/60 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Average</span>
            <span className="font-semibold text-amber-300">{ratio.toFixed(4)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-start gap-2 text-xs leading-relaxed">
          <StepBadge n={2} />
          <p>{step2}</p>
        </div>
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-xs tabular-nums">
          <span className="text-muted-foreground">{calcLeft}</span>
          <span className="font-semibold text-green-400">≈ {value}</span>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {scope === "event"
          ? `Built from ${refs.length} no-lift ${refs.length === 1 ? "pass" : "passes"} at this event.`
          : `Built from the car's last ${refs.length} no-lift ${refs.length === 1 ? "pass" : "passes"}, any event.`}{" "}
        It is an estimate — the car, the air and the track decide the real number.
      </p>
    </div>
  );
}

/** The formula and caveats behind one weight-derived power number. */
function WeightPowerExplainer({
  method,
  distance,
  raceWeightLb,
  observed,
  estimateHp,
}: {
  method: "E.T." | "MPH";
  distance: "1/4" | "1/8";
  raceWeightLb: number;
  observed: number;
  estimateHp: number;
}) {
  const isEt = method === "E.T.";
  const conversion = isEt ? 1.57 : 1.25;
  const equivalent = distance === "1/8" ? observed * conversion : observed;
  const formula = isEt
    ? `${raceWeightLb.toLocaleString()} ÷ (${equivalent.toFixed(3)} ÷ 5.825)³`
    : `${raceWeightLb.toLocaleString()} × (${equivalent.toFixed(2)} ÷ 234)³`;

  return (
    <div className="space-y-3 text-left font-sans">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Weight estimate · {method}
        </div>
        <div className="font-mono text-2xl font-semibold tabular-nums text-green-400">
          ≈ {Math.round(estimateHp).toLocaleString()} hp
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Estimated from the {raceWeightLb.toLocaleString()} lb race weight and this pass&apos;s {distance}-mile{" "}
          {isEt ? "elapsed time" : "trap speed"}.
        </p>
      </div>

      {distance === "1/8" && (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-xs tabular-nums">
          <span className="text-muted-foreground">
            {observed} × {conversion}
          </span>
          <span>{equivalent.toFixed(isEt ? 3 : 2)} quarter equivalent</span>
        </div>
      )}

      <div className="rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-xs tabular-nums">
        <div className="text-muted-foreground">{formula}</div>
        <div className="mt-1 text-right font-semibold text-green-400">≈ {Math.round(estimateHp).toLocaleString()} hp</div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        This is a track-side estimate, not a dyno measurement. Traction, aero, weather, gearing, and lifting can all
        move the result.
      </p>
    </div>
  );
}

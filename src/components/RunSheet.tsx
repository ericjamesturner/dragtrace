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
import type { UnitOverrides, UnitSystem } from "@/lib/units";
import { correctionFactor } from "@/lib/weather-correction";
import { categoryLabel } from "@/lib/changes";
import { timeFromName } from "@/lib/tune-changes";
import { parsePreview } from "@/lib/preview";
import { DRIVESHAFT_TIMES, type DriveshaftReading, type ShiftReading } from "@/lib/pass-readings";
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
  segs: Partial<Record<SegmentKey, number>>;
  cf?: number;
  power: WeightPowerEstimates | null;
  estimate?: PassEstimate;
  /** The day it ran, as shown: NSP's stamp in the file name, else the upload day. */
  day: string;
  /** Unticked by the racer: shown grey, and left out of bests, colours and averages. */
  excluded: boolean;
}

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
    <Tip content={`${gap > 0 ? "+" : "−"}${size} from the average (${shown})`} delay={0}>
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
  /** The row's number per pass, for the average column. Rows without one leave it blank. */
  avg?: {
    num: (c: Col) => number | undefined;
    fmt: (v: number) => string;
    /** Which way is better, for the hover arrow's colour. Unset: neither — a reading, not a result. */
    better?: "low" | "high";
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
    [files, slipsByFile, unitSystem, unitOverrides, raceWeightLb, estimates]
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
      },
      cell: (c) => {
        const v = c.slip?.[key];
        if (v === undefined) return DASH;
        if (key === "rt" && v < 0) return <span className="text-red-400">{v}</span>;
        // Only the hero ET shows a breakout; the rows rank the passes, nothing more.
        if (v === eventBests[key]) return <span className="text-green-400">{v}</span>;
        return <span style={shadeStyle(key, v, eventRanges)}>{v}</span>;
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
            cell: (c) => c.slip?.delayBox ?? DASH,
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
              if (pkg.foul) return <span className="text-red-400">{text}</span>;
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
          avg: { num: (c: Col) => c.segs[s.key], fmt: (v: number) => v.toFixed(3), better: "low" as const },
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
        avg: { num: (c) => hpOf(c, method), fmt: (v) => Math.round(v).toLocaleString(), better: "high" },
        label: <span title={`Estimated from the ${raceWeightLb.toLocaleString()} lb race weight`}>≈ HP from {method}</span>,
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
            <span className="text-amber-300/90" title="How long before the finish the throttle came out">
              {Math.max(0, c.passLen - c.lift.finalLift).toFixed(2)}s
            </span>
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
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="font-sans text-[10px] normal-case tracking-normal text-muted-foreground/60 transition-colors hover:text-foreground"
                title="Which no-lift passes the estimate learns from"
              />
            }
          >
            {estScope === "event" ? "event" : "all"} ▾
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onEstScopeChange("event")}>This event</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEstScopeChange("all")}>All data</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
    ) => {
      const style = spreadStyler(inc.map(get), higherIsBetter);
      const better: "low" | "high" | undefined = ranked ? (higherIsBetter ? "high" : "low") : undefined;
      return {
        key,
        label,
        has: get,
        avg: { num: get, fmt: show, better },
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
      airRow("baro", "Baro inHg", (c) => c.slip?.barometricPressureInHg, (v) => String(Math.round(v * 1000) / 1000), true),
      airRow("da", "D.A. ft", (c) => c.slip?.densityAltitudeFt, (v) => Math.round(v).toLocaleString()),
      airRow("cf", "Corr.", (c) => c.cf, (v) => v.toFixed(4)),
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
            <span
              title={[speed !== undefined ? `${speed} mph` : "", dir].filter(Boolean).join(" · ")}
              style={windStyle(windHelp(dir))}
            >
              {dir || speed}
            </span>
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
            avg: { num, fmt: (v: number) => (places ? v.toFixed(places) : String(Math.round(v))) },
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
      const when = spreadStyler(inc.map((c) => at(c)?.at));
      const takes = spreadStyler(inc.map((c) => at(c)?.takes));
      const drop = spreadStyler(inc.map((c) => at(c)?.drop));
      out.push({
        key: `shift-${k}`,
        title: k === 0 ? "Shift" : `Shift ${k + 1}`,
        caption: true,
        rows: [
          { key: `shift-${k}-when`, label: "When", avg: { num: (c) => at(c)?.at, fmt: (v) => v.toFixed(2) }, cell: (c) => (at(c) ? <span style={when(at(c)!.at)}>{at(c)!.at.toFixed(2)}</span> : DASH) },
          { key: `shift-${k}-takes`, label: "Takes", avg: { num: (c) => at(c)?.takes, fmt: (v) => v.toFixed(2) }, cell: (c) => (at(c) ? <span style={takes(at(c)!.takes)}>{at(c)!.takes.toFixed(2)}</span> : DASH) },
          {
            key: `shift-${k}-drop`,
            label: withUnit("Drop", "rpm"),
            avg: { num: (c) => at(c)?.drop, fmt: (v) => Math.round(v).toLocaleString() },
            cell: (c) => (at(c) ? <span style={drop(at(c)!.drop)}>{Math.round(at(c)!.drop).toLocaleString()}</span> : DASH),
          },
        ],
      });
    });

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
  }, [cols, eighthOnly, eventBests, eventRanges, estScope, onEstScopeChange, raceWeightLb, changesAt, tuneAt, knobMovesAt]);

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
        style={{ gridTemplateColumns: `8rem repeat(${cols.length}, 5.5rem) 5.5rem` }}
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
            title={d.day}
          >
            {d.day}
          </div>
        ))}
        <div className={AVG_COL} />

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
        <div className={`${AVG_COL} flex items-end justify-end border-b px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground`}>
          Avg
        </div>

        {/* Groups part with a rule; only a group whose labels need it gets a caption. */}
        {(() => {
          let stripe = 0;
          return sections.map((s) => (
          <div key={s.key} className="contents">
            {s.caption && (
              <>
                <div className={`${labelCell} h-5 border-t bg-card pt-1 text-[9px] text-muted-foreground/50`}>{s.title}</div>
                <div className="border-t" style={{ gridColumn: `span ${cols.length + 1}` }} />
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
                        {c.excluded ? <span className={EXCLUDED}>{r.cell(c)}</span> : r.cell(c)}
                      </span>
                    </div>
                  ))}
                  <div
                    className={`${valueCell} ${rule} ${r.bold ? "font-bold" : ""} ${AVG_COL} ${striped ? STRIPE : ""} text-muted-foreground`}
                    onMouseEnter={() => {
                      setHoverCol(null);
                      setHoverRow(r.key);
                    }}
                  >
                    <span className={`transition-opacity ${dimmed(r.key)}`}>
                      {means.get(r.key) !== undefined ? r.avg!.fmt(means.get(r.key)!) : null}
                    </span>
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
        <span
          className="absolute left-0 top-1 cursor-grab text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground active:cursor-grabbing group-hover/head:opacity-100"
          onMouseDown={onArmDrag}
          title="Drag to reorder"
        >
          <GripVerticalIcon className="size-3" />
        </span>
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
            <button
              type="button"
              className="min-w-0 cursor-text truncate font-mono text-xs font-semibold uppercase tracking-wider decoration-muted-foreground/50 hover:underline"
              title={`${name} — click to set the round`}
              onClick={() => {
                setRoundDraft(passRound ?? "");
                setEditingRound(true);
              }}
            >
              {shownRound ?? <span className="text-muted-foreground/60">#{index + 1}</span>}
            </button>
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
            title="Open the log"
          >
            <span
              className={`block text-[15px] font-semibold ${breakout ? "text-red-400" : etBest || isBest ? "text-green-400" : ""}`}
            >
              {heroEt ?? "—"}
            </span>
            <span className="flex items-center justify-end gap-1 text-[11px]">
              {isBest && (
                // The win light: solid green, black text, like the bulb at the stripe.
                <span className="mr-auto rounded-sm bg-green-500 px-0.5 font-sans text-[8px] font-bold uppercase tracking-wider text-black">
                  Best
                </span>
              )}
              {bestForAirMargin !== undefined && (
                <span
                  className="mr-auto rounded-sm border border-sky-400/70 px-0.5 font-sans text-[8px] font-bold uppercase tracking-wider text-sky-300"
                  title={`Quickest pass once the air is evened out — ${bestForAirMargin.toFixed(3)}s ahead of the next on equal air. Track conditions aren't counted.`}
                >
                  Air
                </span>
              )}
              {heroMph !== undefined && (
                <span className={mphBest ? "text-green-400" : "text-muted-foreground"}>{heroMph}</span>
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
        <span
          key={c._id}
          className="max-w-full truncate rounded border border-amber-400/50 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-amber-300"
          title={[`${categoryLabel(c.category)}: ${c.title}`, ...(c.items ?? []).map((l) => `  ${l}`)].join("\n")}
        >
          {categoryLabel(c.category)} · {c.title}
        </span>
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
    <p
      className={`cursor-text whitespace-pre-wrap break-words text-xs ${file.notes ? "text-muted-foreground" : "text-muted-foreground/30"}`}
      onClick={() => {
        setNotes(file.notes ?? "");
        setEditing(true);
      }}
      title="Click to edit the note"
    >
      {file.notes || "Add a note"}
    </p>
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

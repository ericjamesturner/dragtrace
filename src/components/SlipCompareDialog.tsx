import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import { SEGMENTS, segmentTimes } from "@/lib/timeslip-segments";

const FT_PER_SEC_PER_MPH = 5280 / 3600;

/** One slip with enough context to name it outside its own event page. */
export interface CompareSlipRef {
  slip: Doc<"timeslips">;
  /** File name without extension — how the gallery labels the pass. */
  passName: string;
  round?: string;
  eventName: string;
  /** The event's start date string, for grouping and ordering the picker. */
  eventDate: string;
  /** No-lift projections, when the pass lifted and the math had references. */
  estEt?: number;
  estMph?: number;
  /** The pass note ("Spun down low") — context the analysis should hear. */
  notes?: string;
}

interface CompareRow {
  label: string;
  a?: number;
  b?: number;
  /** Which direction wins: times read low, trap speeds read high. */
  better: "low" | "high";
  dp: number;
  /** A red light is a foul, not a win — the value reads red, the gap goes quiet. */
  redLight?: boolean;
  /** ≈-prefix per side, where the value is a no-lift projection. */
  approxA?: boolean;
  approxB?: boolean;
}

function fmt(v: number | undefined, dp: number, approx?: boolean): string {
  return v !== undefined ? `${approx ? "≈" : ""}${v.toFixed(dp)}` : "—";
}

/** Flatten one side into what the analysis action wants to hear about. */
function toAnalysisInput(s: CompareSlipRef) {
  const t = s.slip;
  return {
    name: s.passName,
    event: s.eventName,
    date: s.eventDate,
    notes: s.notes,
    estEt: s.estEt,
    estMph: s.estMph,
    round: s.round,
    delayBox: t.delayBox,
    rt: t.rt,
    sixtyFt: t.sixtyFt,
    threeThirty: t.threeThirty,
    eighthEt: t.eighthEt,
    eighthMph: t.eighthMph,
    thousandFt: t.thousandFt,
    et: t.et,
    mph: t.mph,
    dialIn: t.dialIn,
  };
}

/** Which side takes the line, if either: null on fouls, dashes and dead heats. */
function winnerOf(row: CompareRow): "a" | "b" | null {
  if (row.a === undefined || row.b === undefined) return null;
  if (row.redLight && (row.a < 0 || row.b < 0)) return null;
  const d = Number((row.a - row.b).toFixed(row.dp));
  if (d === 0) return null;
  return (row.better === "low" ? d < 0 : d > 0) ? "a" : "b";
}

/** The margin between the lanes: size only, arrow at the winner. The arrow
 *  slots are always reserved, so the numbers stack in one straight column. */
function GapCell({ row }: { row: CompareRow }) {
  const dead =
    row.a === undefined ||
    row.b === undefined ||
    (row.redLight && (row.a < 0 || row.b < 0));
  const win = dead ? null : winnerOf(row);
  const mag = dead
    ? "—"
    : win === null
      ? "="
      : Math.abs(row.a! - row.b!).toFixed(row.dp);
  const cls = win === null ? "text-muted-foreground/40" : "text-green-400/90";
  return (
    <span className="grid grid-cols-[0.7rem_1fr_0.7rem] items-baseline">
      <span className={win === "a" ? cls : "invisible"}>◀</span>
      <span className={`text-right ${cls}`}>{mag}</span>
      <span className={`justify-self-end ${win === "b" ? cls : "invisible"}`}>▶</span>
    </span>
  );
}

/** Two-line name for a slip: the pass, then where it ran. */
function SlipHeading({ s }: { s: CompareSlipRef }) {
  return (
    <>
      <div className="truncate font-medium">
        {s.round ? `${s.round} · ` : ""}
        {s.passName}
      </div>
      <div className="truncate font-sans text-[10px] text-muted-foreground">
        {s.eventName}
      </div>
    </>
  );
}

/**
 * This pass's slip beside any other slip the car has, from any event, with the
 * gap on every line. Opens against the car's quickest other pass; the picker
 * swaps in anything else.
 */
export function SlipCompareDialog({
  open,
  onOpenChange,
  currentId,
  slips,
  onOpenLogs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The slip on the card that opened the dialog. */
  currentId: Id<"timeslips">;
  /** Every slip the car has, current one included. */
  slips: CompareSlipRef[];
  /** Open the viewer with these files overlaid — the "why" behind the gap. */
  onOpenLogs: (fileIds: Id<"files">[]) => void;
}) {
  const [pickedId, setPickedId] = useState<Id<"timeslips"> | null>(null);

  const compareAnalysis = useAction(api.timeslips.compareAnalysis);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(false);

  const current = slips.find((s) => s.slip._id === currentId);
  const others = useMemo(
    () => slips.filter((s) => s.slip._id !== currentId),
    [slips, currentId],
  );

  // Until the racer picks, compare against the car's quickest other pass at
  // this slip's distance — the question is almost always "vs my best".
  const fallback = useMemo(() => {
    if (others.length === 0) return null;
    const key: "et" | "eighthEt" = current?.slip.et !== undefined ? "et" : "eighthEt";
    let best: CompareSlipRef | null = null;
    for (const o of others) {
      const v = o.slip[key];
      if (v === undefined) continue;
      if (best === null || v < (best.slip[key] as number)) best = o;
    }
    return best ?? others[0];
  }, [others, current]);

  const other = others.find((s) => s.slip._id === pickedId) ?? fallback;

  // A new opponent is a new comparison — the old breakdown no longer applies.
  const otherId = other?.slip._id ?? null;
  useEffect(() => {
    setAnalysis(null);
    setAnalysisError(false);
  }, [otherId, currentId]);

  const handleAnalyze = async () => {
    if (!current || !other || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(false);
    try {
      const text = await compareAnalysis({
        current: toAnalysisInput(current),
        other: toAnalysisInput(other),
      });
      setAnalysis(text);
    } catch {
      setAnalysisError(true);
    } finally {
      setAnalyzing(false);
    }
  };

  // The picker, grouped by event in the order the slips already carry
  // (newest event first, passes in run order).
  const groups = useMemo(() => {
    const out: { title: string; refs: CompareSlipRef[] }[] = [];
    for (const o of others) {
      const title = `${o.eventName}${o.eventDate ? ` — ${o.eventDate}` : ""}`;
      const g = out[out.length - 1];
      if (g && g.title === title) g.refs.push(o);
      else out.push({ title, refs: [o] });
    }
    return out;
  }, [others]);

  const rows: CompareRow[] | null = useMemo(() => {
    if (!current || !other) return null;
    const a = current.slip;
    const b = other.slip;
    const segA = segmentTimes(a);
    const segB = segmentTimes(b);
    const all: CompareRow[] = [
      { label: "R.T.", a: a.rt, b: b.rt, better: "low", dp: 3, redLight: true },
      { label: "60'", a: a.sixtyFt, b: b.sixtyFt, better: "low", dp: 3 },
      { label: "330'", a: a.threeThirty, b: b.threeThirty, better: "low", dp: 3 },
      { label: "1/8", a: a.eighthEt, b: b.eighthEt, better: "low", dp: 3 },
      { label: "1/8 MPH", a: a.eighthMph, b: b.eighthMph, better: "high", dp: 2 },
      { label: "1000'", a: a.thousandFt, b: b.thousandFt, better: "low", dp: 3 },
      { label: "1/4", a: a.et, b: b.et, better: "low", dp: 3 },
      { label: "MPH", a: a.mph, b: b.mph, better: "high", dp: 2 },
    ];
    // Back-half charge: how much the car picked up from the 1/8 lights to
    // the stripe. A quarter-only number — an eighth slip has one trap.
    const gainA =
      a.mph !== undefined && a.eighthMph !== undefined ? a.mph - a.eighthMph : undefined;
    const gainB =
      b.mph !== undefined && b.eighthMph !== undefined ? b.mph - b.eighthMph : undefined;
    if (gainA !== undefined || gainB !== undefined) {
      all.push({ label: "MPH GAIN", a: gainA, b: gainB, better: "high", dp: 2 });
    }
    // No-lift projections: a lifted pass shows its ≈ number; a flat pass
    // stands on its real one, so the gap still means something.
    if (current.estEt !== undefined || other.estEt !== undefined) {
      all.push({
        label: "EST. E.T.",
        a: current.estEt ?? a.et ?? a.eighthEt,
        b: other.estEt ?? b.et ?? b.eighthEt,
        approxA: current.estEt !== undefined,
        approxB: other.estEt !== undefined,
        better: "low",
        dp: 3,
      });
    }
    if (current.estMph !== undefined || other.estMph !== undefined) {
      all.push({
        label: "EST. MPH",
        a: current.estMph ?? a.mph ?? a.eighthMph,
        b: other.estMph ?? b.mph ?? b.eighthMph,
        approxA: current.estMph !== undefined,
        approxB: other.estMph !== undefined,
        better: "high",
        dp: 2,
      });
    }
    const splits: CompareRow[] = SEGMENTS.map((s) => ({
      label: s.label,
      a: segA[s.key],
      b: segB[s.key],
      better: "low",
      dp: 3,
    }));
    // A line neither slip has says nothing — two eighth-mile slips drop the
    // whole back half instead of comparing dashes.
    return [
      ...all.filter((r) => r.a !== undefined || r.b !== undefined),
      ...splits.filter((r) => r.a !== undefined || r.b !== undefined),
    ];
  }, [current, other]);

  const splitStart = rows
    ? rows.length - rows.filter((r) => SEGMENTS.some((s) => s.label === r.label)).length
    : 0;

  // The final margin as distance: how far back the trailing car is when the
  // leader crosses, at the trailing car's own trap speed. An estimate — the
  // slips are from different passes, but the speeds barely move.
  const stripe = useMemo(() => {
    if (!current || !other) return null;
    const a = current.slip;
    const b = other.slip;
    const at = (fa?: number, fb?: number, ma?: number, mb?: number) => {
      if (fa === undefined || fb === undefined || fa === fb) return null;
      const trailMph = fa > fb ? ma : mb;
      if (trailMph === undefined || trailMph <= 0) return null;
      const gap = Math.abs(fa - fb);
      return {
        gap,
        mph: trailMph,
        feet: gap * trailMph * FT_PER_SEC_PER_MPH,
        lead: fa < fb ? ("a" as const) : ("b" as const),
      };
    };
    return at(a.et, b.et, a.mph, b.mph) ?? at(a.eighthEt, b.eighthEt, a.eighthMph, b.eighthMph);
  }, [current, other]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compare slips</DialogTitle>
        </DialogHeader>

        {!current || !other || !rows ? (
          <p className="text-sm text-muted-foreground">
            The car has no other slip to compare against yet.
          </p>
        ) : (
          <div className="font-mono text-xs tabular-nums">
            {/* Column headings: the two lanes, the margin between them. */}
            <div className="grid grid-cols-[4.5rem_1fr_4rem_1fr] items-end gap-x-3 pb-2">
              <span />
              <div className="min-w-0 text-right">
                <div className="pb-0.5 font-sans text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  This pass
                </div>
                <SlipHeading s={current} />
              </div>
              <span />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button className="min-w-0 rounded-sm text-right transition-colors hover:bg-muted/50" />
                  }
                >
                  <div className="flex items-center justify-end gap-0.5 pb-0.5 font-sans text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Compare to
                    <ChevronDownIcon className="size-3" />
                  </div>
                  <SlipHeading s={other} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
                  {groups.map((g) => (
                    <DropdownMenuGroup key={g.title}>
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {g.title}
                      </DropdownMenuLabel>
                      {g.refs.map((o) => {
                        const et = o.slip.et ?? o.slip.eighthEt;
                        return (
                          <DropdownMenuItem
                            key={o.slip._id}
                            onClick={() => setPickedId(o.slip._id)}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {o.round ? `${o.round} · ` : ""}
                              {o.passName}
                            </span>
                            {et !== undefined && (
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {et.toFixed(3)}
                              </span>
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuGroup>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Separator />

            <div className="pt-1.5">
              {rows.map((r, i) => {
                const win = winnerOf(r);
                // The quicker side reads green; a red light reads red instead.
                const cellClass = (v: number | undefined, side: "a" | "b") =>
                  r.redLight && v !== undefined && v < 0
                    ? "text-red-400"
                    : win === side
                      ? "text-green-400"
                      : "";
                return (
                  <div key={r.label}>
                    {i === splitStart && splitStart > 0 && <Separator className="my-1.5" />}
                    <div className="grid grid-cols-[4.5rem_1fr_4rem_1fr] gap-x-3 py-0.5">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className={`text-right ${cellClass(r.a, "a")}`}>
                        {fmt(r.a, r.dp, r.approxA)}
                      </span>
                      <GapCell row={r} />
                      <span className={`text-right ${cellClass(r.b, "b")}`}>
                        {fmt(r.b, r.dp, r.approxB)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {stripe && (
              <p className="pt-3 text-center text-[11px] text-foreground/80">
                {stripe.lead === "a" ? "This pass" : "The other pass"} reaches the
                stripe ≈{stripe.feet.toFixed(0)} ft ahead
                <span className="text-muted-foreground">
                  {" "}
                  ({stripe.gap.toFixed(3)} s at {stripe.mph.toFixed(0)} mph)
                </span>
              </p>
            )}

            <div className="flex gap-2 pt-3">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => onOpenLogs([current.slip.fileId, other.slip.fileId])}
              >
                Open both logs
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={analyzing}
                onClick={() => void handleAnalyze()}
              >
                {analyzing ? "Analyzing…" : "Analyze"}
              </Button>
            </div>

            {analysisError && (
              <p className="pt-2 font-sans text-[11px] text-red-400">
                The analysis failed. Try again.
              </p>
            )}
            {analysis && (
              <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2.5 font-sans text-xs leading-relaxed whitespace-pre-wrap">
                {analysis}
              </div>
            )}

            <p className="pt-3 font-sans text-[11px] leading-relaxed text-muted-foreground">
              The middle number is the gap on that line; the arrow points at
              the pass that took it.
              {rows.some((r) => r.approxA || r.approxB) &&
                " An ≈ number is the no-lift estimate for a lifted pass."}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

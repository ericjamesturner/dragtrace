import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { detectHaltech, detectRaceStartIndex, parseHaltech } from "@/lib/haltech-parser";
import { lttbDownsample } from "@/lib/downsample";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

// Bump when the preview computation changes so stored previews recompute.
const PREVIEW_VERSION = 1;

// Stored window around the race — wider than the rendered window so the
// dashboard lead-in/tail can be tuned without recomputing stored previews.
const STORE_PRE_RACE_S = 5;
const STORE_POST_RACE_S = 8;

export interface RaceTimingInfo {
  raceStart: number;  // seconds from log start to race start
  raceEnd: number;    // seconds from log start to where the race timer stops counting
  logDuration: number; // total log duration in seconds
}

interface PreviewPayload {
  version: number;
  timestamps: number[];
  rpm: (number | null)[];
  tps: (number | null)[] | null;
  dsRpm: (number | null)[] | null;
  raceStart: number | null;
  raceEnd: number | null;
  logDuration: number;
}

type Status =
  | { kind: "loading" }
  | { kind: "ready"; payload: PreviewPayload }
  | { kind: "no-data"; message: string };

interface RpmPreviewProps {
  file: Doc<"files">;
  onRaceTiming?: (info: RaceTimingInfo | null) => void;
  alignWindow?: { preRace: number; postRace: number };
}

function computePreview(text: string): PreviewPayload | string {
  if (!detectHaltech(text)) return "Not a Haltech log";

  const parsed = parseHaltech(text);
  if (parsed.sessions.length === 0) return "No sessions";

  const session = parsed.sessions[0];
  const rpm = session.channels.get("RPM");
  if (!rpm) return "No RPM data";

  const timestamps = session.timestamps;

  // Find race timer region
  const raceTimer = session.channels.get("Race Timer") ?? session.channels.get("Race Time");
  let raceStart: number | null = null;
  let raceEnd: number | null = null;
  if (raceTimer) {
    const start = detectRaceStartIndex(raceTimer);
    if (start !== null) {
      // The timer holds its final value after the run, so the region ends
      // at the last sample where it was still counting up.
      let end = start;
      for (let i = start + 1; i < raceTimer.length; i++) {
        if (raceTimer[i] > raceTimer[i - 1]) end = i;
      }
      raceStart = timestamps[start];
      raceEnd = timestamps[end];
    }
  }

  // Store a window around the race at high resolution; without race data,
  // fall back to the whole log.
  let lo = 0;
  let hi = timestamps.length;
  let points = 400;
  if (raceStart !== null && raceEnd !== null) {
    const xMin = raceStart - STORE_PRE_RACE_S;
    const xMax = raceEnd + STORE_POST_RACE_S;
    while (lo < hi && timestamps[lo] < xMin) lo++;
    while (hi > lo && timestamps[hi - 1] > xMax) hi--;
    // keep one sample beyond each edge so lines reach the plot border
    if (lo > 0) lo--;
    if (hi < timestamps.length) hi++;
    points = 800;
  }

  const tsSlice = timestamps.subarray(lo, hi);
  const downValues = (values: Float64Array) =>
    Array.from(
      lttbDownsample(tsSlice, values.subarray(lo, hi), points).values,
      (v) => (Number.isNaN(v) ? null : v),
    );

  const tps = session.channels.get("Throttle Position");
  const dsRpm = session.channels.get("Driveshaft RPM");

  return {
    version: PREVIEW_VERSION,
    timestamps: Array.from(lttbDownsample(tsSlice, rpm.subarray(lo, hi), points).timestamps),
    rpm: downValues(rpm),
    tps: tps ? downValues(tps) : null,
    dsRpm: dsRpm ? downValues(dsRpm) : null,
    raceStart,
    raceEnd,
    logDuration: timestamps[timestamps.length - 1],
  };
}

export function RpmPreview({ file, onRaceTiming, alignWindow }: RpmPreviewProps) {
  const stored = useMemo<PreviewPayload | null>(() => {
    if (!file.preview) return null;
    try {
      const p = JSON.parse(file.preview) as PreviewPayload;
      return p.version === PREVIEW_VERSION ? p : null;
    } catch {
      return null;
    }
  }, [file.preview]);

  // Only fetch the raw log when there is no stored preview to reuse.
  const url = useQuery(api.files.getUrl, stored ? "skip" : { storageId: file.storageId });
  const savePreview = useMutation(api.files.savePreview);
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const onRaceTimingRef = useRef(onRaceTiming);
  onRaceTimingRef.current = onRaceTiming;

  useEffect(() => {
    if (!stored) return;
    setStatus({ kind: "ready", payload: stored });
  }, [stored]);

  // No stored preview: fetch, parse, compute, persist
  useEffect(() => {
    if (stored || !url) return;

    let cancelled = false;

    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        if (cancelled) return;
        const result = computePreview(text);
        if (typeof result === "string") {
          setStatus({ kind: "no-data", message: result });
          return;
        }
        setStatus({ kind: "ready", payload: result });
        void savePreview({ id: file._id, preview: JSON.stringify(result) });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ kind: "no-data", message: "" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [stored, url, file._id, savePreview]);

  // Report race timing for dashboard alignment
  useEffect(() => {
    if (status.kind !== "ready") return;
    const p = status.payload;
    onRaceTimingRef.current?.(
      p.raceStart !== null && p.raceEnd !== null
        ? { raceStart: p.raceStart, raceEnd: p.raceEnd, logDuration: p.logDuration }
        : null,
    );
  }, [status]);

  // Wait for alignment before rendering charts that have race data
  const alignReady = status.kind === "ready" && status.payload.raceStart !== null
    ? alignWindow !== undefined
    : true;

  // Render chart — only when data is ready AND alignment is resolved
  useEffect(() => {
    if (status.kind !== "ready" || !alignReady || !chartRef.current) return;

    const el = chartRef.current;
    const { timestamps, rpm, tps, dsRpm, raceStart } = status.payload;
    const width = el.clientWidth || 600;

    const data = [
      timestamps,
      rpm,
      ...(tps ? [tps] : []),
      ...(dsRpm ? [dsRpm] : []),
    ] as unknown as uPlot.AlignedData;

    const series: uPlot.Series[] = [
      {},
      {
        label: "RPM",
        stroke: "rgba(59, 130, 246, 0.8)",
        width: 1.5,
        fill: "rgba(59, 130, 246, 0.08)",
        scale: "rpm",
        spanGaps: true,
      },
    ];

    const axes: uPlot.Axis[] = [
      { show: false },
      { show: false, scale: "rpm" },
    ];

    const scales: uPlot.Scales = {
      rpm: { auto: true },
    };

    if (alignWindow && raceStart !== null) {
      scales.x = {
        auto: false,
        range: [raceStart - alignWindow.preRace, raceStart + alignWindow.postRace] as [number, number],
      };
    }

    if (tps) {
      series.push({
        label: "TPS",
        stroke: "rgba(34, 197, 94, 0.7)",
        width: 1,
        scale: "tps",
        spanGaps: true,
      });
      axes.push({ show: false, scale: "tps" });
      scales.tps = { auto: false, range: [0, 100] };
    }

    if (dsRpm) {
      series.push({
        label: "DS RPM",
        stroke: "rgba(249, 115, 22, 0.7)",
        width: 1,
        scale: "rpm",
        spanGaps: true,
      });
      axes.push({ show: false, scale: "rpm" });
    }

    const plugins: uPlot.Plugin[] = [];

    if (raceStart !== null) {
      plugins.push({
        hooks: {
          draw: [
            (u: uPlot) => {
              const ctx = u.ctx;
              const x0 = u.valToPos(raceStart, "x", true);
              const y0 = u.bbox.top;
              const h = u.bbox.height;

              ctx.save();
              ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x0, y0);
              ctx.lineTo(x0, y0 + h);
              ctx.stroke();
              ctx.restore();
            },
          ],
        },
      });
    }

    const plot = new uPlot(
      {
        width,
        height: 120,
        cursor: { show: false },
        select: { show: false, left: 0, top: 0, width: 0, height: 0 },
        legend: { show: false },
        axes,
        series,
        scales,
        plugins,
        padding: [4, 0, 4, 0],
      },
      data,
      el,
    );
    uplotRef.current = plot;

    return () => {
      plot.destroy();
      uplotRef.current = null;
      el.innerHTML = "";
    };
  }, [status, alignReady, alignWindow]);

  if (status.kind === "loading") {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (status.kind === "no-data") {
    return status.message ? (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {status.message}
      </div>
    ) : null;
  }

  return <div ref={chartRef} className="w-full" />;
}

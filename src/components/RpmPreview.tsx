import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { detectHaltech, parseHaltech } from "@/lib/haltech-parser";
import { lttbDownsample } from "@/lib/downsample";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

type ChartData = [number[], number[], ...number[][]];

interface RaceRegion {
  startTime: number;
  endTime: number;
}

interface ParsedResult {
  data: ChartData;
  hasTps: boolean;
  hasDsRpm: boolean;
  raceRegion: RaceRegion | null;
}

type Status =
  | { kind: "loading" }
  | { kind: "ready"; parsed: ParsedResult }
  | { kind: "no-data"; message: string };

export interface RaceTimingInfo {
  raceStart: number;  // seconds from log start to race start
  logDuration: number; // total log duration in seconds
}

interface RpmPreviewProps {
  storageId: Id<"_storage">;
  onRaceTiming?: (info: RaceTimingInfo | null) => void;
  alignWindow?: { preRace: number; postRace: number };
}

export function RpmPreview({ storageId, onRaceTiming, alignWindow }: RpmPreviewProps) {
  const url = useQuery(api.files.getUrl, { storageId });
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const onRaceTimingRef = useRef(onRaceTiming);
  onRaceTimingRef.current = onRaceTiming;

  // Fetch and parse
  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        if (cancelled) return;

        if (!detectHaltech(text)) {
          setStatus({ kind: "no-data", message: "Not a Haltech log" });
          return;
        }

        const parsed = parseHaltech(text);
        if (parsed.sessions.length === 0) {
          setStatus({ kind: "no-data", message: "No sessions" });
          return;
        }

        const session = parsed.sessions[0];
        const rpm = session.channels.get("RPM");
        if (!rpm) {
          setStatus({ kind: "no-data", message: "No RPM data" });
          return;
        }

        const rpmDown = lttbDownsample(session.timestamps, rpm, 200);

        // Find race timer region
        const raceTimer = session.channels.get("Race Timer") ?? session.channels.get("Race Time");
        let raceRegion: RaceRegion | null = null;
        if (raceTimer) {
          let start = -1;
          let end = -1;
          for (let i = 0; i < raceTimer.length; i++) {
            if (raceTimer[i] > 0) {
              if (start === -1) start = i;
              end = i;
            }
          }
          if (start !== -1) {
            raceRegion = {
              startTime: session.timestamps[start],
              endTime: session.timestamps[end],
            };
          }
        }

        const logDuration = session.timestamps[session.timestamps.length - 1];
        onRaceTimingRef.current?.(raceRegion
          ? { raceStart: raceRegion.startTime, logDuration }
          : null,
        );

        const tps = session.channels.get("Throttle Position");
        const dsRpm = session.channels.get("Driveshaft RPM");
        const hasTps = !!tps;
        const hasDsRpm = !!dsRpm;
        const data: ChartData = [
          Array.from(rpmDown.timestamps),
          Array.from(rpmDown.values),
        ];
        if (tps) data.push(Array.from(lttbDownsample(session.timestamps, tps, 200).values));
        if (dsRpm) data.push(Array.from(lttbDownsample(session.timestamps, dsRpm, 200).values));

        setStatus({ kind: "ready", parsed: { data, hasTps, hasDsRpm, raceRegion } });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ kind: "no-data", message: "" });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Wait for alignment before rendering charts that have race data
  const alignReady = status.kind === "ready" && status.parsed.raceRegion
    ? alignWindow !== undefined
    : true;

  // Render chart — only when data is ready AND alignment is resolved
  useEffect(() => {
    if (status.kind !== "ready" || !alignReady || !chartRef.current) return;

    const el = chartRef.current;
    const { data, hasTps, hasDsRpm, raceRegion } = status.parsed;
    const width = el.clientWidth || 600;

    const series: uPlot.Series[] = [
      {},
      {
        label: "RPM",
        stroke: "rgba(59, 130, 246, 0.8)",
        width: 1.5,
        fill: "rgba(59, 130, 246, 0.08)",
        scale: "rpm",
      },
    ];

    const axes: uPlot.Axis[] = [
      { show: false },
      { show: false, scale: "rpm" },
    ];

    const scales: uPlot.Scales = {
      rpm: { auto: true },
    };

    if (alignWindow && raceRegion) {
      const xMin = raceRegion.startTime - alignWindow.preRace;
      const xMax = raceRegion.startTime + alignWindow.postRace;
      scales.x = {
        auto: false,
        range: [xMin, xMax] as [number, number],
      };
    }

    if (hasTps) {
      series.push({
        label: "TPS",
        stroke: "rgba(34, 197, 94, 0.7)",
        width: 1,
        scale: "tps",
      });
      axes.push({ show: false, scale: "tps" });
      scales.tps = { auto: false, range: [0, 100] };
    }

    if (hasDsRpm) {
      series.push({
        label: "DS RPM",
        stroke: "rgba(249, 115, 22, 0.7)",
        width: 1,
        scale: "rpm",
      });
      axes.push({ show: false, scale: "rpm" });
    }

    const plugins: uPlot.Plugin[] = [];

    if (raceRegion) {
      const { startTime } = raceRegion;
      plugins.push({
        hooks: {
          draw: [
            (u: uPlot) => {
              const ctx = u.ctx;
              const x0 = u.valToPos(startTime, "x", true);
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

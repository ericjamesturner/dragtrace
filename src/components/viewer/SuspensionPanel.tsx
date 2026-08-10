import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Id } from "../../../convex/_generated/dataModel";
import type { LoadedLog } from "@/lib/viewer-types";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";

/**
 * A little 3D truck that moves the way the car did: each corner rides its
 * shock-travel channel, so scrubbing the charts (or pressing play) shows the
 * launch squat, the front-end rise and the side-to-side rock as motion
 * instead of four separate lines.
 *
 * Geometry is stylized and the travel is auto-scaled to readable motion —
 * the *shape* of the motion is real, the amplitude is exaggerated.
 */

const CORNERS = [
  { key: "fl", channel: "Shock Travel Front Left", x: 1.45, z: -0.85 },
  { key: "fr", channel: "Shock Travel Front Right", x: 1.45, z: 0.85 },
  { key: "rl", channel: "Shock Travel Rear Left", x: -1.35, z: -0.85 },
  { key: "rr", channel: "Shock Travel Rear Right", x: -1.35, z: 0.85 },
] as const;

/** Biggest visual corner deflection, in scene units. */
const MAX_DEFLECT = 0.45;
const RIDE_HEIGHT = 0.62;

interface CornerData {
  data: Float64Array;
  baseline: number;
}

interface SuspensionData {
  fileId: Id<"files">;
  fileName: string;
  timestamps: Float64Array;
  corners: Record<string, CornerData>;
  /** Travel units per scene unit — shared so corners stay comparable. */
  scale: number;
  playStart: number;
  playEnd: number;
}

/** Linear interp of a channel at time t (log timebase), NaN-tolerant. */
function valueAt(ts: Float64Array, data: Float64Array, t: number): number | null {
  const n = ts.length;
  if (n === 0 || t < ts[0] || t > ts[n - 1]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const a = data[lo];
  const b = data[hi];
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : null;
  if (!Number.isFinite(b)) return a;
  const span = ts[hi] - ts[lo];
  return span > 0 ? a + ((b - a) * (t - ts[lo])) / span : a;
}

/** First loaded log carrying all four shock channels, prepped for animation. */
function buildSuspensionData(logs: LoadedLog[]): SuspensionData | null {
  for (const log of logs) {
    const session = log.parsed.sessions[log.activeSessionIndex];
    if (!session || log.raceStartTime === null) continue;
    const ts = session.timestamps;
    const channels = CORNERS.map((c) => session.channels.get(c.channel));
    if (channels.some((c) => !c)) continue;

    const t0 = log.raceStartTime;
    const corners: Record<string, CornerData> = {};
    let maxDelta = 0;
    for (let ci = 0; ci < CORNERS.length; ci++) {
      const data = channels[ci]!;
      // Static ride height: the second before the launch, car staged.
      let sum = 0;
      let count = 0;
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] < t0 - 1.2 || ts[i] > t0 - 0.1) continue;
        const v = data[i];
        if (Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
      if (count === 0) break;
      const baseline = sum / count;
      corners[CORNERS[ci].key] = { data, baseline };
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] < t0) continue;
        const v = data[i];
        if (Number.isFinite(v)) maxDelta = Math.max(maxDelta, Math.abs(v - baseline));
      }
    }
    if (Object.keys(corners).length < 4 || maxDelta === 0) continue;

    return {
      fileId: log.fileId,
      fileName: log.fileName.replace(/\.[^.]+$/, ""),
      timestamps: ts,
      corners,
      scale: maxDelta / MAX_DEFLECT,
      playStart: Math.max(ts[0], t0 - 1),
      playEnd: ts[ts.length - 1],
    };
  }
  return null;
}

/** The scene: ground, a boxy truck, four wheels, four struts. */
function buildScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    32,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100,
  );
  camera.position.set(4.6, 2.1, 5.4);
  camera.lookAt(0, 0.55, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 6, 4);
  scene.add(sun);

  const grid = new THREE.GridHelper(14, 28, 0x2a2a2e, 0x1c1c1f);
  grid.position.y = 0;
  scene.add(grid);

  // Chassis group — everything sprung lives in here.
  const chassis = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.55 });
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x701616, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.2 });

  const bed = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.42, 1.7), bodyMat);
  bed.position.set(-0.1, 0.21, 0);
  chassis.add(bed);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.34, 1.6), bodyMat);
  hood.position.set(1.05, 0.56, 0);
  chassis.add(hood);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.62, 1.55), glassMat);
  cab.position.set(0.12, 0.7, 0);
  chassis.add(cab);
  const bedwall = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.34, 1.7), bedMat);
  bedwall.position.set(-1.05, 0.56, 0);
  chassis.add(bedwall);
  scene.add(chassis);

  // Unsprung: wheels sit on the ground and stay there.
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 });
  const wheels: Record<string, THREE.Mesh> = {};
  for (const c of CORNERS) {
    const rear = c.x < 0;
    const r = rear ? 0.5 : 0.38;
    const w = rear ? 0.44 : 0.26;
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 24), tireMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(c.x, r, c.z + (c.z > 0 ? w / 2 : -w / 2));
    scene.add(wheel);
    wheels[c.key] = wheel;
  }

  // Struts: one thin bar per corner, wheel hub to chassis corner.
  const struts: Record<string, THREE.Mesh> = {};
  for (const c of CORNERS) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.4 });
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 10), mat);
    scene.add(strut);
    struts[c.key] = strut;
  }

  return { renderer, scene, camera, chassis, struts };
}

export function SuspensionPanel({
  logs,
  offsets,
  cursorTime,
}: {
  logs: LoadedLog[];
  offsets: Map<Id<"files">, number>;
  cursorTime: number | null;
}) {
  const data = useMemo(() => buildSuspensionData(logs), [logs]);
  const [hidden, setHidden] = useState(false);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const playheadRef = useRef<number | null>(null);
  const clockLabelRef = useRef<HTMLSpanElement>(null);

  // The chart cursor is in display time; this log's samples are in its own
  // timebase, one alignment offset apart.
  const offset = data ? (offsets.get(data.fileId) ?? 0) : 0;
  cursorRef.current = cursorTime !== null ? cursorTime - offset : null;
  playingRef.current = playing;

  useEffect(() => {
    if (!data || hidden || !canvasRef.current) return;
    const { renderer, scene, camera, chassis, struts } = buildScene(canvasRef.current);
    const t0Wall = performance.now();
    let raf = 0;

    const poseAt = (t: number) => {
      const h: Record<string, number> = {};
      for (const c of CORNERS) {
        const corner = data.corners[c.key];
        const v = valueAt(data.timestamps, corner.data, t);
        h[c.key] = v === null ? 0 : (v - corner.baseline) / data.scale;
      }
      const heave = (h.fl + h.fr + h.rl + h.rr) / 4;
      const front = (h.fl + h.fr) / 2;
      const rear = (h.rl + h.rr) / 2;
      const left = (h.fl + h.rl) / 2;
      const right = (h.fr + h.rr) / 2;
      const wheelbase = CORNERS[0].x - CORNERS[2].x;
      const track = CORNERS[1].z - CORNERS[0].z;
      chassis.position.y = RIDE_HEIGHT + heave;
      chassis.rotation.z = Math.atan2(front - rear, wheelbase);
      chassis.rotation.x = Math.atan2(right - left, track);
      for (const c of CORNERS) {
        const strut = struts[c.key];
        const rear2 = c.x < 0;
        const hubY = rear2 ? 0.5 : 0.38;
        // Chassis corner height, small-angle: heave + pitch/roll shares.
        const cornerY =
          RIDE_HEIGHT +
          heave +
          (c.x / (wheelbase / 2)) * ((front - rear) / 2) +
          (c.z / (track / 2)) * ((right - left) / 2);
        const len = Math.max(0.1, cornerY - hubY + 0.18);
        strut.position.set(c.x, hubY + len / 2 - 0.09, c.z);
        strut.scale.y = len;
        // Compressed reads warm, extended reads cool.
        const d = h[c.key];
        const mat = strut.material as THREE.MeshStandardMaterial;
        if (d < -0.02) mat.color.setRGB(1, 0.45 + Math.max(0, 0.45 + d), 0.35);
        else if (d > 0.02) mat.color.setRGB(0.45, 0.65, 1);
        else mat.color.setRGB(0.73, 0.73, 0.73);
      }
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      let t: number | null;
      if (playingRef.current) {
        if (playheadRef.current === null) playheadRef.current = data.playStart;
        playheadRef.current += 1 / 60;
        if (playheadRef.current >= data.playEnd) {
          playheadRef.current = null;
          playingRef.current = false;
          setPlaying(false);
          t = data.playEnd;
        } else {
          t = playheadRef.current;
        }
        if (clockLabelRef.current && t !== null) {
          const raceT = t - (logs.find((l) => l.fileId === data.fileId)?.raceStartTime ?? 0);
          clockLabelRef.current.textContent =
            raceT >= 0 ? `+${raceT.toFixed(2)}s` : `${raceT.toFixed(2)}s`;
        }
      } else {
        t = cursorRef.current;
        if (clockLabelRef.current) clockLabelRef.current.textContent = "";
      }
      if (t !== null) poseAt(t);
      else if (performance.now() - t0Wall < 500) poseAt(data.playStart);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hidden]);

  if (!data || hidden) return null;

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-20 w-[300px] overflow-hidden rounded-lg border bg-card/95 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Suspension
        </span>
        <span
          ref={clockLabelRef}
          className="font-mono text-[10px] tabular-nums text-amber-300/90"
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
            title={playing ? "Pause" : "Replay the pass"}
            onClick={() => {
              playheadRef.current = null;
              setPlaying((p) => !p);
            }}
          >
            {playing ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
          </button>
          <button
            className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
            title="Hide"
            onClick={() => setHidden(true)}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} className="block h-[190px] w-full" />
      <div className="border-t px-2.5 py-1 text-[10px] leading-snug text-muted-foreground">
        Rides the shock-travel channels — hover a chart to scrub. Motion is
        exaggerated to read.
      </div>
    </div>
  );
}

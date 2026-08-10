import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
 *
 * The card drags by its header and resizes from the corner grip; both stick
 * in localStorage.
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
const WHEEL_R_FRONT = 0.38;
const WHEEL_R_REAR = 0.5;

/** Header + footer chrome around the canvas, px. */
const CHROME_H = 62;
const MIN_W = 260;
const MAX_W = 780;
const MIN_H = 240;
const MAX_H = 620;

const LAYOUT_KEY = "dragtrace:suspension-panel";

interface PanelLayout {
  x: number | null;
  y: number | null;
  w: number;
  h: number;
}

function loadLayout(): PanelLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as PanelLayout;
      return {
        x: typeof p.x === "number" ? p.x : null,
        y: typeof p.y === "number" ? p.y : null,
        w: Math.min(MAX_W, Math.max(MIN_W, p.w || 300)),
        h: Math.min(MAX_H, Math.max(MIN_H, p.h || 260)),
      };
    }
  } catch {
    // ignore
  }
  return { x: null, y: null, w: 300, h: 260 };
}

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
  raceStart: number;
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
      raceStart: t0,
    };
  }
  return null;
}

/** One wheel: tire cylinder + lighter rim disc, sitting on the ground. */
function makeWheel(rear: boolean): THREE.Group {
  const r = rear ? WHEEL_R_REAR : WHEEL_R_FRONT;
  const w = rear ? 0.46 : 0.24;
  const g = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, w, 28),
    new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92 }),
  );
  g.add(tire);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.52, r * 0.52, w + 0.02, 20),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.6 }),
  );
  g.add(rim);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.16, r * 0.16, w + 0.06, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4 }),
  );
  g.add(hub);
  g.rotation.x = Math.PI / 2;
  return g;
}

/** The scene: ground, a boxy drag truck, wheels, telescoping shocks. */
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
  camera.position.set(4.8, 2.2, 5.6);
  camera.lookAt(0, 0.55, 0);

  // Orbit: drag the scene to walk around the truck, scroll to zoom.
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.55, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 3.5;
  controls.maxDistance = 13;
  // Keep the camera above the deck — under-floor views read as a glitch.
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8899cc, 0.35);
  fill.position.set(-4, 3, -3);
  scene.add(fill);

  const grid = new THREE.GridHelper(14, 28, 0x2a2a2e, 0x1c1c1f);
  scene.add(grid);
  // Center groove — the racing line under the truck.
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 1 }),
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = 0.005;
  scene.add(stripe);

  // ---- Chassis group: everything sprung. Truck faces +x. ----
  const chassis = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.42, metalness: 0.15 });
  const paintDark = new THREE.MeshStandardMaterial({ color: 0x6d1414, roughness: 0.5, metalness: 0.1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.15, metalness: 0.4 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.25, metalness: 0.7 });

  const addBox = (
    mat: THREE.Material,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    rz = 0,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    if (rz) m.rotation.z = rz;
    chassis.add(m);
    return m;
  };

  // Frame floor pan
  addBox(black, 3.9, 0.12, 1.5, 0, 0.06, 0);
  // Rocker/body sides along the bottom
  addBox(paintDark, 3.9, 0.3, 1.7, 0, 0.25, 0);
  // Hood + front clip
  addBox(paint, 1.25, 0.34, 1.62, 1.32, 0.57, 0);
  // Hood scoop
  addBox(black, 0.55, 0.16, 0.62, 1.35, 0.82, 0);
  // Cowl
  addBox(paint, 0.28, 0.4, 1.62, 0.62, 0.6, 0);
  // Windshield, raked back
  addBox(glass, 0.06, 0.62, 1.42, 0.42, 0.94, 0, -0.42);
  // Roof
  addBox(paint, 0.78, 0.08, 1.5, -0.08, 1.2, 0);
  // Cab rear wall + side glass block
  addBox(glass, 0.7, 0.44, 1.44, -0.05, 0.94, 0);
  addBox(paint, 0.1, 0.5, 1.5, -0.46, 0.92, 0);
  // Bed floor
  addBox(paintDark, 1.5, 0.12, 1.6, -1.25, 0.45, 0);
  // Bed side walls
  addBox(paint, 1.5, 0.34, 0.12, -1.25, 0.62, -0.78);
  addBox(paint, 1.5, 0.34, 0.12, -1.25, 0.62, 0.78);
  // Tailgate
  addBox(paint, 0.1, 0.34, 1.6, -1.97, 0.62, 0);
  // Bumpers
  addBox(chrome, 0.12, 0.16, 1.68, 2.0, 0.3, 0);
  addBox(chrome, 0.1, 0.14, 1.66, -2.05, 0.32, 0);
  // Front air dam
  addBox(black, 0.5, 0.1, 1.5, 1.78, 0.12, 0);

  // Wheelie bars: two tubes off the back of the chassis with little wheels.
  const barMat = chrome;
  for (const side of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.35, 8), barMat);
    bar.position.set(-2.6, 0.02, side * 0.3);
    bar.rotation.z = Math.PI / 2 - 0.2;
    chassis.add(bar);
    const barWheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8 }),
    );
    barWheel.rotation.x = Math.PI / 2;
    barWheel.position.set(-3.24, -0.1, side * 0.3);
    chassis.add(barWheel);
  }
  scene.add(chassis);

  // ---- Unsprung: wheels + axles stay on the ground. ----
  const wheels: Record<string, THREE.Group> = {};
  for (const c of CORNERS) {
    const rear = c.x < 0;
    const wheel = makeWheel(rear);
    const w = rear ? 0.46 : 0.24;
    wheel.position.set(c.x, rear ? WHEEL_R_REAR : WHEEL_R_FRONT, c.z + (c.z > 0 ? w / 2 : -w / 2));
    scene.add(wheel);
    wheels[c.key] = wheel;
  }
  const axleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5 });
  const frontAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 10), axleMat);
  frontAxle.rotation.x = Math.PI / 2;
  frontAxle.position.set(CORNERS[0].x, WHEEL_R_FRONT, 0);
  scene.add(frontAxle);
  const rearAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 12), axleMat);
  rearAxle.rotation.x = Math.PI / 2;
  rearAxle.position.set(CORNERS[2].x, WHEEL_R_REAR, 0);
  scene.add(rearAxle);
  // Pumpkin
  const diff = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), axleMat);
  diff.position.set(CORNERS[2].x, WHEEL_R_REAR, 0);
  scene.add(diff);

  // ---- Shocks: fixed lower body + telescoping shaft per corner. ----
  const struts: Record<string, { body: THREE.Mesh; shaft: THREE.Mesh; spring: THREE.Mesh }> = {};
  for (const c of CORNERS) {
    const rear = c.x < 0;
    const hubY = rear ? WHEEL_R_REAR : WHEEL_R_FRONT;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.5 }),
    );
    body.position.set(c.x, hubY + 0.15, c.z);
    scene.add(body);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3 }),
    );
    scene.add(shaft);
    // Coil spring impression: a slightly fatter, ribbed-looking sleeve.
    const spring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 1, 10, 4, true),
      new THREE.MeshStandardMaterial({
        color: 0xc23b3b,
        roughness: 0.6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    scene.add(spring);
    struts[c.key] = { body, shaft, spring };
  }

  return { renderer, scene, camera, controls, chassis, struts };
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
  const [layout, setLayout] = useState<PanelLayout>(loadLayout);
  const panelRef = useRef<HTMLDivElement>(null);
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

  const persistLayout = useCallback((l: PanelLayout) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
    } catch {
      // ignore
    }
  }, []);

  /** Header drag: switches the card from corner-anchored to explicit x/y. */
  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const panel = panelRef.current;
      const parent = panel?.offsetParent as HTMLElement | null;
      if (!panel || !parent) return;
      const rect = panel.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const grabX = e.clientX - rect.left;
      const grabY = e.clientY - rect.top;
      const onMove = (ev: MouseEvent) => {
        const x = Math.min(
          Math.max(0, ev.clientX - parentRect.left - grabX),
          parentRect.width - rect.width,
        );
        const y = Math.min(
          Math.max(0, ev.clientY - parentRect.top - grabY),
          parentRect.height - rect.height,
        );
        setLayout((l) => ({ ...l, x, y }));
      };
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const x = Math.min(
          Math.max(0, ev.clientX - parentRect.left - grabX),
          parentRect.width - rect.width,
        );
        const y = Math.min(
          Math.max(0, ev.clientY - parentRect.top - grabY),
          parentRect.height - rect.height,
        );
        persistLayout({ ...layout, x, y });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [layout, persistLayout],
  );

  /** Corner grip: resize, keeping the card inside its parent. */
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const panel = panelRef.current;
      const parent = panel?.offsetParent as HTMLElement | null;
      if (!panel || !parent) return;
      const rect = panel.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = rect.width;
      const startH = rect.height;
      // Resizing a corner-anchored card would walk it around; pin it first.
      const x = rect.left - parentRect.left;
      const y = rect.top - parentRect.top;
      let lastW = startW;
      let lastH = startH;
      const onMove = (ev: MouseEvent) => {
        lastW = Math.min(
          Math.min(MAX_W, parentRect.width - x),
          Math.max(MIN_W, startW + (ev.clientX - startX)),
        );
        lastH = Math.min(
          Math.min(MAX_H, parentRect.height - y),
          Math.max(MIN_H, startH + (ev.clientY - startY)),
        );
        setLayout((l) => ({ ...l, x, y, w: lastW, h: lastH }));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        persistLayout({ x, y, w: lastW, h: lastH });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [persistLayout],
  );

  useEffect(() => {
    if (!data || hidden || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const { renderer, scene, camera, controls, chassis, struts } = buildScene(canvas);
    const t0Wall = performance.now();
    let raf = 0;

    // Follow the card through resizes.
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(canvas);

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
        const hubY = rear2 ? WHEEL_R_REAR : WHEEL_R_FRONT;
        // Chassis corner height, small-angle: heave + pitch/roll shares.
        const cornerY =
          RIDE_HEIGHT +
          heave +
          (c.x / (wheelbase / 2)) * ((front - rear) / 2) +
          (c.z / (track / 2)) * ((right - left) / 2);
        const bodyTop = hubY + 0.3;
        const shaftLen = Math.max(0.06, cornerY + 0.1 - bodyTop);
        strut.shaft.position.set(c.x, bodyTop + shaftLen / 2, c.z);
        strut.shaft.scale.y = shaftLen;
        const springLen = Math.max(0.12, cornerY + 0.06 - hubY);
        strut.spring.position.set(c.x, hubY + springLen / 2, c.z);
        strut.spring.scale.y = springLen;
        // Compressed reads warm, extended reads cool.
        const d = h[c.key];
        const mat = strut.spring.material as THREE.MeshStandardMaterial;
        if (d < -0.02) mat.color.setRGB(1, 0.4, 0.3);
        else if (d > 0.02) mat.color.setRGB(0.4, 0.6, 1);
        else mat.color.setRGB(0.76, 0.23, 0.23);
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
          const raceT = t - data.raceStart;
          clockLabelRef.current.textContent =
            raceT >= 0 ? `+${raceT.toFixed(2)}s` : `${raceT.toFixed(2)}s`;
        }
      } else {
        t = cursorRef.current;
        if (clockLabelRef.current) clockLabelRef.current.textContent = "";
      }
      if (t !== null) poseAt(t);
      else if (performance.now() - t0Wall < 500) poseAt(data.playStart);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
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

  const anchored = layout.x === null || layout.y === null;

  return (
    <div
      ref={panelRef}
      className="pointer-events-auto absolute z-20 overflow-hidden rounded-lg border bg-card/95 shadow-lg backdrop-blur"
      style={{
        width: layout.w,
        height: layout.h,
        ...(anchored
          ? { bottom: 12, right: 12 }
          : { left: layout.x!, top: layout.y! }),
      }}
    >
      <div
        className="flex cursor-grab items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5 select-none active:cursor-grabbing"
        onMouseDown={startDrag}
        title="Drag to move"
      >
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
      <canvas
        ref={canvasRef}
        className="block w-full"
        style={{ height: layout.h - CHROME_H }}
      />
      <div className="flex items-center border-t px-2.5 py-1 text-[10px] leading-snug text-muted-foreground">
        <span className="truncate">
          Hover a chart to scrub. Drag the truck to orbit, scroll to zoom.
          Motion is exaggerated to read.
        </span>
      </div>
      {/* Resize grip */}
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        onMouseDown={startResize}
        title="Drag to resize"
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-muted-foreground/50">
          <path d="M14 8 L8 14 M14 12 L12 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  );
}

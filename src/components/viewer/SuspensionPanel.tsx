import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Id } from "../../../convex/_generated/dataModel";
import type { LoadedLog } from "@/lib/viewer-types";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { canonicalAlternate, getQuantity } from "@/lib/ecu/quantities";

/**
 * The chassis as an old-school wireframe grid, seen from the back: each
 * corner of a glowing plane rides its shock-travel channel, warping the mesh
 * the way the body moved — launch squat, front rise, side-to-side rock, and
 * corner-to-corner twist a rigid model can't show. A dim ghost grid holds the
 * staged ride height so every deviation reads against it.
 *
 * Motion is TRUE TO SCALE when the shock channels carry a known length unit:
 * travel converts to real inches and maps through the grid's proportions
 * (its length standing in for a ~112" wheelbase). Only when the channels
 * carry no known unit does it fall back to auto-scaling, and the footer says
 * which one you're looking at.
 *
 * The card drags by its header, resizes from the corner grip (both stick in
 * localStorage), orbits by dragging the scene, and can replay the pass.
 */

const CORNERS = [
  { key: "fl", label: "FL", channel: "Shock Travel Front Left", x: 1.4, z: -0.85 },
  { key: "fr", label: "FR", channel: "Shock Travel Front Right", x: 1.4, z: 0.85 },
  { key: "rl", label: "RL", channel: "Shock Travel Rear Left", x: -1.4, z: -0.85 },
  { key: "rr", label: "RR", channel: "Shock Travel Rear Right", x: -1.4, z: 0.85 },
] as const;

/** Chart colors: left channels red, right channels blue — same as the traces. */
const CORNER_COLORS: Record<string, string> = {
  fl: "#f87171",
  fr: "#60a5fa",
  rl: "#f87171",
  rr: "#60a5fa",
};

/** Fallback only: biggest visual corner deflection when units are unknown. */
const MAX_DEFLECT = 0.45;
/** The grid's 2.8-unit length stands in for a ~112" real wheelbase. */
const UNITS_PER_INCH = 2.8 / 112;
const BASE_HEIGHT = 0.55;

const GRID_L = 2.8; // x, rear -> front
const GRID_W = 1.7; // z, left -> right
const SEGS_L = 16;
const SEGS_W = 10;

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
  /** Inches per canonical travel unit, when the unit is known. */
  inchesPerCanon: number | null;
  /** Vertical drawing gain — labels stay real inches, geometry draws ×gain. */
  gain: number;
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

    // Static ride height. The last second before launch is the WRONG place
    // to zero: the car is loaded against the brake there and already
    // squatting. Instead scan every pre-launch window and zero on the
    // quietest one — the stillest the truck ever sat is its ride height.
    let preEnd = 0;
    while (preEnd < ts.length && ts[preEnd] <= t0 - 0.1) preEnd++;
    const WIN = 0.6;
    let bestStart = -1;
    let bestVar = Infinity;
    for (let i = 0; i < preEnd; i++) {
      const wStart = ts[i];
      if (wStart + WIN > t0 - 0.1) break;
      let j = i;
      let totalVar = 0;
      let ok = true;
      for (const ch of channels) {
        let sum = 0;
        let sum2 = 0;
        let count = 0;
        for (j = i; j < preEnd && ts[j] <= wStart + WIN; j++) {
          const v = ch![j];
          if (Number.isFinite(v)) {
            sum += v;
            sum2 += v * v;
            count++;
          }
        }
        if (count < 5) {
          ok = false;
          break;
        }
        totalVar += sum2 / count - (sum / count) * (sum / count);
      }
      if (ok && totalVar < bestVar) {
        bestVar = totalVar;
        bestStart = i;
      }
      // Slide by ~0.1s worth of samples, not one sample at a time.
      while (i + 1 < preEnd && ts[i + 1] < wStart + 0.1) i++;
    }

    const corners: Record<string, CornerData> = {};
    let maxDelta = 0;
    for (let ci = 0; ci < CORNERS.length; ci++) {
      const data = channels[ci]!;
      let sum = 0;
      let count = 0;
      if (bestStart >= 0) {
        for (let i = bestStart; i < preEnd && ts[i] <= ts[bestStart] + WIN; i++) {
          const v = data[i];
          if (Number.isFinite(v)) {
            sum += v;
            count++;
          }
        }
      } else {
        // No quiet window found — fall back to the last second before launch.
        for (let i = 0; i < ts.length; i++) {
          if (ts[i] < t0 - 1.2 || ts[i] > t0 - 0.1) continue;
          const v = data[i];
          if (Number.isFinite(v)) {
            sum += v;
            count++;
          }
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

    // Real units when the channel carries a length quantity that can speak
    // inches. Deltas are linear in the same raw integer, so a delta converts
    // by the ratio of the alternates' scales; offsets cancel.
    let scale = maxDelta / MAX_DEFLECT;
    let inchesPerCanon: number | null = null;
    let gain = 1;
    const slug = log.parsed.channelDefs.find(
      (d) => d.name === CORNERS[0].channel,
    )?.quantitySlug;
    const inchAlt = getQuantity(slug)?.alternates.find((a) => a.key === "inches");
    const canonAlt = canonicalAlternate(slug);
    if (inchAlt && canonAlt && canonAlt.scale > 0) {
      inchesPerCanon = inchAlt.scale / canonAlt.scale;
      // An inch is real-scale tiny on screen, so vertical geometry draws at a
      // stated gain — a clean number sized so the pass's biggest excursion
      // reads clearly. The corner labels always print the real inches.
      const maxInches = maxDelta * inchesPerCanon;
      gain = Math.min(8, Math.max(1, Math.round(0.3 / (maxInches * UNITS_PER_INCH))));
      scale = 1 / (inchesPerCanon * UNITS_PER_INCH * gain);
    }

    return {
      fileId: log.fileId,
      fileName: log.fileName.replace(/\.[^.]+$/, ""),
      timestamps: ts,
      corners,
      scale,
      inchesPerCanon,
      gain,
      playStart: Math.max(ts[0], t0 - 1),
      playEnd: ts[ts.length - 1],
      raceStart: t0,
    };
  }
  return null;
}

/** A clean grid of line segments (no triangle diagonals) over the plane. */
function makeGridGeometry(): {
  geometry: THREE.BufferGeometry;
  basePositions: { x: number; z: number }[];
} {
  const cols = SEGS_L + 1;
  const rows = SEGS_W + 1;
  const basePositions: { x: number; z: number }[] = [];
  const positions = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = -GRID_L / 2 + (GRID_L * c) / SEGS_L;
      const z = -GRID_W / 2 + (GRID_W * r) / SEGS_W;
      basePositions.push({ x, z });
      positions[i * 3] = x;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = z;
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) indices.push(r * cols + c, r * cols + c + 1);
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows - 1; r++) indices.push(r * cols + c, (r + 1) * cols + c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return { geometry, basePositions };
}

/** Canvas-backed text sprite with a cheap redraw hook. */
function makeLabel(color: string): { sprite: THREE.Sprite; update: (text: string) => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  const update = (text: string) => {
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = "bold 46px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    const lines = text.split("\n");
    lines.forEach((ln, i) => ctx.fillText(ln, 128, 54 + i * 54));
    tex.needsUpdate = true;
  };
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(0.52, 0.26, 1);
  return { sprite, update };
}

/** The retro scene: ground, ghost grid at ride height, live warping grid. */
function buildScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    36,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100,
  );
  // From the back and low, so vertical motion reads against the horizon.
  camera.position.set(-4.4, 1.35, 0.9);
  camera.lookAt(0, BASE_HEIGHT, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, BASE_HEIGHT, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 2.5;
  controls.maxDistance = 12;
  // Keep the camera above the deck — under-floor views read as a glitch.
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.update();

  // Wireframes don't need light, but sprites render nicer with a little.
  scene.add(new THREE.AmbientLight(0xffffff, 1));

  const ground = new THREE.GridHelper(14, 28, 0x232327, 0x18181b);
  scene.add(ground);

  // Staged ride height, as a crisp static reference frame: the rectangle
  // outline the live grid left behind when the car moved.
  const baselineRect = [
    new THREE.Vector3(-GRID_L / 2, BASE_HEIGHT, -GRID_W / 2),
    new THREE.Vector3(GRID_L / 2, BASE_HEIGHT, -GRID_W / 2),
    new THREE.Vector3(GRID_L / 2, BASE_HEIGHT, GRID_W / 2),
    new THREE.Vector3(-GRID_L / 2, BASE_HEIGHT, GRID_W / 2),
  ];
  const baseline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(baselineRect),
    new THREE.LineBasicMaterial({ color: 0x565c63 }),
  );
  scene.add(baseline);

  // Live: phosphor green, warped by the corner heights each frame.
  const live = makeGridGeometry();
  const liveLines = new THREE.LineSegments(
    live.geometry,
    new THREE.LineBasicMaterial({ color: 0x39ff6a }),
  );
  scene.add(liveLines);

  // Corner posts tie the plane to the ground: a dim stilt up to the staged
  // height, then a bright colored segment covering the live deviation.
  const posts: Record<string, THREE.Line> = {};
  const cornerLabels: Record<string, ReturnType<typeof makeLabel>> = {};
  for (const c of CORNERS) {
    const stilt = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(c.x, 0, c.z),
        new THREE.Vector3(c.x, BASE_HEIGHT, c.z),
      ]),
      new THREE.LineBasicMaterial({ color: 0x33363b }),
    );
    scene.add(stilt);

    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(c.x, BASE_HEIGHT, c.z),
      new THREE.Vector3(c.x, BASE_HEIGHT, c.z),
    ]);
    const line = new THREE.Line(
      g,
      new THREE.LineBasicMaterial({
        color: new THREE.Color(CORNER_COLORS[c.key]),
        linewidth: 2,
      }),
    );
    scene.add(line);
    posts[c.key] = line;

    const label = makeLabel(CORNER_COLORS[c.key]);
    // Pushed outward along the length so front and rear never stack when
    // viewed end-on from behind; the rear pair stays closer in because it's
    // nearest the default camera and grows fast in perspective.
    label.sprite.position.set(c.x * (c.x > 0 ? 1.3 : 1.05), BASE_HEIGHT + 0.45, c.z * 1.12);
    label.update(c.label);
    scene.add(label.sprite);
    cornerLabels[c.key] = label;
  }

  // Which way is forward — readable from any orbit.
  const frontLabel = makeLabel("#8b8f96");
  frontLabel.update("FRONT");
  frontLabel.sprite.position.set(GRID_L / 2 + 0.55, BASE_HEIGHT + 0.05, 0);
  scene.add(frontLabel.sprite);

  return {
    renderer,
    scene,
    camera,
    controls,
    livePositions: live.geometry.getAttribute("position") as THREE.BufferAttribute,
    liveBase: live.basePositions,
    posts,
    cornerLabels,
  };
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
    const { renderer, scene, camera, controls, livePositions, liveBase, posts, cornerLabels } =
      buildScene(canvas);
    const t0Wall = performance.now();
    let raf = 0;
    const lastShown: Record<string, string> = {};

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
      const inches: Record<string, number | null> = {};
      for (const c of CORNERS) {
        const corner = data.corners[c.key];
        const v = valueAt(data.timestamps, corner.data, t);
        const delta = v === null ? 0 : v - corner.baseline;
        h[c.key] = delta / data.scale;
        inches[c.key] =
          v === null || data.inchesPerCanon === null ? null : delta * data.inchesPerCanon;
      }
      // Bilinear warp: every grid vertex blends the four corner heights.
      for (let i = 0; i < liveBase.length; i++) {
        const { x, z } = liveBase[i];
        const u = (x + GRID_L / 2) / GRID_L; // 0 rear -> 1 front
        const w = (z + GRID_W / 2) / GRID_W; // 0 left -> 1 right
        const rear = h.rl * (1 - w) + h.rr * w;
        const front = h.fl * (1 - w) + h.fr * w;
        livePositions.setY(i, BASE_HEIGHT + rear * (1 - u) + front * u);
      }
      livePositions.needsUpdate = true;

      for (const c of CORNERS) {
        const y = BASE_HEIGHT + h[c.key];
        const post = posts[c.key];
        const pos = post.geometry.getAttribute("position") as THREE.BufferAttribute;
        pos.setY(1, y);
        pos.needsUpdate = true;
        const inch = inches[c.key];
        const text =
          inch === null
            ? c.label
            : `${c.label}\n${inch >= 0 ? "+" : ""}${inch.toFixed(2)}"`;
        if (lastShown[c.key] !== text) {
          lastShown[c.key] = text;
          cornerLabels[c.key].update(text);
        }
        cornerLabels[c.key].sprite.position.y = BASE_HEIGHT + h[c.key] + 0.45;
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
        if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite) {
          o.geometry?.dispose?.();
          const m = (o as THREE.Mesh).material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose?.();
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
          Hover a chart to scrub. Drag to orbit, scroll to zoom.{" "}
          {data.inchesPerCanon === null
            ? "Motion auto-scaled (travel units unknown)."
            : data.gain > 1
              ? `Labels are real inches; vertical drawn ×${data.gain}.`
              : "Motion is true to scale."}
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

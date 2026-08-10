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
 * corner-to-corner twist a rigid model can't show. A dim ghost frame holds
 * the staged ride height so every deviation reads against it.
 *
 * With several logs loaded, every log carrying shock channels gets its own
 * wireframe in that run's chart color, all riding the shared cursor — the
 * same run-identity colors the legend uses. One log alone stays phosphor
 * green with left-red/right-blue corner readouts.
 *
 * Motion is TRUE TO SCALE when the shock channels carry a known length unit:
 * travel converts to real inches and maps through the grid's proportions
 * (its length standing in for a ~112" wheelbase), drawn at a stated vertical
 * gain sized over all loaded runs so they stay comparable.
 */

const CORNERS = [
  { key: "fl", label: "FL", channel: "Shock Travel Front Left", x: 1.4, z: -0.85 },
  { key: "fr", label: "FR", channel: "Shock Travel Front Right", x: 1.4, z: 0.85 },
  { key: "rl", label: "RL", channel: "Shock Travel Rear Left", x: -1.4, z: -0.85 },
  { key: "rr", label: "RR", channel: "Shock Travel Rear Right", x: -1.4, z: 0.85 },
] as const;

/** The channels that make a trace (and the panel) suspension-aware. */
export const SHOCK_CHANNEL_NAMES: readonly string[] = CORNERS.map((c) => c.channel);

/** Single-log corner colors, matching the shock traces: left red, right blue. */
const CORNER_COLORS: Record<string, string> = {
  fl: "#f87171",
  fr: "#60a5fa",
  rl: "#f87171",
  rr: "#60a5fa",
};
const SINGLE_GRID_COLOR = 0x39ff6a;
const TITLE_GREY = "#9aa0a8";

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

/** How the runs draw: full wire meshes, one mesh + outlines, or solid sheets. */
type GridStyle = "mesh" | "outline" | "sheet";
const GRID_STYLES: { value: GridStyle; label: string }[] = [
  { value: "mesh", label: "Wire mesh" },
  { value: "outline", label: "Mesh + outlines" },
  { value: "sheet", label: "Solid sheets" },
];

interface PanelLayout {
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  style: GridStyle;
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
        style: GRID_STYLES.some((s) => s.value === p.style) ? p.style : "sheet",
      };
    }
  } catch {
    // ignore
  }
  return { x: null, y: null, w: 300, h: 260, style: "sheet" };
}

interface CornerData {
  data: Float64Array;
  baseline: number;
}

interface PerLogData {
  fileId: Id<"files">;
  fileName: string;
  color: string;
  timestamps: Float64Array;
  corners: Record<string, CornerData>;
  raceStart: number;
  tsEnd: number;
}

interface SuspensionData {
  perLog: PerLogData[];
  /** Travel units per scene unit — shared across logs so motion compares. */
  scale: number;
  /** Inches per canonical travel unit, when the unit is known. */
  inchesPerCanon: number | null;
  /** Vertical drawing gain — labels stay real inches, geometry draws ×gain. */
  gain: number;
  /** Race-relative playback window: [-1s .. longest run]. */
  playMax: number;
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

/** Baselines from the quietest pre-launch window — the car loaded on the
 *  brake in the final second is NOT ride height. Returns null when the log
 *  can't support it. */
function findBaselines(
  ts: Float64Array,
  channels: (Float64Array | undefined)[],
  t0: number,
): number[] | null {
  let preEnd = 0;
  while (preEnd < ts.length && ts[preEnd] <= t0 - 0.1) preEnd++;
  const WIN = 0.6;
  let bestStart = -1;
  let bestVar = Infinity;
  for (let i = 0; i < preEnd; i++) {
    const wStart = ts[i];
    if (wStart + WIN > t0 - 0.1) break;
    let totalVar = 0;
    let ok = true;
    for (const ch of channels) {
      let sum = 0;
      let sum2 = 0;
      let count = 0;
      for (let j = i; j < preEnd && ts[j] <= wStart + WIN; j++) {
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

  const out: number[] = [];
  for (const ch of channels) {
    let sum = 0;
    let count = 0;
    if (bestStart >= 0) {
      for (let i = bestStart; i < preEnd && ts[i] <= ts[bestStart] + 0.6; i++) {
        const v = ch![i];
        if (Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
    } else {
      // No quiet window found — fall back to the last second before launch.
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] < t0 - 1.2 || ts[i] > t0 - 0.1) continue;
        const v = ch![i];
        if (Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
    }
    if (count === 0) return null;
    out.push(sum / count);
  }
  return out;
}

/** Every loaded log carrying all four shock channels, on one shared scale. */
function buildSuspensionData(logs: LoadedLog[]): SuspensionData | null {
  const perLog: PerLogData[] = [];
  let maxDelta = 0;
  let inchesPerCanon: number | null = null;

  for (const log of logs) {
    const session = log.parsed.sessions[log.activeSessionIndex];
    if (!session || log.raceStartTime === null) continue;
    const ts = session.timestamps;
    const channels = CORNERS.map((c) => session.channels.get(c.channel));
    if (channels.some((c) => !c)) continue;

    const t0 = log.raceStartTime;
    const baselines = findBaselines(ts, channels, t0);
    if (!baselines) continue;

    const corners: Record<string, CornerData> = {};
    for (let ci = 0; ci < CORNERS.length; ci++) {
      const data = channels[ci]!;
      const baseline = baselines[ci];
      corners[CORNERS[ci].key] = { data, baseline };
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] < t0) continue;
        const v = data[i];
        if (Number.isFinite(v)) maxDelta = Math.max(maxDelta, Math.abs(v - baseline));
      }
    }

    if (inchesPerCanon === null) {
      const slug = log.parsed.channelDefs.find(
        (d) => d.name === CORNERS[0].channel,
      )?.quantitySlug;
      const inchAlt = getQuantity(slug)?.alternates.find((a) => a.key === "inches");
      const canonAlt = canonicalAlternate(slug);
      if (inchAlt && canonAlt && canonAlt.scale > 0) {
        inchesPerCanon = inchAlt.scale / canonAlt.scale;
      }
    }

    perLog.push({
      fileId: log.fileId,
      fileName: log.fileName.replace(/\.[^.]+$/, ""),
      color: log.logColor,
      timestamps: ts,
      corners,
      raceStart: t0,
      tsEnd: ts[ts.length - 1],
    });
  }
  if (perLog.length === 0 || maxDelta === 0) return null;

  // One shared scale over every run, so the same inch moves the same amount
  // on every wireframe.
  let scale = maxDelta / MAX_DEFLECT;
  let gain = 1;
  if (inchesPerCanon !== null) {
    const maxInches = maxDelta * inchesPerCanon;
    gain = Math.min(8, Math.max(1, Math.round(0.3 / (maxInches * UNITS_PER_INCH))));
    scale = 1 / (inchesPerCanon * UNITS_PER_INCH * gain);
  }

  return {
    perLog,
    scale,
    inchesPerCanon,
    gain,
    playMax: Math.max(...perLog.map((l) => l.tsEnd - l.raceStart)),
  };
}

/** Shared vertex lattice for the plane, plus its (x, z) base positions. */
function makeLattice(): {
  positions: Float32Array;
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
  return { positions, basePositions };
}

/** A clean grid of line segments (no triangle diagonals) over the plane. */
function makeGridGeometry(): {
  geometry: THREE.BufferGeometry;
  basePositions: { x: number; z: number }[];
} {
  const cols = SEGS_L + 1;
  const rows = SEGS_W + 1;
  const { positions, basePositions } = makeLattice();
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

/** The same lattice as triangles, for the solid-sheet style. */
function makeSheetGeometry(): {
  geometry: THREE.BufferGeometry;
  basePositions: { x: number; z: number }[];
} {
  const cols = SEGS_L + 1;
  const rows = SEGS_W + 1;
  const { positions, basePositions } = makeLattice();
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return { geometry, basePositions };
}

/** Corner keys in the perimeter loop's winding order. */
const OUTLINE_ORDER = ["rl", "fl", "fr", "rr"] as const;

interface LabelLine {
  text: string;
  color: string;
}

/** Canvas-backed text sprite that draws one colored line per entry. */
function makeLabel(): { sprite: THREE.Sprite; update: (lines: LabelLine[]) => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  const update = (lines: LabelLine[]) => {
    ctx.clearRect(0, 0, 256, 192);
    ctx.font = "bold 42px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    lines.forEach((ln, i) => {
      ctx.fillStyle = ln.color;
      ctx.fillText(ln.text, 128, 48 + i * 46);
    });
    tex.needsUpdate = true;
  };
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(0.52, 0.39, 1);
  return { sprite, update };
}

interface LogGrid {
  /** Full-lattice surfaces to warp each frame (wire grid and/or sheet). */
  warped: { positions: THREE.BufferAttribute; base: { x: number; z: number }[] }[];
  /** 4-corner perimeter loop, when this run draws one. */
  outline: THREE.BufferAttribute | null;
  ticks: Record<string, THREE.Line>;
}

/** The retro scene: ground, ghost frame, one warping surface per log. */
function buildScene(
  canvas: HTMLCanvasElement,
  logsMeta: { color: string }[],
  style: GridStyle,
) {
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

  scene.add(new THREE.AmbientLight(0xffffff, 1));

  const ground = new THREE.GridHelper(14, 28, 0x232327, 0x18181b);
  scene.add(ground);

  // Staged ride height, as a crisp static reference frame.
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

  const multi = logsMeta.length > 1;

  // One warping surface per log, drawn per the chosen style. Alone: phosphor
  // green. Compared: run colors, the same identity colors the legend uses.
  const grids: LogGrid[] = [];
  logsMeta.forEach((meta, li) => {
    const color = multi ? new THREE.Color(meta.color) : new THREE.Color(SINGLE_GRID_COLOR);
    const warped: LogGrid["warped"] = [];
    let outline: THREE.BufferAttribute | null = null;

    const addWireGrid = () => {
      const g = makeGridGeometry();
      scene.add(
        new THREE.LineSegments(
          g.geometry,
          new THREE.LineBasicMaterial({
            color,
            transparent: multi,
            opacity: multi ? 0.9 : 1,
          }),
        ),
      );
      warped.push({
        positions: g.geometry.getAttribute("position") as THREE.BufferAttribute,
        base: g.basePositions,
      });
    };
    const addSheet = () => {
      const g = makeSheetGeometry();
      scene.add(
        new THREE.Mesh(
          g.geometry,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: multi ? 0.2 : 0.24,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      );
      warped.push({
        positions: g.geometry.getAttribute("position") as THREE.BufferAttribute,
        base: g.basePositions,
      });
    };
    const addOutline = () => {
      const pts = OUTLINE_ORDER.map((k) => {
        const c = CORNERS.find((cc) => cc.key === k)!;
        return new THREE.Vector3(c.x, BASE_HEIGHT, c.z);
      });
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color })));
      outline = g.getAttribute("position") as THREE.BufferAttribute;
    };

    if (style === "mesh") {
      addWireGrid();
    } else if (style === "outline") {
      if (li === 0) addWireGrid();
      else addOutline();
    } else {
      addSheet();
      addOutline();
    }

    // Per-corner deviation ticks, baseline to live, in the run's color.
    const ticks: Record<string, THREE.Line> = {};
    for (const c of CORNERS) {
      const tg = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(c.x, BASE_HEIGHT, c.z),
        new THREE.Vector3(c.x, BASE_HEIGHT, c.z),
      ]);
      const tick = new THREE.Line(
        tg,
        new THREE.LineBasicMaterial({
          color: multi ? new THREE.Color(meta.color) : new THREE.Color(CORNER_COLORS[c.key]),
        }),
      );
      scene.add(tick);
      ticks[c.key] = tick;
    }
    grids.push({ warped, outline, ticks });
  });

  // Stilts tie the reference frame to the ground.
  for (const c of CORNERS) {
    const stilt = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(c.x, 0, c.z),
        new THREE.Vector3(c.x, BASE_HEIGHT, c.z),
      ]),
      new THREE.LineBasicMaterial({ color: 0x33363b }),
    );
    scene.add(stilt);
  }

  // Corner labels: name line plus one inches line per log.
  const cornerLabels: Record<string, ReturnType<typeof makeLabel>> = {};
  for (const c of CORNERS) {
    const label = makeLabel();
    // Pushed outward along the length so front and rear never stack when
    // viewed end-on from behind; the rear pair stays closer in because it's
    // nearest the default camera and grows fast in perspective.
    label.sprite.position.set(c.x * (c.x > 0 ? 1.3 : 1.05), BASE_HEIGHT + 0.45, c.z * 1.12);
    label.update([{ text: c.label, color: TITLE_GREY }]);
    scene.add(label.sprite);
    cornerLabels[c.key] = label;
  }

  const frontLabel = makeLabel();
  frontLabel.update([{ text: "FRONT", color: "#8b8f96" }]);
  frontLabel.sprite.position.set(GRID_L / 2 + 0.55, BASE_HEIGHT + 0.05, 0);
  scene.add(frontLabel.sprite);

  return { renderer, scene, camera, controls, grids, cornerLabels };
}

export function SuspensionPanel({
  logs,
  offsets,
  cursorTime,
  hidden,
  onSetHidden,
}: {
  logs: LoadedLog[];
  offsets: Map<Id<"files">, number>;
  cursorTime: number | null;
  hidden: boolean;
  onSetHidden: (hidden: boolean) => void;
}) {
  const data = useMemo(() => buildSuspensionData(logs), [logs]);
  const [playing, setPlaying] = useState(false);
  const [layout, setLayout] = useState<PanelLayout>(loadLayout);
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const playheadRef = useRef<number | null>(null);
  const clockLabelRef = useRef<HTMLSpanElement>(null);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;

  cursorRef.current = cursorTime;
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
        setLayout((l) => {
          const next = { ...l, x, y, w: lastW, h: lastH };
          try {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [persistLayout],
  );

  useEffect(() => {
    if (!data || hidden || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const { renderer, scene, camera, controls, grids, cornerLabels } = buildScene(
      canvas,
      data.perLog,
      layout.style,
    );
    const multi = data.perLog.length > 1;
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

    /** Per-log sample time for this frame: race-relative during playback,
     *  display-time minus the log's alignment offset when scrubbing. */
    const logTime = (li: number, t: number, raceRelative: boolean): number => {
      const log = data.perLog[li];
      return raceRelative ? log.raceStart + t : t - (offsetsRef.current.get(log.fileId) ?? 0);
    };

    const poseAt = (t: number, raceRelative: boolean) => {
      const labelLines: Record<string, LabelLine[]> = {};
      for (const c of CORNERS) {
        labelLines[c.key] = [
          {
            text: c.label,
            color: multi ? TITLE_GREY : CORNER_COLORS[c.key],
          },
        ];
      }

      for (let li = 0; li < data.perLog.length; li++) {
        const log = data.perLog[li];
        const grid = grids[li];
        const tLog = logTime(li, t, raceRelative);
        const h: Record<string, number> = {};
        for (const c of CORNERS) {
          const corner = log.corners[c.key];
          const v = valueAt(log.timestamps, corner.data, tLog);
          const delta = v === null ? 0 : v - corner.baseline;
          h[c.key] = delta / data.scale;
          const inch =
            v === null || data.inchesPerCanon === null
              ? null
              : (v - corner.baseline) * data.inchesPerCanon;
          labelLines[c.key].push({
            text: inch === null ? "—" : `${inch >= 0 ? "+" : ""}${inch.toFixed(2)}"`,
            color: multi ? log.color : CORNER_COLORS[c.key],
          });
        }
        // Bilinear warp: every lattice vertex blends the four corner heights.
        for (const surface of grid.warped) {
          for (let i = 0; i < surface.base.length; i++) {
            const { x, z } = surface.base[i];
            const u = (x + GRID_L / 2) / GRID_L; // 0 rear -> 1 front
            const w = (z + GRID_W / 2) / GRID_W; // 0 left -> 1 right
            const rear = h.rl * (1 - w) + h.rr * w;
            const front = h.fl * (1 - w) + h.fr * w;
            surface.positions.setY(i, BASE_HEIGHT + rear * (1 - u) + front * u);
          }
          surface.positions.needsUpdate = true;
        }
        // A bilinear edge is a straight line between its corners, so the
        // perimeter loop needs only the four corner heights.
        if (grid.outline) {
          OUTLINE_ORDER.forEach((k, i) => grid.outline!.setY(i, BASE_HEIGHT + h[k]));
          grid.outline.needsUpdate = true;
        }
        for (const c of CORNERS) {
          const pos = grid.ticks[c.key].geometry.getAttribute(
            "position",
          ) as THREE.BufferAttribute;
          pos.setY(1, BASE_HEIGHT + h[c.key]);
          pos.needsUpdate = true;
        }
      }

      for (const c of CORNERS) {
        const lines = labelLines[c.key];
        // Single log: fold the one value into the name line's color scheme.
        const key = lines.map((l) => l.text + l.color).join("|");
        if (lastShown[c.key] !== key) {
          lastShown[c.key] = key;
          cornerLabels[c.key].update(lines);
        }
      }
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      let t: number | null = null;
      let raceRelative = false;
      if (playingRef.current) {
        raceRelative = true;
        if (playheadRef.current === null) playheadRef.current = -1;
        playheadRef.current += 1 / 60;
        if (playheadRef.current >= data.playMax) {
          playheadRef.current = null;
          playingRef.current = false;
          setPlaying(false);
          t = data.playMax;
        } else {
          t = playheadRef.current;
        }
        if (clockLabelRef.current && t !== null) {
          clockLabelRef.current.textContent =
            t >= 0 ? `+${t.toFixed(2)}s` : `${t.toFixed(2)}s`;
        }
      } else {
        t = cursorRef.current;
        if (clockLabelRef.current) clockLabelRef.current.textContent = "";
      }
      if (t !== null) poseAt(t, raceRelative);
      else if (performance.now() - t0Wall < 500) poseAt(-1, true);
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
  }, [data, hidden, layout.style]);

  if (!data || hidden) return null;

  const anchored = layout.x === null || layout.y === null;
  const multi = data.perLog.length > 1;

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
        {multi && (
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            {data.perLog.map((l) => (
              <span
                key={l.fileId}
                className="max-w-24 truncate text-[10px]"
                style={{ color: l.color }}
                title={l.fileName}
              >
                {l.fileName}
              </span>
            ))}
          </span>
        )}
        <span
          ref={clockLabelRef}
          className="font-mono text-[10px] tabular-nums text-amber-300/90"
        />
        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={layout.style}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => persistLayout({ ...layout, style: e.target.value as GridStyle })}
            title="How the runs draw"
            className="cursor-pointer rounded border-none bg-transparent text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground"
          >
            {GRID_STYLES.map((s) => (
              <option key={s.value} value={s.value} className="bg-popover text-foreground">
                {s.label}
              </option>
            ))}
          </select>
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
            title="Hide — the Suspension button on the shock trace brings it back"
            onClick={() => onSetHidden(true)}
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

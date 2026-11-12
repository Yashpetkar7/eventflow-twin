// The baked corridor scene (scripts/build_scene.py → public/geo/corridor_scene.json) and path helpers.
import * as THREE from "three";
import type { Frame } from "@/lib/geo";
import { LANDMARK_KEYS, type LandmarkKey } from "@/lib/landmarks";

export interface SceneJson {
  meta: {
    frame: Frame; extent: [number, number, number, number];
    ground: { file: string; x0: number; x1: number; z0: number; z1: number };
    attribution: string; generated: string; camera_side_cut_m: number;
    height_sources: { tagged_height: number; tagged_levels: number; estimated: number };
  };
  landmarks: Record<string, { x: number; z: number; area: number; angle: number; h: number | null; ring: number[] }>;
  buildings: number[][];      // [height, min_height, x0, z0, x1, z1, …]
  ghosts: number[][];
  roads: number[][];          // [class, width, x0, z0, …]
  szr: { len: number; dir: number; p: number[]; lanes: number[] }[];
  flyovers: { w: number; p: number[] }[];   // p = x, y, z triples
  footbridges: number[][];
  water: number[][];
  parks: number[][];
  metro: number[];
}

let cached: Promise<SceneJson> | null = null;
export function loadScene(): Promise<SceneJson> {
  cached ??= fetch("/geo/corridor_scene.json").then((r) => {
    if (!r.ok) throw new Error(`corridor_scene.json: HTTP ${r.status}`);
    return r.json() as Promise<SceneJson>;
  });
  return cached;
}

export interface Sample { x: number; z: number; tx: number; tz: number }

/** A horizontal path resampled at a uniform step, so a position along it is a single array lookup. */
export class Path {
  readonly x: Float32Array; readonly z: Float32Array; readonly tx: Float32Array; readonly tz: Float32Array;
  readonly n: number; readonly step: number; readonly length: number;
  /** For each sample, the fractional index into the original polyline (used to carry per-vertex data). */
  readonly src: Float32Array;

  constructor(pts: [number, number][], step = 6, smooth = true) {
    const v = pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = smooth && v.length > 2 ? new THREE.CatmullRomCurve3(v, false, "centripetal") : null;
    let length = 0;
    const cum = [0];
    for (let i = 1; i < v.length; i++) { length += v[i].distanceTo(v[i - 1]); cum.push(length); }
    const n = Math.max(2, Math.round(length / step) + 1);
    const p = curve ? curve.getSpacedPoints(n - 1) : null;
    this.x = new Float32Array(n); this.z = new Float32Array(n); this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.src = new Float32Array(n);
    let seg = 0;
    for (let i = 0; i < n; i++) {
      const d = (i / (n - 1)) * length;
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const f = (d - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
      this.src[i] = seg + f;
      if (p) { this.x[i] = p[i].x; this.z[i] = p[i].z; }
      else { this.x[i] = v[seg].x + (v[seg + 1].x - v[seg].x) * f; this.z[i] = v[seg].z + (v[seg + 1].z - v[seg].z) * f; }
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    this.n = n; this.length = length; this.step = length / (n - 1);
  }

  at(s: number, out: Sample): Sample {
    const f = Math.max(0, Math.min(this.n - 1.001, s / this.step)), i = Math.floor(f), k = f - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * k; out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * k;
    out.tx = this.tx[i] + (this.tx[i + 1] - this.tx[i]) * k; out.tz = this.tz[i] + (this.tz[i + 1] - this.tz[i]) * k;
    return out;
  }

  /** Distance along the path of the sample nearest to (x, z). */
  nearest(x: number, z: number): { s: number; d: number } {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return { s: best * this.step, d: Math.sqrt(bd) };
  }
}

export const pairs = (flat: number[], from = 0): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = from; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};

/** Deterministic pseudo-random generator (same city every run). */
export function mulberry(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shared live values written by the scene each frame and read by sibling components (no React state at 60 fps).
export const live = {
  camDist: 5000, camTarget: new THREE.Vector3(), night: 0, daylight: 1, golden: 0, animT: 0,
  columnTop: {} as Record<string, number>,          // world y of the label anchor above each station column
  stationPos: {} as Record<string, THREE.Vector3>,
  venue: new THREE.Vector3(), venueOn: false,
  fps: 0,
};

/** Places a visitor can jump to. Modelled landmarks take their position from the baked scene; districts are
 *  projected from fixed coordinates. `h` = height to frame, `r` = camera distance that shows the place and its area. */
export interface LandmarkSpot { key: LandmarkKey; x: number; z: number; h: number; r: number }
const DISTRICTS: Partial<Record<LandmarkKey, { lat: number; lon: number; h: number; r: number }>> = {
  mall: { lat: 25.1975, lon: 55.2793, h: 60, r: 1500 },      // The Dubai Mall
  difc: { lat: 25.2136, lon: 55.2798, h: 120, r: 1300 },     // DIFC Gate district
  canal: { lat: 25.1885, lon: 55.2560, h: 20, r: 1700 },     // Dubai Water Canal at Sheikh Zayed Road
};
export function landmarkSpots(data: SceneJson): LandmarkSpot[] {
  const f = data.meta.frame, lm = data.landmarks, out: LandmarkSpot[] = [];
  const add = (key: LandmarkKey, src: { x: number; z: number } | undefined, h: number, r: number) => { if (src) out.push({ key, x: src.x, z: src.z, h, r }); };
  add("burj", lm.burj, 828, 2300); add("mof", lm.mof, 95, 700); add("et", lm.et1, 355, 1150);
  add("dwtc", lm.dwtc, 160, 950); add("frame", lm.frame, 150, 900);
  for (const k of LANDMARK_KEYS) {
    const d = DISTRICTS[k];
    if (!d) continue;
    const e = (d.lon - f.lon0) * f.m_lon, n = (d.lat - f.lat0) * f.m_lat;
    out.push({ key: k, x: e * f.ux + n * f.uy, z: e * f.uy - n * f.ux, h: d.h, r: d.r });
  }
  return out;
}

/** Imperative camera actions for DOM buttons (set by the camera rig while it is mounted). */
export const camBus: { zoom: (factor: number) => void } = { zoom: () => {} };

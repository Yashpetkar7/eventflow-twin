// Geometry builders for the baked city: merged, shared, indexed where it matters.
import * as THREE from "three";
import { mulberry, type Path } from "./sceneData";

const TOWER_TINTS = [0x9fb9d2, 0x7499bd, 0xd9c49e, 0x8eabc6, 0xc3ccd6, 0x5f86ad, 0xdfd0b4, 0x86a4bc, 0xb0bfcc, 0xcdb994];
const LOW_TINTS = [0xe3d9c6, 0xd8c9ae, 0xece5d8, 0xcdbd9f, 0xe0d5c0, 0xd4c7b0, 0xe8dcc6];

/** Extrude every footprint: walls carry (perimeter, height) in metres for the procedural façade, roofs are flat. */
export function buildingsGeometry(list: number[][], opts: { roof?: boolean } = {}): THREE.BufferGeometry {
  const rnd = mulberry(11);
  let nv = 0, ni = 0;
  for (const b of list) { const n = (b.length - 2) / 2; nv += n * 4 + n; ni += n * 6 + (n - 2) * 3; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = new Float32Array(nv * 3), seed = new Float32Array(nv), win = new Float32Array(nv);
  const idx = new Uint32Array(ni);
  const c = new THREE.Color(), roof = new THREE.Color();
  let v = 0, k = 0;
  for (const b of list) {
    const h = b[0], y0 = b[1], n = (b.length - 2) / 2;
    const tall = h > 30;
    c.setHex(tall ? TOWER_TINTS[Math.floor(rnd() * TOWER_TINTS.length)] : LOW_TINTS[Math.floor(rnd() * LOW_TINTS.length)]);
    c.offsetHSL(0, 0, (rnd() - 0.5) * 0.05);
    const sd = rnd(), wn = tall ? 0.75 + rnd() * 0.25 : h > 12 ? 0.55 : 0.3;
    let per = 0;
    for (let i = 0; i < n; i++) {
      const x0 = b[2 + i * 2], z0 = b[3 + i * 2], j = (i + 1) % n, x1 = b[2 + j * 2], z1 = b[3 + j * 2];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;                     // outward for counter-clockwise footprints
      const quad = [[x0, y0, z0, per, y0], [x1, y0, z1, per + len, y0], [x1, h, z1, per + len, h], [x0, h, z0, per, h]];
      for (const q of quad) {
        pos[v * 3] = q[0]; pos[v * 3 + 1] = q[1]; pos[v * 3 + 2] = q[2];
        nor[v * 3] = nx; nor[v * 3 + 2] = nz;
        uv[v * 2] = q[3]; uv[v * 2 + 1] = q[4];
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; seed[v] = sd; win[v] = wn;
        v++;
      }
      idx[k++] = v - 4; idx[k++] = v - 2; idx[k++] = v - 3; idx[k++] = v - 4; idx[k++] = v - 1; idx[k++] = v - 2;
      per += len;
    }
    if (opts.roof !== false) {
      roof.setHex(0xc9c4b8).lerp(c, 0.25).offsetHSL(0, 0, (sd - 0.5) * 0.08);      // roofs: neutral concrete, a hint of the façade
      const contour: THREE.Vector2[] = [];
      for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(b[2 + i * 2], b[3 + i * 2]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const base = v;
      for (let i = 0; i < n; i++) {
        pos[v * 3] = contour[i].x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = contour[i].y;
        nor[v * 3 + 1] = 1;
        col[v * 3] = roof.r; col[v * 3 + 1] = roof.g; col[v * 3 + 2] = roof.b; seed[v] = sd; win[v] = 0;
        v++;
      }
      for (const t of tris) { idx[k++] = base + t[0]; idx[k++] = base + t[2]; idx[k++] = base + t[1]; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
  g.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed.subarray(0, v), 1));
  g.setAttribute("aWin", new THREE.BufferAttribute(win.subarray(0, v), 1));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, k), 1));
  g.computeBoundingSphere();
  return g;
}

/** Flat polygons (water, lawns) at height y, merged. */
export function flatPolygons(rings: number[][], y: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const r of rings) {
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < r.length; i += 2) contour.push(new THREE.Vector2(r[i], r[i + 1]));
    if (contour.length > 3 && contour[0].equals(contour[contour.length - 1])) contour.pop();
    if (contour.length < 3) continue;
    const base = pos.length / 3;
    for (const p of contour) pos.push(p.x, y, p.y);
    for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) idx.push(base + t[0], base + t[1], base + t[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Flat ribbons along polylines (roads). uv = (metres along, 0…1 across); aW = width in metres. */
export function ribbons(lines: { pts: [number, number][]; w: number | number[]; y: number | number[] }[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], aw: number[] = [], idx: number[] = [];
  for (const { pts, w, y } of lines) {
    if (pts.length < 2) continue;
    const base = pos.length / 3;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const hw = (Array.isArray(w) ? w[i] : w) / 2, yy = Array.isArray(y) ? y[i] : y;
      // left of travel = (tz, −tx); across = 0 on the left edge
      pos.push(pts[i][0] + tz * hw, yy, pts[i][1] - tx * hw, pts[i][0] - tz * hw, yy, pts[i][1] + tx * hw);
      uv.push(s, 0, s, 1);
      aw.push(hw * 2, hw * 2);
      if (i > 0) { const q = base + i * 2; idx.push(q - 2, q - 1, q, q, q - 1, q + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aW", new THREE.Float32BufferAttribute(aw, 1));
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Sweep a closed cross-section (lateral, up) along samples; flat-shaded (viaduct, flyover decks, footbridges). */
export function sweep(samples: { x: number; y: number; z: number; tx: number; tz: number }[], profile: [number, number][], closed = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const m = profile.length, segs = closed ? m : m - 1;
  const P = (s: (typeof samples)[number], q: [number, number]) => [s.x - s.tz * q[0], s.y + q[1], s.z + s.tx * q[0]] as const;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i], b = samples[i + 1];
    for (let j = 0; j < segs; j++) {
      const p0 = profile[j], p1 = profile[(j + 1) % m];
      const A = P(a, p0), B = P(a, p1), C = P(b, p1), D = P(b, p0);
      pos.push(...A, ...D, ...C, ...A, ...C, ...B);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function pathSamples(path: Path, every: number, y: number, from = 0, to = path.length) {
  const out: { x: number; y: number; z: number; tx: number; tz: number }[] = [];
  const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
  const n = Math.max(1, Math.round((to - from) / every));
  for (let i = 0; i <= n; i++) {
    path.at(from + ((to - from) * i) / n, tmp);
    out.push({ x: tmp.x, y, z: tmp.z, tx: tmp.tx, tz: tmp.tz });
  }
  return out;
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

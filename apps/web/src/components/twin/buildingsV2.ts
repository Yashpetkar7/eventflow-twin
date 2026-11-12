// Procedural buildings for the realism scene (docs/13 R3). Pure data in, typed arrays out, so it runs in a web worker
// (buildings.worker.ts) and, as a fallback, on the main thread.
//   towers ≥ 60 m on a big footprint: podium + set-back shaft, a narrower lit crown above 200 m, a helipad above 150 m
//   houses: hip roof · everything else: flat roof 1.1 m below the wall top, so the wall reads as a parapet
//   near the corridor (`detail`): rooftop plant boxes, AC units and water tanks
// Walls carry (metres along the perimeter, metres above ground), the type class and the building height for the
// façade shader (facade.ts); roofs and rooftop kit carry type −1 and the satellite-sampled roof colour from R1.
import * as THREE from "three";
import { mulberry } from "./sceneData";

export const CLASS = { tower: 0, midrise: 1, villa: 2, lowrise: 3, industrial: 4, mosque: 5, stadium: 6 } as const;   // manifest.classes order
// 8-bit normals and colours, and seed / type / height in one attribute: 36 bytes a vertex instead of 48 (the ring is ~2 million vertices)
export interface BuildingArrays { position: Float32Array; normal: Int8Array; uv: Float32Array; color: Uint8Array; aInfo: Float32Array; index: Uint32Array }
export interface BuildingInput { buildings: number[][]; roof: number[]; cls: number[]; detail: boolean }

// wall colours per class (sRGB hex): glass tints for towers, sand and cream for homes, greys for sheds
const PALETTE: number[][] = [
  [0x8fb0c4, 0x6f97b3, 0x9fbfc9, 0x7ea3b0, 0xb3c4cc, 0x5f89a6],                    // tower: blue-green curtain wall
  [0xe2d3b6, 0xd9c7a4, 0xead9c0, 0xcfbb98, 0xe6dccb, 0xd6c2a6, 0xc9b594],          // residential mid-rise: beige / sand
  [0xf0e8da, 0xe9dcc6, 0xf4efe6, 0xe2d2b8, 0xece2d0],                              // villa: white and cream
  [0xd8d0c2, 0xcfc6b6, 0xe0d8ca, 0xc4bcae, 0xd2c4ac],                              // mall / low-rise
  [0xb9bcbf, 0xa9adb1, 0xc6c8ca, 0x9da3a8],                                        // warehouse
  [0xf1ece2, 0xe9e2d4], [0xd9d9d6, 0xcfd2d4],                                      // mosque, stadium
];
const KIT = 0x9a9c9e, PAD = 0x4d5257;

export function buildBuildings({ buildings, roof, cls, detail }: BuildingInput): BuildingArrays {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], info: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  let sd = 0, H = 0;
  const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, t: number) => {
    pos.push(x, y, z); nor.push(nx * 127, ny * 127, nz * 127); uv.push(u, v); col.push(c.r * 255, c.g * 255, c.b * 255); info.push(sd, t, H);
    return pos.length / 3 - 1;
  };
  const wall = (ring: number[], y0: number, y1: number, t: number) => {
    const n = ring.length / 2;
    let per = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = ring[i * 2], z0 = ring[i * 2 + 1], x1 = ring[j * 2], z1 = ring[j * 2 + 1];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1, nx = dz / len, nz = -dx / len;      // outward for counter-clockwise rings
      const a = vert(x0, y0, z0, nx, 0, nz, per, y0, t);
      vert(x1, y0, z1, nx, 0, nz, per + len, y0, t); vert(x1, y1, z1, nx, 0, nz, per + len, y1, t); vert(x0, y1, z0, nx, 0, nz, per, y1, t);
      idx.push(a, a + 2, a + 1, a, a + 3, a + 2);
      per += len;
    }
  };
  const cap = (ring: number[], y: number) => {
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < ring.length; i += 2) contour.push(new THREE.Vector2(ring[i], ring[i + 1]));
    const base = pos.length / 3;
    for (const p of contour) vert(p.x, y, p.y, 0, 1, 0, 0, 0, -1);
    for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) idx.push(base + t[0], base + t[2], base + t[1]);
  };
  const centre = (ring: number[]) => { let x = 0, z = 0; for (let i = 0; i < ring.length; i += 2) { x += ring[i]; z += ring[i + 1]; } return [x / (ring.length / 2), z / (ring.length / 2)]; };
  const shrink = (ring: number[], k: number) => { const [cx, cz] = centre(ring); return ring.map((v, i) => (i % 2 ? cz + (v - cz) * k : cx + (v - cx) * k)); };
  const area = (ring: number[]) => { let a = 0; for (let i = 0, n = ring.length / 2; i < n; i++) { const j = (i + 1) % n; a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]; } return Math.abs(a) / 2; };
  const prism = (cx: number, cz: number, r: number, sides: number, turn: number, y0: number, y1: number) => {     // boxes (4 sides), tanks (6), helipads (10)
    const ring: number[] = [];
    for (let i = 0; i < sides; i++) { const a = turn - (i / sides) * Math.PI * 2; ring.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r); }
    wall(ring, y0, y1, -1); cap(ring, y1);
  };
  const hip = (ring: number[], y: number, rise: number) => {                                                     // one roof plane per wall, meeting above the centre
    const [cx, cz] = centre(ring), n = ring.length / 2;
    if (!detail) {                                          // far ring: shared vertices (n + 1 instead of 3n), soft shading
      const apex = vert(cx, y + rise, cz, 0, 1, 0, 0, 0, -1);
      for (let i = 0; i < n; i++) { const dx = ring[i * 2] - cx, dz = ring[i * 2 + 1] - cz, l = Math.hypot(dx, dz, 3 * rise) || 1; vert(ring[i * 2], y, ring[i * 2 + 1], dx / l, (3 * rise) / l, dz / l, 0, 0, -1); }
      for (let i = 0; i < n; i++) idx.push(apex + 1 + i, apex, apex + 1 + ((i + 1) % n));
      return;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = ring[i * 2], z0 = ring[i * 2 + 1], x1 = ring[j * 2], z1 = ring[j * 2 + 1];
      const ux = x1 - x0, uz = z1 - z0, vx = cx - x0, vz = cz - z0;
      let nx = uz * rise, ny = ux * vz - uz * vx, nz = -ux * rise;                                               // (edge × to-apex), flipped to point up
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      const a = vert(x0, y, z0, nx / l, ny / l, nz / l, 0, 0, -1);
      vert(x1, y, z1, nx / l, ny / l, nz / l, 0, 0, -1); vert(cx, y + rise, cz, nx / l, ny / l, nz / l, 0, 0, -1);
      idx.push(a, a + 2, a + 1);
    }
  };

  for (let b = 0; b < buildings.length; b++) {
    const rec = buildings[b], h = rec[0], y0 = rec[1], ring = rec.slice(2), k = cls[b];
    const rnd = mulberry(b * 7919 + Math.round(ring[0] * 13 + ring[1] * 31));
    const pal = PALETTE[k] ?? PALETTE[3], a = area(ring);
    const wallHex = pal[Math.floor(rnd() * pal.length)], shade = (rnd() - 0.5) * 0.06;
    const walls = () => { c.setHex(wallHex).offsetHSL(0, 0, shade); }, roofs = () => { c.setHex(roof[b]); }, kit = (hex: number) => { c.setHex(hex).offsetHSL(0, 0, shade); };
    sd = rnd(); H = h;
    let top = h, deck = ring;                               // where the rooftop kit stands

    if (k === CLASS.tower && h >= 60 && a > 700 && y0 === 0) {
      const podium = Math.min(22, Math.max(9, h * 0.12)), shaft = shrink(ring, 0.8 - 0.1 * rnd());
      walls(); wall(ring, 0, podium, k);
      roofs(); cap(ring, podium - 0.6);
      if (h > 200) {                                        // crown: a narrower lit top
        const from = h * 0.92, crown = shrink(shaft, 0.62);
        walls(); wall(shaft, podium - 0.6, from, k); wall(crown, from, h, k);
        roofs(); cap(shaft, from); cap(crown, h - 0.8);
        deck = crown;
      } else {
        walls(); wall(shaft, podium - 0.6, h, k);
        roofs(); cap(shaft, h - 1.1);
        deck = shaft; top = h - 1.1;
        if (h > 150) { const [cx, cz] = centre(shaft); kit(PAD); prism(cx, cz, Math.min(9, Math.sqrt(area(shaft)) * 0.3), 10, 0, top, top + 0.5); }
      }
    } else if (k === CLASS.villa && ring.length <= 16 && a < 600 && y0 === 0) {
      walls(); wall(ring, y0, h, k);
      roofs(); hip(ring, h, Math.min(2.6, Math.sqrt(a) * 0.16));
      continue;
    } else {
      const parapet = h > 6 && k !== CLASS.industrial ? 1.1 : 0.3;
      walls(); wall(ring, y0, h, k);
      roofs(); cap(ring, h - parapet);
      top = h - parapet;
    }
    // rooftop kit near the corridor: plant boxes and AC units, a water tank on some residential blocks
    if (detail && (k === CLASS.tower || k === CLASS.midrise || k === CLASS.lowrise) && a > 350 && h > 9 && !(k === CLASS.tower && h > 150)) {
      const [cx, cz] = centre(deck), spread = Math.sqrt(area(deck)) * 0.2, turn = rnd() * Math.PI;
      const count = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < count; i++) {
        kit(KIT);
        prism(cx + (rnd() - 0.5) * spread * 2, cz + (rnd() - 0.5) * spread * 2, 1.6 + rnd() * 2.6, 4, turn + Math.PI / 4, top, top + 1.6 + rnd() * 1.8);
      }
      if (k === CLASS.midrise && rnd() < 0.45) { kit(0xe8e6e0); prism(cx + (rnd() - 0.5) * spread * 2, cz + (rnd() - 0.5) * spread * 2, 1.5, 6, 0, top, top + 2.4); }
    }
  }
  return { position: new Float32Array(pos), normal: new Int8Array(nor), uv: new Float32Array(uv), color: new Uint8Array(col),
    aInfo: new Float32Array(info), index: new Uint32Array(idx) };
}

export function toGeometry(a: BuildingArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3, true));
  g.setAttribute("uv", new THREE.BufferAttribute(a.uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(a.color, 3, true));
  g.setAttribute("aInfo", new THREE.BufferAttribute(a.aInfo, 3));                 // seed, type class (−1 = roof / kit), building height
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  return g;
}

"use client";
// The static city: ground map, water, extruded OpenStreetMap buildings with a procedural façade (lit windows at
// night), major roads, the lane-marked Sheikh Zayed Road carriageways, flyovers, palms and street lights.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { useTwin } from "@/lib/store";
import { buildingsGeometry, canvasTexture, flatPolygons, ribbons, sweep } from "./builders";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { facadeMaterialV2 } from "./facade";
import type { Models } from "./models";
import { R7 } from "./perf";
import { Ring } from "./Ring";
import type { Manifest } from "@/lib/manifest";
import { live, mulberry, pairs, Path, type SceneJson } from "./sceneData";

export const LANE = 3.65, SHOULDER = 1.5;
export const roadWidth = (lanes: number) => lanes * LANE + SHOULDER * 2;

export interface Corridor { metro: Path; szr: { path: Path; lanes: Float32Array; dir: number }[] }

export function buildCorridor(data: SceneJson): Corridor {
  const metro = new Path(pairs(data.metro), 8, true);
  const szr = data.szr.map((c) => {
    const path = new Path(pairs(c.p), 6, true);
    const lanes = new Float32Array(path.n);
    for (let i = 0; i < path.n; i++) lanes[i] = c.lanes[Math.min(c.lanes.length - 1, Math.round(path.src[i]))];
    // smooth lane-count changes so the carriageway tapers instead of stepping
    const sm = new Float32Array(path.n);
    for (let i = 0; i < path.n; i++) {
      let a = 0, n = 0;
      for (let j = Math.max(0, i - 8); j <= Math.min(path.n - 1, i + 8); j++) { a += lanes[j]; n++; }
      sm[i] = a / n;
    }
    return { path, lanes: sm, dir: c.dir };
  });
  return { metro, szr };
}

const HASH = /* glsl */ `float eftHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }`;

/** Façade shader patch for MeshStandardMaterial: window grid by day, lit windows by night (uNight). */
function facadeMaterial(uniforms: { uNight: { value: number } }) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float aSeed; attribute float aWin; varying vec2 vFac; varying float vSeed; varying float vWin;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvFac = uv; vSeed = aSeed; vWin = aWin * (1.0 - step(0.5, normal.y));`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uNight; varying vec2 vFac; varying float vSeed; varying float vWin;\n${HASH}`)
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        float eftW = 0.0;
        {
          // three levels of detail: single windows → blocks of windows → whole storeys, chosen by screen-space size
          float on = vWin * step(3.0, vFac.y);
          float litShare = 0.16 + 0.5 * eftHash(vec2(vSeed, 7.3));
          float rest = 1.0, winAcc = 0.0, litAcc = 0.0;
          vec3 lampAcc = vec3(0.0), glassAcc = vec3(0.0);
          vec2 cell = vec2(3.3, 3.7);
          for (int lod = 0; lod < 3; lod++) {
            vec2 g = vFac / cell;
            vec2 fw = fwidth(g);
            float crisp = (1.0 - smoothstep(0.3, 0.85, max(fw.x, fw.y))) * rest;
            vec2 id = floor(g), f = fract(g);
            float win = step(0.14, f.x) * step(f.x, 0.86) * step(0.2, f.y) * step(f.y, 0.82);
            float h1 = eftHash(id + vSeed * 97.0 + float(lod) * 13.0);
            winAcc += crisp * win;
            litAcc += crisp * win * step(h1, litShare);
            lampAcc += crisp * mix(vec3(1.0, 0.80, 0.52), vec3(0.78, 0.88, 1.0), step(0.72, eftHash(id + 3.1 + vSeed)));
            glassAcc += crisp * mix(vec3(0.10, 0.16, 0.24), vec3(0.26, 0.38, 0.52), eftHash(id * 1.7 + vSeed));
            rest -= crisp;
            cell *= vec2(4.0, 3.0);
          }
          winAcc += rest * 0.46; litAcc += rest * 0.46 * litShare;
          lampAcc += rest * vec3(1.0, 0.82, 0.6); glassAcc += rest * vec3(0.18, 0.27, 0.38);
          eftW = winAcc * on;
          diffuseColor.rgb = mix(diffuseColor.rgb, glassAcc, eftW * 0.92);
          diffuseColor.rgb *= 1.0 - 0.45 * uNight;
          totalEmissiveRadiance += lampAcc * uNight * on * litAcc * 1.55;
        }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, eftW);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, eftW);`);
  };
  return m;
}

const NOISE = /* glsl */ `
  float eftN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(eftHash(i), eftHash(i + vec2(1, 0)), f.x), mix(eftHash(i + vec2(0, 1)), eftHash(i + vec2(1, 1)), f.x), f.y); }`;

/** Ground: the baked map (or plain sand) modulated by world-space noise — fine grain plus soft dune-scale drift. */
function groundMaterial(map: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0xd8c298, roughness: 0.97, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGw;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGw = (modelMatrix * vec4(position, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vGw;\n${HASH}\n${NOISE}`)
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        {
          float drift = eftN(vGw * 0.0016) * 0.6 + eftN(vGw * 0.006) * 0.4;
          float grain = eftN(vGw * 0.11) * 0.6 + eftN(vGw * 0.45) * 0.4;
          float fade = 1.0 - smoothstep(0.05, 0.9, fwidth(vGw.x) * 0.45);
          diffuseColor.rgb *= 0.9 + 0.16 * drift + 0.09 * (grain - 0.5) * fade;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.99, 0.9), 0.5);   // warm sand cast
        }`);
  };
  return m;
}

/** Lane markings for the Sheikh Zayed Road carriageways (aW = width in metres, uv.y = 0 on the median side). */
function highwayMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.86, metalness: 0.0, emissive: 0xffb469, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float aW; varying vec3 vRd;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvRd = vec3(uv.x, uv.y * aW, aW);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vRd;\n${HASH}`)
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        {
          float inner = vRd.z - ${(SHOULDER * 2).toFixed(1)};
          float lanes = max(1.0, floor(inner / ${LANE.toFixed(2)} + 0.5));
          float lw = inner / lanes;
          float y = vRd.y - ${SHOULDER.toFixed(1)};
          float ly = y / lw;
          float d = abs(fract(ly + 0.5) - 0.5) * lw;
          float aa = fwidth(vRd.y) + 0.0001;
          float vis = 1.0 - smoothstep(0.5, 2.6, aa);
          float between = step(0.5, ly) * step(ly, lanes - 0.5);
          float dash = step(fract(vRd.x / 12.0), 0.36);
          float line = (1.0 - smoothstep(0.08, 0.08 + aa, d)) * between * dash;
          float edgeL = 1.0 - smoothstep(0.1, 0.1 + aa, abs(y));
          float edgeR = 1.0 - smoothstep(0.1, 0.1 + aa, abs(y - inner));
          // lane wear: darker tyre tracks either side of each lane centre, patchy along the road
          float lanePos = fract(ly) - 0.5;
          float tracks = (1.0 - smoothstep(0.0, 0.06, abs(abs(lanePos) - 0.22))) * step(0.0, ly) * step(ly, lanes);
          float wearPatch = 0.86 + 0.28 * eftHash(floor(vec2(vRd.x * 0.07, ly)));
          diffuseColor.rgb *= wearPatch * (1.0 - 0.16 * tracks * vis);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86), line * vis * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.75, 0.25), edgeL * vis * 0.9);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86), edgeR * vis * 0.85);
        }`)
      .replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
        {                                                    // R10: the night glow gathers in a pool under each median lamp (one every 34 m)
          float along = (fract((vRd.x - 30.0) / 34.0 + 0.5) - 0.5) * 34.0;
          totalEmissiveRadiance *= 0.4 + 1.7 * exp(-along * along / 120.0 - vRd.y * vRd.y / 300.0);
        }`);
  };
  return m;
}

const PALMS = ["palm_a", "palm_b", "palm_c"] as const;
const PALM_LOD = 900, PALM_FAR = 3200;              // metres from the camera: a palm is about 17 px tall at the first, 5 px at the second

/** Realism scene (docs/13 R5): Blender palms instanced along Sheikh Zayed Road and on the tree pixels of the land-cover
 *  mask inside the corridor, with wind sway in the vertex shader; street-light poles down the median. Park palms and
 *  poles are extras: they go first when the quality tier drops. */
function Greenery({ models, manifest, road, lamps }: { models: Models; manifest: Manifest; road: number[]; lamps: Float32Array }) {
  const tier = useTwin((s) => s.tier);
  const [park, setPark] = useState<number[]>([]);
  const time = useMemo(() => ({ value: 0 }), []);
  useEffect(() => {
    let dead = false;
    const e = manifest.extent, rnd = mulberry(41), out: number[] = [];
    (async () => {
      for (const c of manifest.chunks) {
        if (!(c.extent[0] < e[1] && c.extent[1] > e[0] && c.extent[2] < e[3] && c.extent[3] > e[2])) continue;
        const img = new Image();
        img.src = `/geo/v2/${c.mask}`;
        await img.decode();
        const cv = document.createElement("canvas");
        cv.width = img.width; cv.height = img.height;
        const g = cv.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, img.width, img.height).data, w = c.extent[1] - c.extent[0], d = c.extent[3] - c.extent[2];
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
          if (px[(y * img.width + x) * 4] < 200 || rnd() > 0.35) continue;                 // red = tree cover (ESA WorldCover)
          const wx = c.extent[0] + ((x + rnd()) / img.width) * w, wz = c.extent[2] + ((y + rnd()) / img.height) * d;
          if (wx > e[0] && wx < e[1] && wz > e[2] && wz < e[3]) out.push(wx, wz, 0.8 + rnd() * 0.45);
        }
      }
      if (!dead) setPark(out.slice(0, 1500 * 3));
    })().catch(() => { /* no park palms */ });
    return () => { dead = true; };
  }, [manifest]);
  const mats = useMemo(() => {
    const leaf = new THREE.MeshStandardMaterial({ color: 0x5c8f45, roughness: 0.8, vertexColors: true, side: THREE.DoubleSide });
    leaf.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace("#include <begin_vertex>", `#include <begin_vertex>
        float eftH = smoothstep(5.0, 11.0, position.y);                     // only the crown moves
        #ifdef USE_INSTANCING
          float eftPh = instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07;
        #else
          float eftPh = 0.0;
        #endif
        transformed.x += sin(uTime * 1.3 + eftPh + position.y * 0.3) * 0.22 * eftH;
        transformed.z += cos(uTime * 1.1 + eftPh) * 0.16 * eftH;`);
    };
    return { leaf, trunk: new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9, vertexColors: true }), pole: new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.6, metalness: 0.4 }) };
  }, [time]);
  const pole = useMemo(() => mergeGeometries([new THREE.CylinderGeometry(0.11, 0.16, 11.5, 6).translate(0, 5.75, 0), new THREE.BoxGeometry(3.4, 0.14, 0.2).translate(0, 11.4, 0)])!, []);
  useEffect(() => () => { Object.values(mats).forEach((m) => m.dispose()); pole.dispose(); }, [mats, pole]);
  // every third palm of each list goes to each variant; a seeded turn so the leans differ
  const sets = useMemo(() => PALMS.map((_, v) => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), out: { m: THREE.Matrix4; park: boolean; x: number; z: number }[] = [];
    const add = (list: number[], isPark: boolean) => {
      for (let i = v * 3; i < list.length; i += 9) {
        const s = list[i + 2];
        out.push({ m: m.clone().compose(new THREE.Vector3(list[i], 0, list[i + 1]), q.setFromAxisAngle(up, (i * 2.399) % 6.283), new THREE.Vector3(s, s, s)), park: isPark, x: list[i], z: list[i + 1] });
      }
    };
    add(road, false); add(park, true);
    return out;
  }), [road, park]);
  const total = sets.reduce((n, l) => n + l.length, 0);
  // Three levels by distance from the camera (R7): the Blender palm up close, its 25 % version in the middle distance,
  // and beyond PALM_FAR — where a palm is under 6 px tall — one 20-triangle stand-in for all three variants: a thin
  // trunk and a crown the size and mean colour of the model's. Every palm is always drawn; only its detail changes.
  const far = useMemo(() => {
    const mean = (g: THREE.BufferGeometry, hex: number) => {
      const c = g.attributes.color, out = new THREE.Color(hex), k = new THREE.Vector3(1, 1, 1);
      if (c) { k.set(0, 0, 0); for (let i = 0; i < c.count; i++) { k.x += c.getX(i); k.y += c.getY(i); k.z += c.getZ(i); } k.divideScalar(Math.max(1, c.count)); }
      return out.setRGB(out.r * k.x, out.g * k.y, out.b * k.z);
    };
    const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    };
    const leaf = models.palm_a.lod.leaf, trunk = models.palm_a.lod.trunk;
    leaf.computeBoundingBox(); trunk.computeBoundingBox();
    const lb = leaf.boundingBox!, top = trunk.boundingBox!.max.y, r = Math.max(lb.max.x, -lb.min.x, lb.max.z, -lb.min.z) * 0.7, mid = (lb.min.y + lb.max.y) / 2 + 0.6;
    const stem = paint(new THREE.CylinderGeometry(0.2, 0.3, top, 4, 1, true).translate(0, top / 2, 0), mean(trunk, 0x8a6a45));
    const crown = paint(new THREE.SphereGeometry(1, 6, 2).scale(r, (lb.max.y - lb.min.y) * 0.34, r).translate(0, mid, 0), mean(leaf, 0x5c8f45).multiplyScalar(0.7));
    const geo = mergeGeometries([stem, crown])!;
    stem.dispose(); crown.dispose();
    return { geo, mat: new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }) };
  }, [models]);
  useEffect(() => () => { far.geo.dispose(); far.mat.dispose(); }, [far]);
  const im = useRef<{ trunk: (THREE.InstancedMesh | null)[]; leaf: (THREE.InstancedMesh | null)[]; trunkLod: (THREE.InstancedMesh | null)[]; leafLod: (THREE.InstancedMesh | null)[]; far: THREE.InstancedMesh | null }>({ trunk: [], leaf: [], trunkLod: [], leafLod: [], far: null });
  const sorted = useRef({ x: 1e9, y: 0, z: 1e9, sets: null as unknown, tier: -1 });
  useFrame(({ camera }) => {
    time.value = live.animT;
    const p = camera.position, k = sorted.current, r = im.current;
    const fresh = k.sets !== sets || k.tier !== tier;
    if (!r.far || (!fresh && Math.hypot(p.x - k.x, p.y - k.y, p.z - k.z) < 60)) return;      // re-sort after every 60 m of camera travel
    k.x = p.x; k.y = p.y; k.z = p.z; k.sets = sets; k.tier = tier;
    if (fresh) live.shadowDirty = 2;
    let nFar = 0;
    sets.forEach((list, v) => {
      const full = [r.trunk[v], r.leaf[v]], lod = [r.trunkLod[v], r.leafLod[v]];
      let a = 0, b = 0;
      for (const q of list) {
        if (q.park && tier > 0) continue;                                                       // park palms are an extra: off from tier 1
        const d = R7.palms ? Math.hypot(q.x - p.x, p.y, q.z - p.z) : 0;
        if (d < PALM_LOD) { full[0]?.setMatrixAt(a, q.m); full[1]?.setMatrixAt(a++, q.m); }
        else if (d < PALM_FAR) { lod[0]?.setMatrixAt(b, q.m); lod[1]?.setMatrixAt(b++, q.m); }
        else r.far!.setMatrixAt(nFar++, q.m);
      }
      for (const x of full) if (x) { x.count = a; x.instanceMatrix.needsUpdate = true; }
      for (const x of lod) if (x) { x.count = b; x.instanceMatrix.needsUpdate = true; }
    });
    r.far.count = nFar; r.far.instanceMatrix.needsUpdate = true;
  });
  const poles = useMemo(() => { const m = new THREE.Matrix4(), out: THREE.Matrix4[] = []; for (let i = 0; i < lamps.length; i += 3) out.push(m.clone().makeTranslation(lamps[i], 0, lamps[i + 2])); return out; }, [lamps]);
  return (
    <group>
      {PALMS.map((name, v) => sets[v].length > 0 && (
        <group key={`${name}-${sets[v].length}`}>
          <instancedMesh args={[models[name].full.trunk, mats.trunk, sets[v].length]} ref={(x) => { im.current.trunk[v] = x; if (x) { x.count = 0; sorted.current.sets = null; } }} castShadow frustumCulled={false} />
          <instancedMesh args={[models[name].full.leaf, mats.leaf, sets[v].length]} ref={(x) => { im.current.leaf[v] = x; if (x) { x.count = 0; sorted.current.sets = null; } }} castShadow frustumCulled={false} />
          <instancedMesh args={[models[name].lod.trunk, mats.trunk, sets[v].length]} ref={(x) => { im.current.trunkLod[v] = x; if (x) { x.count = 0; sorted.current.sets = null; } }} castShadow frustumCulled={false} />
          <instancedMesh args={[models[name].lod.leaf, mats.leaf, sets[v].length]} ref={(x) => { im.current.leafLod[v] = x; if (x) { x.count = 0; sorted.current.sets = null; } }} castShadow frustumCulled={false} />
        </group>
      ))}
      {total > 0 && <instancedMesh key={total} args={[far.geo, far.mat, total]} ref={(x) => { im.current.far = x; if (x) { x.count = 0; sorted.current.sets = null; } }} castShadow frustumCulled={false} />}
      {tier === 0 && poles.length > 0 && (
        <instancedMesh args={[pole, mats.pole, poles.length]} frustumCulled={false}
          ref={(im) => { if (im) { poles.forEach((mm, i) => im.setMatrixAt(i, mm)); im.instanceMatrix.needsUpdate = true; } }} />
      )}
    </group>
  );
}

export function City({ data, corridor, manifest, models = null }: { data: SceneJson; corridor: Corridor; manifest: Manifest | null; models?: Models | null }) {
  const showBuildings = useTwin((s) => s.layers.buildings);
  const groundTex = useLoader(THREE.TextureLoader, `/geo/${data.meta.ground.file}`);
  const uniforms = useMemo(() => ({ uNight: { value: 0 } }), []);

  const built = useMemo(() => {
    const g = data.meta.ground;
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = 8;
    groundTex.flipY = false;                           // image row 0 = z0 (inland edge)
    groundTex.needsUpdate = true;
    const ground = new THREE.PlaneGeometry(g.x1 - g.x0, g.z1 - g.z0);
    ground.rotateX(-Math.PI / 2);
    ground.translate((g.x0 + g.x1) / 2, 0, (g.z0 + g.z1) / 2);
    const uvs = ground.attributes.uv, p = ground.attributes.position;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, (p.getX(i) - g.x0) / (g.x1 - g.x0), (p.getZ(i) - g.z0) / (g.z1 - g.z0));

    const glow = canvasTexture(64, 64, (c) => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    });

    const roadsByClass = [0, 1, 2].map((cls) => ribbons(data.roads.filter((r) => r[0] === cls).map((r) => ({ pts: pairs(r, 2), w: r[1], y: 0.42 - cls * 0.1 }))));
    const szr = ribbons(corridor.szr.map(({ path, lanes }) => ({
      pts: Array.from({ length: path.n }, (_, i) => [path.x[i], path.z[i]] as [number, number]),
      w: Array.from(lanes, (l) => roadWidth(l)), y: 0.62,
    })));
    // flyovers: a deck with skirts, following the baked height profile
    const decks: THREE.BufferGeometry[] = [];
    for (const f of data.flyovers) {
      const s: { x: number; y: number; z: number; tx: number; tz: number }[] = [];
      for (let i = 0; i + 2 < f.p.length; i += 3) s.push({ x: f.p[i], y: f.p[i + 1] + 0.7, z: f.p[i + 2], tx: 1, tz: 0 });
      for (let i = 0; i < s.length; i++) {
        const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        s[i].tx = (b.x - a.x) / l; s[i].tz = (b.z - a.z) / l;
      }
      const hw = f.w / 2;
      if (s.length > 1) decks.push(sweep(s, [[-hw, 0], [hw, 0], [hw, -1.1], [-hw, -1.1]]));
    }
    const rails: THREE.BufferGeometry[] = [];
    for (const fb of data.footbridges) {
      const pts = pairs(fb);
      const s = pts.map(([x, z], i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return { x, y: 7.2, z, tx: (b[0] - a[0]) / l, tz: (b[1] - a[1]) / l };
      });
      rails.push(sweep(s, [[-2.4, 0], [2.4, 0], [2.4, 3.1], [-2.4, 3.1]]));
    }
    const merge = (gs: THREE.BufferGeometry[]) => {
      const pos: number[] = [], nor: number[] = [];
      for (const g2 of gs) { pos.push(...(g2.attributes.position.array as Float32Array)); nor.push(...(g2.attributes.normal.array as Float32Array)); g2.dispose(); }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      return out;
    };

    // palms along both carriageways (outer verge) + street-light points down the median
    const rnd = mulberry(23);
    const palms: number[] = [], lamps: number[] = [];
    const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
    for (const { path, lanes } of corridor.szr) {
      for (let s = 30; s < path.length - 30; s += 34) {
        path.at(s, tmp);
        if (Math.abs(tmp.z) > 420) continue;            // only along the corridor itself
        const hw = roadWidth(lanes[Math.min(path.n - 1, Math.round(s / path.step))]) / 2;
        palms.push(tmp.x - tmp.tz * (hw + 4.5), tmp.z + tmp.tx * (hw + 4.5), 0.85 + rnd() * 0.4);
        lamps.push(tmp.x + tmp.tz * (hw + 1.2), 11.5, tmp.z - tmp.tx * (hw + 1.2));        // median street light
      }
    }
    return {
      ground, glow,
      water: flatPolygons(data.water, 0.35),
      // with the realism ring (v2) the ground, buildings and ghosted tops come from its chunks instead
      buildings: buildingsGeometry(manifest ? [] : data.buildings),
      ghosts: buildingsGeometry(manifest ? manifest.ghosts : data.ghosts),
      roadsByClass, szr, decks: merge(decks), rails: merge(rails), palms, lamps: new Float32Array(lamps),
    };
  }, [data, corridor, groundTex, manifest]);

  const mats = useMemo(() => ({
    ground: groundMaterial(groundTex),
    sand: groundMaterial(null),
    water: new THREE.MeshStandardMaterial({ color: 0x2a7fa6, roughness: 0.06, metalness: 0.6, envMapIntensity: 1.25, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    facade: manifest ? facadeMaterialV2(uniforms) : facadeMaterial(uniforms),
    facadeFar: manifest ? facadeMaterialV2(uniforms, THREE.FrontSide) : null,
    ghost: new THREE.MeshBasicMaterial({ color: 0xb8cfe4, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    road: new THREE.MeshStandardMaterial({ color: 0x45484e, roughness: 0.92, emissive: 0xffb469, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    highway: highwayMaterial(),
    deck: new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fc3d8, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.6 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x4f8a3c, roughness: 0.8 }),
    lamp: new THREE.PointsMaterial({ color: 0xffcf8a, size: 9, sizeAttenuation: true, map: built.glow, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  }), [groundTex, built.glow, uniforms, manifest]);

  const palmGeo = useMemo(() => {
    const trunk = new THREE.CylinderGeometry(0.28, 0.42, 9, 6).translate(0, 4.5, 0);
    const crown = new THREE.ConeGeometry(3.6, 2.6, 7).rotateX(Math.PI).translate(0, 9.9, 0);
    return { trunk, crown };
  }, []);
  const palmMatrices = useMemo(() => {
    const m = new THREE.Matrix4(), out: THREE.Matrix4[] = [];
    for (let i = 0; i < built.palms.length; i += 3) {
      const s = built.palms[i + 2];
      out.push(m.clone().makeScale(s, s, s).setPosition(built.palms[i], 0, built.palms[i + 1]));
    }
    return out;
  }, [built.palms]);

  useEffect(() => () => {
    Object.values(built).forEach((v) => {
      if (v instanceof THREE.BufferGeometry || v instanceof THREE.Texture) v.dispose();
      if (Array.isArray(v)) v.forEach((x) => x instanceof THREE.BufferGeometry && x.dispose());
    });
    Object.values(mats).forEach((m) => m?.dispose());
    palmGeo.trunk.dispose(); palmGeo.crown.dispose();
  }, [built, mats, palmGeo]);

  useFrame(() => {
    uniforms.uNight.value = live.night;
    mats.ghost.opacity = (0.1 - 0.06 * live.night) * Math.max(0, Math.min(1, (live.camDist - 1400) / 2200));
    mats.lamp.opacity = live.night * 0.95;
    mats.lamp.size = Math.max(16, Math.min(90, live.camDist * 0.0125));
    mats.highway.emissiveIntensity = live.night * 0.34;          // sodium-lit carriageways read as glowing arteries from above
    mats.road.emissiveIntensity = live.night * 0.13;
  });

  return (
    <group>
      {manifest ? <Ring manifest={manifest} facade={mats.facade} facadeFar={mats.facadeFar ?? mats.facade} show={showBuildings} /> : (
        <>
          <mesh rotation-x={-Math.PI / 2} position-y={-0.4} receiveShadow material={mats.sand}>
            <planeGeometry args={[60000, 60000]} />
          </mesh>
          <mesh geometry={built.ground} material={mats.ground} receiveShadow />
        </>
      )}
      {!manifest && <mesh geometry={built.water} material={mats.water} />}
      {built.roadsByClass.map((g, i) => <mesh key={i} geometry={g} material={manifest ? mats.highway : mats.road} receiveShadow />)}
      <mesh geometry={built.szr} material={mats.highway} receiveShadow />
      <mesh geometry={built.decks} material={mats.deck} castShadow receiveShadow />
      <mesh geometry={built.rails} material={mats.glass} />
      <group visible={showBuildings}>
        <mesh geometry={built.buildings} material={mats.facade} castShadow receiveShadow />
        <mesh geometry={built.ghosts} material={mats.ghost} renderOrder={2} />
        {manifest && models ? <Greenery models={models} manifest={manifest} road={built.palms} lamps={built.lamps} /> : (
          <>
            <instancedMesh args={[palmGeo.trunk, mats.trunk, palmMatrices.length]} ref={(im) => { if (im) { palmMatrices.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; } }} castShadow />
            <instancedMesh args={[palmGeo.crown, mats.leaf, palmMatrices.length]} ref={(im) => { if (im) { palmMatrices.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; } }} castShadow />
          </>
        )}
      </group>
      <points material={mats.lamp} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[built.lamps, 3]} />
        </bufferGeometry>
      </points>
    </group>
  );
}

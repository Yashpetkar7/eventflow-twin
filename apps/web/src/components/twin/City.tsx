"use client";
// The static city: ground map, water, extruded OpenStreetMap buildings with a procedural façade (lit windows at
// night), major roads, the lane-marked Sheikh Zayed Road carriageways, flyovers, palms and street lights.
import { useEffect, useMemo } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { useTwin } from "@/lib/store";
import { buildingsGeometry, canvasTexture, flatPolygons, ribbons, sweep } from "./builders";
import { facadeMaterialV2 } from "./facade";
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
        }`);
  };
  return m;
}

export function City({ data, corridor, manifest }: { data: SceneJson; corridor: Corridor; manifest: Manifest | null }) {
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
        <instancedMesh args={[palmGeo.trunk, mats.trunk, palmMatrices.length]} ref={(im) => { if (im) { palmMatrices.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; } }} castShadow />
        <instancedMesh args={[palmGeo.crown, mats.leaf, palmMatrices.length]} ref={(im) => { if (im) { palmMatrices.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; } }} castShadow />
      </group>
      <points material={mats.lamp} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[built.lamps, 3]} />
        </bufferGeometry>
      </points>
    </group>
  );
}

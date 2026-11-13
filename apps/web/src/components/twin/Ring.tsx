"use client";
// Realism ring (?scene=v2 — docs/13_REALISM_FABLE_TASKS.md, R1–R3): the Sentinel-2 ground and the Overture buildings of the
// 20 km ring, streamed chunk by chunk (nearest to the corridor first) over a low-resolution 40 km overview.
// Everything is read from public/geo/v2/ — nothing leaves localhost.
import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundMaterial, solidTexture } from "./atmosphere";
import { buildBuildings, toGeometry, type BuildingArrays, type BuildingInput } from "./buildingsV2";
import type { ChunkJson, Manifest } from "@/lib/manifest";
import { R7, TILE_FAR, TILE_NEAR } from "./perf";
import { live } from "./sceneData";

const DIR = "/geo/v2/";
// The ground is drawn after everything else that is opaque, top layer first (chunks, then the overview under them, then
// the far desert and sea), so its shader — the most expensive per pixel — runs only where the ground is actually seen.
const GROUND = R7.order ? [1, 2, 3] : [0, 0, 0];
type Box = [number, number, number, number];

const NONE: number[] = [];
function plane([x0, x1, z0, z1]: Box, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) - x0) / (x1 - x0), (p.getZ(i) - z0) / (z1 - z0));   // image row 0 = z0 (inland)
  return g;
}

async function texture(file: string, srgb: boolean): Promise<THREE.Texture> {
  const t = await new THREE.TextureLoader().loadAsync(DIR + file);
  t.flipY = false; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Building geometry in a web worker, one request at a time per call; on the main thread if workers are unavailable. */
function builder() {
  let worker: Worker | null = null, next = 0;
  const waiting = new Map<number, (a: BuildingArrays) => void>();
  try {
    worker = new Worker(new URL("./buildings.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; out: BuildingArrays }>) => { waiting.get(e.data.id)?.(e.data.out); waiting.delete(e.data.id); };
    worker.onerror = () => { worker?.terminate(); worker = null; for (const [, done] of waiting) done(EMPTY); waiting.clear(); };
  } catch { worker = null; }
  document.documentElement.dataset.sceneV2Builder = worker ? "worker" : "main";     // read by the UI tests
  return {
    build: (input: BuildingInput) => (worker
      ? new Promise<BuildingArrays>((done) => { const id = next++; waiting.set(id, done); worker!.postMessage({ id, input }); })
      : Promise.resolve(buildBuildings(input))),
    close: () => worker?.terminate(),
  };
}
const EMPTY = buildBuildings({ buildings: [], roof: [], cls: [], detail: false });

interface Loaded { id: string; plane: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; ao: THREE.Texture; mask: THREE.Texture; far: THREE.BufferGeometry[]; near: THREE.BufferGeometry[] }

/** `skip`: x, z, radius triples — buildings whose centre falls inside one are left out (a modelled landmark stands there). */
export function Ring({ manifest, facade, facadeFar, show, skip = NONE }: { manifest: Manifest; facade: THREE.Material; facadeFar: THREE.Material; show: boolean; skip?: number[] }) {
  const [overview, setOverview] = useState<THREE.MeshStandardMaterial | null>(null);
  const [chunks, setChunks] = useState<Loaded[]>([]);
  const time = useMemo(() => ({ value: 0 }), []);                                       // one clock for every water surface
  const base = useMemo(() => {
    const seaTex = solidTexture(0x16384a);
    return {
      wide: plane(manifest.overview.extent, -2), seaTex,
      far: new THREE.MeshStandardMaterial({ color: 0xd8c298, roughness: 0.97 }),        // beyond the overview: desert inland …
      sea: groundMaterial({ map: seaTex }, time, true),                                 // … and the open Gulf on the sea side
    };
  }, [manifest, time]);
  useFrame(() => { time.value = live.animT; });

  useEffect(() => {
    let dead = false;
    const made: Loaded[] = [];
    let ov: THREE.MeshStandardMaterial | null = null, ovMaskTex: THREE.Texture | null = null;
    const e = manifest.extent, M = 300, work = builder();
    let fine: THREE.Texture | null = null;
    const mid = (c: { extent: Box }) => Math.hypot((c.extent[0] + c.extent[1]) / 2, (c.extent[2] + c.extent[3]) / 2);
    (async () => {
      const [ovMap, ovMask] = await Promise.all([texture(manifest.overview.file, true), texture(manifest.overview.mask, false)]);
      ovMaskTex = ovMask;
      ov = groundMaterial({ map: ovMap, mask: ovMask }, time);
      if (dead) return;
      setOverview(ov);
      fine = await texture(manifest.ao_corridor.file, false);                 // 2 m contact shadows along the corridor
      const aoFine = { tex: fine, extent: manifest.ao_corridor.extent };
      for (const c of [...manifest.chunks].sort((a, b) => mid(a) - mid(b))) {
        const [json, map, ao, mask] = await Promise.all([
          fetch(DIR + c.buildings).then((r) => r.json() as Promise<ChunkJson>), texture(c.ground, true), texture(c.ao, false), texture(c.mask, false)]);
        if (dead) return;
        // only buildings by the corridor cast shadows (the shadow box follows the corridor camera); they also get the
        // rooftop kit, the far ones stay plain: one mesh for each group — or, with ?r7on=tiles, one per tile, so the
        // renderer can leave out more of what is outside the view or the shadow box (see perf.ts).
        const tiles = new Map<string, BuildingInput>();
        const seen = [0, 0];                                    // a building's number within the chunk's near / far group
        json.buildings.forEach((b, i) => {
          if (skip.length) {                                    // under a modelled landmark (R8): the model replaces it
            let cx = 0, cz = 0;
            for (let q = 2; q < b.length; q += 2) { cx += b[q]; cz += b[q + 1]; }
            cx /= (b.length - 2) / 2; cz /= (b.length - 2) / 2;
            for (let q = 0; q < skip.length; q += 3) if (Math.hypot(cx - skip[q], cz - skip[q + 1]) < skip[q + 2]) return;
          }
          const near = b[2] > e[0] - M && b[2] < e[1] + M && b[3] > e[2] - M && b[3] < e[3] + M;
          const key = `${near ? "n" : "f"}${R7.tiles ? `${Math.floor(b[2] / (near ? TILE_NEAR : TILE_FAR))}_${Math.floor(b[3] / (near ? TILE_NEAR : TILE_FAR))}` : ""}`;
          let t = tiles.get(key);
          if (!t) tiles.set(key, t = { buildings: [], roof: [], cls: [], detail: near, ids: [] });
          t.buildings.push(b); t.roof.push(json.roof[i]); t.cls.push(json.cls[i]); t.ids!.push(seen[near ? 0 : 1]++);
        });
        const far: THREE.BufferGeometry[] = [], near: THREE.BufferGeometry[] = [];
        await Promise.all([...tiles.values()].map(async (input) => {
          const arrays = await work.build(input);
          if (arrays.index.length) (input.detail ? near : far).push(toGeometry(arrays));
        }));
        if (dead) { for (const g of [...far, ...near]) g.dispose(); return; }
        made.push({ id: c.id, plane: plane(c.extent, 0), mat: groundMaterial({ map, ao, mask, aoFine }, time), ao, mask, far, near });
        setChunks([...made]);
        document.documentElement.dataset.sceneV2 = `${made.length}/${manifest.chunks.length}`;     // read by the UI tests
        await new Promise((r) => setTimeout(r, 0));                                                 // let a frame through
      }
    })().catch(() => { /* a missing chunk leaves the overview in place */ });
    return () => {
      dead = true;
      work.close(); fine?.dispose();
      ov?.map?.dispose(); ov?.dispose(); ovMaskTex?.dispose();
      for (const c of made) { c.plane.dispose(); c.mat.map?.dispose(); c.mat.dispose(); c.ao.dispose(); c.mask.dispose(); for (const g of [...c.far, ...c.near]) g.dispose(); }
    };
  }, [manifest, time, skip]);
  useEffect(() => { live.shadowDirty = 2; }, [chunks, show]);            // new or hidden casters: redraw the shadow map
  useEffect(() => () => { base.wide.dispose(); base.far.dispose(); base.sea.dispose(); base.seaTex.dispose(); }, [base]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-4} material={base.far} renderOrder={GROUND[2]}>
        <planeGeometry args={[120000, 120000]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -3.8, 34500]} material={base.sea} renderOrder={GROUND[2]}>
        <planeGeometry args={[120000, 60000]} />
      </mesh>
      {overview && <mesh geometry={base.wide} material={overview} renderOrder={GROUND[1]} />}
      {chunks.map((c) => (
        <group key={c.id}>
          <mesh geometry={c.plane} material={c.mat} receiveShadow renderOrder={GROUND[0]} />
          {c.far.map((g, i) => <mesh key={`f${i}`} geometry={g} material={facadeFar} visible={show} receiveShadow />)}
          {c.near.map((g, i) => <mesh key={`n${i}`} geometry={g} material={facade} visible={show} castShadow receiveShadow />)}
        </group>
      ))}
    </group>
  );
}

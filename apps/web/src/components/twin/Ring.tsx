"use client";
// Realism ring (?scene=v2 — docs/13_REALISM_FABLE_TASKS.md, R1 + R2): the Sentinel-2 ground and the Overture buildings of the
// 20 km ring, streamed chunk by chunk (nearest to the corridor first) over a low-resolution 40 km overview.
// Everything is read from public/geo/v2/ — nothing leaves localhost.
import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundMaterial, solidTexture } from "./atmosphere";
import { buildingsGeometry } from "./builders";
import type { ChunkJson, Manifest } from "@/lib/manifest";
import { live } from "./sceneData";

const DIR = "/geo/v2/";
type Box = [number, number, number, number];

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

interface Loaded { id: string; plane: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; ao: THREE.Texture; mask: THREE.Texture; far: THREE.BufferGeometry | null; near: THREE.BufferGeometry | null }

export function Ring({ manifest, facade, show }: { manifest: Manifest; facade: THREE.Material; show: boolean }) {
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
    const e = manifest.extent, M = 300;
    const mid = (c: { extent: Box }) => Math.hypot((c.extent[0] + c.extent[1]) / 2, (c.extent[2] + c.extent[3]) / 2);
    (async () => {
      const [ovMap, ovMask] = await Promise.all([texture(manifest.overview.file, true), texture(manifest.overview.mask, false)]);
      ovMaskTex = ovMask;
      ov = groundMaterial({ map: ovMap, mask: ovMask }, time);
      if (dead) return;
      setOverview(ov);
      for (const c of [...manifest.chunks].sort((a, b) => mid(a) - mid(b))) {
        const [json, map, ao, mask] = await Promise.all([
          fetch(DIR + c.buildings).then((r) => r.json() as Promise<ChunkJson>), texture(c.ground, true), texture(c.ao, false), texture(c.mask, false)]);
        if (dead) return;
        // only buildings by the corridor cast shadows (the shadow box follows the corridor camera): one mesh each
        const part = (near: boolean) => {
          const bs: number[][] = [], roofs: number[] = [];
          json.buildings.forEach((b, i) => { if ((b[2] > e[0] - M && b[2] < e[1] + M && b[3] > e[2] - M && b[3] < e[3] + M) === near) { bs.push(b); roofs.push(json.roof[i]); } });
          return bs.length ? buildingsGeometry(bs, { roofs }) : null;
        };
        made.push({ id: c.id, plane: plane(c.extent, 0), mat: groundMaterial({ map, ao, mask }, time), ao, mask, far: part(false), near: part(true) });
        setChunks([...made]);
        document.documentElement.dataset.sceneV2 = `${made.length}/${manifest.chunks.length}`;     // read by the UI tests
        await new Promise((r) => setTimeout(r, 0));                                                 // let a frame through
      }
    })().catch(() => { /* a missing chunk leaves the overview in place */ });
    return () => {
      dead = true;
      ov?.map?.dispose(); ov?.dispose(); ovMaskTex?.dispose();
      for (const c of made) { c.plane.dispose(); c.mat.map?.dispose(); c.mat.dispose(); c.ao.dispose(); c.mask.dispose(); c.far?.dispose(); c.near?.dispose(); }
    };
  }, [manifest, time]);
  useEffect(() => () => { base.wide.dispose(); base.far.dispose(); base.sea.dispose(); base.seaTex.dispose(); }, [base]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-4} material={base.far}>
        <planeGeometry args={[120000, 120000]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -3.8, 34500]} material={base.sea}>
        <planeGeometry args={[120000, 60000]} />
      </mesh>
      {overview && <mesh geometry={base.wide} material={overview} />}
      {chunks.map((c) => (
        <group key={c.id}>
          <mesh geometry={c.plane} material={c.mat} receiveShadow />
          {c.far && <mesh geometry={c.far} material={facade} visible={show} receiveShadow />}
          {c.near && <mesh geometry={c.near} material={facade} visible={show} castShadow receiveShadow />}
        </group>
      ))}
    </group>
  );
}

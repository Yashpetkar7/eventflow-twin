"use client";
// The Dubai Fountain on the Burj Khalifa lake (decision #127): jets along a 275 m bow and three rings, animated in
// the scene instead of a still model. It plays all day (lower by day, full height with lit mist after dark, when the
// real shows run). The choreography is a pattern of ours, not a recording of a show; no figure is read from it.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTwin } from "@/lib/store";
import type { FountainSite } from "./models";
import { live } from "./sceneData";

const ARC = 40, RINGS = 3, PER_RING = 10, SHOOTERS = 3;
const N = ARC + RINGS * PER_RING + SHOOTERS;
const BEAT = 9;                                      // seconds per pattern

interface Jet { x: number; z: number; u: number; kind: 0 | 1 | 2; ring: number }

function layout(site: FountainSite): Jet[] {
  const ux = Math.cos(site.axis_rad), uz = Math.sin(site.axis_rad), nx = -uz, nz = ux, out: Jet[] = [];
  for (let i = 0; i < ARC; i++) {
    const t = i / (ARC - 1) - 0.5, along = t * site.length_m, bow = 20 * (1 - (2 * t) ** 2);
    out.push({ x: site.x + ux * along + nx * bow, z: site.z + uz * along + nz * bow, u: i / (ARC - 1), kind: 0, ring: 0 });
  }
  for (let r = 0; r < RINGS; r++) {
    const t = (r - 1) * 0.3, along = t * site.length_m, bow = 20 * (1 - (2 * t) ** 2) - 34;      // rings inside the bow
    for (let k = 0; k < PER_RING; k++) {
      const a = (k * 2 * Math.PI) / PER_RING;
      out.push({ x: site.x + ux * along + nx * bow + Math.cos(a) * 13, z: site.z + uz * along + nz * bow + Math.sin(a) * 13, u: k / PER_RING, kind: 1, ring: r });
    }
  }
  for (let k = 0; k < SHOOTERS; k++) {
    const along = (k - 1) * 46;
    out.push({ x: site.x + ux * along + nx * 4, z: site.z + uz * along + nz * 4, u: k / SHOOTERS, kind: 2, ring: 0 });
  }
  return out;
}

/** Height (m) and sideways lean (rad) of one jet at time t, for one of the four patterns. */
function pattern(p: number, j: Jet, t: number): [number, number] {
  const f = (t % BEAT) / BEAT;
  if (j.kind === 2) return [p === 3 ? 118 * Math.max(0, Math.sin(Math.PI * f)) ** 3 : p === 1 && j.ring === 0 ? 60 * Math.max(0, Math.sin(Math.PI * (f * 2 - j.u))) ** 4 : 0, 0];
  if (j.kind === 1) return [p === 2 ? 10 + 22 * Math.abs(Math.sin(t * 1.1 + j.ring * 1.3)) : 14 + 12 * Math.sin(t * 1.3 + j.ring * 2.1 + j.u * (p === 0 ? 6.28 : 0)), 0];
  switch (p) {
    case 0: return [22 + 20 * Math.sin(2 * Math.PI * (2 * j.u - t * 0.25)), 0.22 * Math.sin(t * 0.8 + j.u * 6)];          // a wave running along the bow
    case 1: return [16 + 28 * Math.abs(Math.sin(t * 0.9 + (Math.round(j.u * (ARC - 1)) % 2) * Math.PI * 0.5)), 0];        // neighbours take turns
    case 2: return [12 + 40 * Math.exp(-((j.u - (0.5 + 0.5 * Math.sin(t * 0.6))) ** 2) / 0.02), 0.3 * Math.sin(t * 1.2 + j.u * 9)];   // a crest sweeping back and forth
    default: return [10 + 46 * (0.5 - 0.5 * Math.cos(2 * Math.PI * f)) * (0.62 + 0.38 * Math.sin(6 * Math.PI * j.u)), 0];  // everything rises together
  }
}

export function Fountain({ site }: { site: FountainSite }) {
  const visible = useTwin((s) => s.layers.landmarks);
  const core = useRef<THREE.InstancedMesh>(null), mist = useRef<THREE.InstancedMesh>(null);
  const jets = useMemo(() => layout(site), [site]);
  const built = useMemo(() => {
    const coreG = new THREE.CylinderGeometry(0.22, 0.8, 1, 6, 1, true).translate(0, 0.5, 0);
    const mistG = new THREE.CylinderGeometry(1.7, 1.1, 1, 8, 1, true).translate(0, 0.5, 0);      // spray a little wider towards the top
    return {
      coreG, mistG,
      core: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      mist: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    };
  }, []);
  useEffect(() => () => { built.coreG.dispose(); built.mistG.dispose(); built.core.dispose(); built.mist.dispose(); }, [built]);
  useEffect(() => { document.documentElement.dataset.fountainJets = String(N); }, []);          // read by the UI tests
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  const lean = useMemo(() => new THREE.Vector3(Math.cos(site.axis_rad), 0, Math.sin(site.axis_rad)), [site]);     // jets swing across the bow

  useFrame(() => {
    const a = core.current, b = mist.current;
    if (!a || !b || !visible) return;
    const still = useTwin.getState().reducedMotion, t = still ? 4 : live.animT, n = live.night;
    const p0 = Math.floor(t / BEAT) % 4, p1 = (p0 + 1) % 4, f = (t % BEAT) / BEAT;
    const k = f < 0.84 ? 0 : (f - 0.84) / 0.16, mix = k * k * (3 - 2 * k);                       // glide into the next pattern
    const scale = 0.72 + 0.28 * n;                                                               // lower by day, full height in the evening
    for (let i = 0; i < N; i++) {
      const j = jets[i], [h0, l0] = pattern(p0, j, t), [h1, l1] = pattern(p1, j, t);
      const h = Math.max(0.01, (h0 + (h1 - h0) * mix) * scale), l = l0 + (l1 - l0) * mix;
      tmp.q.setFromAxisAngle(lean, l);
      tmp.p.set(j.x, 0.4, j.z);
      const w = j.kind === 2 ? 1.9 : 1;
      a.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s.set(w, h, w)));
      b.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s.set(w, h * 1.04, w)));
    }
    a.instanceMatrix.needsUpdate = true; b.instanceMatrix.needsUpdate = true;
    // white water in daylight; after dark the jets are lit from below, warm white
    built.core.color.setRGB(1 - 0.02 * n, 1 - 0.06 * n, 1 - 0.16 * n);
    built.mist.color.copy(built.core.color);
    built.core.opacity = 0.82 + 0.13 * n; built.mist.opacity = 0.16 + 0.16 * n;
  });
  return (
    <group visible={visible} onClick={(e) => { e.stopPropagation(); useTwin.getState().focusLandmark("fountain"); }}>
      <instancedMesh ref={core} args={[built.coreG, built.core, N]} frustumCulled={false} renderOrder={5} />
      <instancedMesh ref={mist} args={[built.mistG, built.mist, N]} frustumCulled={false} renderOrder={6} />
    </group>
  );
}

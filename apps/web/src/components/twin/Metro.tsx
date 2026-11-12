"use client";
// Red Line: elevated viaduct on piers, the six corridor stations (gold oyster-shell roofs, glass footbridges,
// entrance pods) and instanced trains whose spacing follows the simulated trains-per-hour.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Station } from "@/lib/api";
import { project } from "@/lib/geo";
import { hourOf, useTwin } from "@/lib/store";
import { pathSamples, sweep } from "./builders";
import { roadWidth, type Corridor } from "./City";
import { ModelMesh, withAo, type Models } from "./models";
import { live, type SceneJson } from "./sceneData";

export const RAIL_Y = 12.2;
export interface StationPlace { id: string; x: number; z: number; s: number; angle: number; tx: number; tz: number; zMin: number; zMax: number }

export function placeStations(data: SceneJson, corridor: Corridor, stations: Station[]): StationPlace[] {
  const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
  return stations.map((st) => {
    const [px, pz] = project(data.meta.frame, st.lat, st.lon);      // real coordinates from GET /stations
    const { s } = corridor.metro.nearest(px, pz);                   // snapped onto the viaduct centreline
    corridor.metro.at(s, tmp);
    const { x, z, tx, tz } = tmp;
    // how far the footbridge must reach to clear both Sheikh Zayed Road carriageways (lateral axis = (−tz, tx))
    let zMin = -24, zMax = 24;
    for (const c of corridor.szr) {
      const n = c.path.nearest(x, z);
      const i = Math.min(c.path.n - 1, Math.round(n.s / c.path.step));
      const off = (c.path.x[i] - x) * -tz + (c.path.z[i] - z) * tx, hw = roadWidth(c.lanes[i]) / 2;
      if (n.d < 260) { zMin = Math.min(zMin, off - hw - 16); zMax = Math.max(zMax, off + hw + 16); }
    }
    return { id: st.id, x, z, s, angle: Math.atan2(-tz, tx), tx, tz, zMin, zMax };
  });
}

/** Elongated shell: pinched at both ends, arched across — the Dubai Metro "oyster" silhouette. */
function shellGeometry(L: number, W: number, H: number, segU = 44, segV = 16) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = i / segU, taper = Math.pow(Math.sin(Math.PI * u), 0.5);
    const ridge = 1 + 0.1 * Math.sin(Math.PI * u * 2 - 0.6);            // gentle asymmetry along the spine
    for (let j = 0; j <= segV; j++) {
      const th = (Math.PI * j) / segV;
      pos.push((u - 0.5) * L, Math.sin(th) * H * (0.12 + 0.88 * taper) * ridge, Math.cos(th) * (W / 2) * (0.1 + 0.9 * taper));
      uv.push(u, j / segV);
    }
  }
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = i * (segV + 1) + j, b = a + segV + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ribbed panels across the shell (bump only — the roof stays one soft gold surface). */
function ribTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 8;
  const g = c.getContext("2d")!;
  g.fillStyle = "#808080"; g.fillRect(0, 0, 256, 8);
  for (let x = 0; x < 256; x += 8) { g.fillStyle = "#b8b8b8"; g.fillRect(x + 1, 0, 5, 8); g.fillStyle = "#3c3c3c"; g.fillRect(x + 7, 0, 1, 8); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 1);
  return t;
}

export function Metro({ corridor, places, models = null }: { corridor: Corridor; places: StationPlace[]; models?: Models | null }) {
  const select = useTwin((s) => s.select);
  const built = useMemo(() => {
    const samples = pathSamples(corridor.metro, 12, 0);
    const deck = sweep(samples, [[-4.9, RAIL_Y + 0.9], [-4.9, RAIL_Y - 0.5], [-2.5, RAIL_Y - 2.3], [2.5, RAIL_Y - 2.3], [4.9, RAIL_Y - 0.5], [4.9, RAIL_Y + 0.9], [4.45, RAIL_Y + 0.9], [4.45, RAIL_Y], [-4.45, RAIL_Y], [-4.45, RAIL_Y + 0.9]]);
    const stripe = sweep(samples, [[-4.96, RAIL_Y - 0.25], [-4.96, RAIL_Y + 0.45], [-4.92, RAIL_Y + 0.45], [-4.92, RAIL_Y - 0.25]]);
    const stripe2 = sweep(samples, [[4.96, RAIL_Y - 0.25], [4.96, RAIL_Y + 0.45], [4.92, RAIL_Y + 0.45], [4.92, RAIL_Y - 0.25]]);
    const piers: THREE.Matrix4[] = [];
    const tmp = { x: 0, z: 0, tx: 0, tz: 0 }, m = new THREE.Matrix4();
    for (let s = 14; s < corridor.metro.length; s += 31) {
      corridor.metro.at(s, tmp);
      piers.push(m.clone().makeTranslation(tmp.x, (RAIL_Y - 2.3) / 2, tmp.z));
    }
    return {
      deck, stripe, stripe2, piers,
      pier: new THREE.CylinderGeometry(1.15, 1.35, RAIL_Y - 2.3, 10),
      shell: shellGeometry(134, 30, 16.5), pod: shellGeometry(30, 15, 8.5, 20, 10),
      platform: new THREE.BoxGeometry(128, 2.4, 20), concourse: new THREE.BoxGeometry(92, 4.6, 17),
      box: new THREE.BoxGeometry(1, 1, 1), hit: new THREE.BoxGeometry(150, 600, 150),
    };
  }, [corridor]);
  const ribs = useMemo(() => ribTexture(), []);
  const mats = useMemo(() => ({
    conc: new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.72 }),
    red: new THREE.MeshStandardMaterial({ color: 0xd90f0f, emissive: 0x7a0000, roughness: 0.5 }),
    // champagne-gold shell: metallic with a soft clear-coat sheen, picks up the sky of the hour
    shell: new THREE.MeshPhysicalMaterial({ color: 0xd8b56e, metalness: 0.82, roughness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.28, envMapIntensity: 1.25, bumpMap: ribs, bumpScale: 0.6, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fc3d8, metalness: 0.35, roughness: 0.12, transparent: true, opacity: 0.62, emissive: 0xffe2b0, emissiveIntensity: 0 }),
    hit: new THREE.MeshBasicMaterial({ visible: false }),
  }), [ribs]);
  useEffect(() => () => {
    Object.values(built).forEach((v) => v instanceof THREE.BufferGeometry && v.dispose());
    Object.values(mats).forEach((m) => m.dispose());
    ribs.dispose();
  }, [built, mats, ribs]);
  // Blender-built station (docs/13 R4): the same materials, reading the baked ambient occlusion
  const vmats = useMemo(() => (models ? { shell: withAo(mats.shell), concrete: withAo(mats.conc), glass: withAo(mats.glass), steel: withAo(mats.conc) } : null), [mats, models]);
  useEffect(() => () => { if (vmats) Object.values(vmats).forEach((m) => m.dispose()); }, [vmats]);
  useFrame(() => {
    mats.glass.emissiveIntensity = live.night * 0.9; mats.red.emissiveIntensity = 1 + live.night * 1.5;
    if (vmats) vmats.glass.emissiveIntensity = mats.glass.emissiveIntensity;
  });

  const pick = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;                       // a drag, not a tap
    e.stopPropagation();
    select(id, { tab: true });
  };

  return (
    <group>
      <mesh geometry={built.deck} material={mats.conc} castShadow receiveShadow />
      <mesh geometry={built.stripe} material={mats.red} />
      <mesh geometry={built.stripe2} material={mats.red} />
      <instancedMesh args={[built.pier, mats.conc, built.piers.length]} castShadow
        ref={(im) => { if (im) { built.piers.forEach((mm, i) => im.setMatrixAt(i, mm)); im.instanceMatrix.needsUpdate = true; } }} />
      {places.map((p) => {
        const span = p.zMax - p.zMin, mid = (p.zMax + p.zMin) / 2;
        return (
          <group key={p.id} position={[p.x, 0, p.z]} rotation-y={p.angle}>
            {models && vmats ? <ModelMesh model={models.metro_station} mats={vmats} /> : (
              <>
                <mesh geometry={built.platform} material={mats.conc} position-y={RAIL_Y - 0.9} castShadow receiveShadow />
                <mesh geometry={built.concourse} material={mats.glass} position-y={6.3} />
                <mesh geometry={built.shell} material={mats.shell} position-y={RAIL_Y - 1.2} castShadow />
              </>
            )}
            {/* glass footbridge across Sheikh Zayed Road with an entrance pod and lift tower at each end */}
            <mesh geometry={built.box} material={mats.glass} position={[0, 7.4, mid]} scale={[5.5, 3.4, span]} />
            <mesh geometry={built.box} material={mats.conc} position={[0, 5.5, mid]} scale={[6, 0.5, span]} castShadow />
            {[p.zMin, p.zMax].map((zz, k) => (
              <group key={k} position={[0, 0, zz]}>
                <mesh geometry={built.box} material={mats.conc} position-y={4.6} scale={[9, 9.2, 9]} castShadow />
                <mesh geometry={built.pod} material={mats.shell} position-y={8.6} rotation-y={Math.PI / 2} castShadow />
              </group>
            ))}
            <mesh geometry={built.hit} material={mats.hit} position-y={300} onClick={pick(p.id)} />
          </group>
        );
      })}
    </group>
  );
}

const CAR_L = 17.2, CAR_GAP = 0.45, CARS = 5, MAX_TRAINS = 14, TRAIN_SPEED = 30;

/** Trains: spacing = headway × running speed, taken from the simulator's trains-per-hour at the selected station. */
export function Trains({ corridor, models = null }: { corridor: Corridor; models?: Models | null }) {
  const visible = useTwin((s) => s.layers.trains);
  const refs = { body: useRef<THREE.InstancedMesh>(null), win: useRef<THREE.InstancedMesh>(null), red: useRef<THREE.InstancedMesh>(null) };
  // realism scene: one Blender-built car (body with roof units and bogies, window band, red stripe), instanced five per train
  const car = models?.metro_car.full;
  const geo = useMemo(() => (car ? { body: mergeGeometries([car.body, car.steel])!, win: car.win, red: car.red } : {
    body: new THREE.BoxGeometry(CAR_L, 3.5, 2.8), win: new THREE.BoxGeometry(CAR_L - 0.5, 1.05, 2.86), red: new THREE.BoxGeometry(CAR_L, 0.34, 2.88),
  }), [car]);
  const mats = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, metalness: 0.4, roughness: 0.3, vertexColors: !!car }),
    win: new THREE.MeshStandardMaterial({ color: 0x1d2a3a, metalness: 0.6, roughness: 0.2, emissive: 0xfff0cf, emissiveIntensity: 0, vertexColors: !!car }),
    red: new THREE.MeshStandardMaterial({ color: 0xd90f0f, roughness: 0.5, vertexColors: !!car }),
  }), [car]);
  const offWin = car ? 0 : 0.55, offRed = car ? 0 : -1.5;              // the model's parts share one origin
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); }, [geo, mats]);
  const st = useRef({ phase: 0, spacing: 2400 });
  const N = MAX_TRAINS * 2 * CARS;
  const tmpv = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), sc: new THREE.Vector3(1, 1, 1), p: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0), tmp: { x: 0, z: 0, tx: 0, tz: 0 }, zero: new THREE.Matrix4().makeScale(0, 0, 0) }), []);

  useFrame((_, dtRaw) => {
    const body = refs.body.current, win = refs.win.current, red = refs.red.current;
    if (!body || !win || !red || !visible) return;
    const dt = Math.min(0.05, dtRaw);
    const s = useTwin.getState();
    const tph = s.cur?.by[s.selected]?.tph[hourOf(s.time)] ?? 0;
    const L = corridor.metro.length;
    // one train every (60 / tph) minutes at ~12 m/s line speed → metres between trains
    const target = tph > 0 ? Math.max(520, Math.min(L, (3600 / tph) * 12)) : L * 4;
    st.current.spacing += (target - st.current.spacing) * Math.min(1, dt * 2);
    st.current.phase = (st.current.phase + dt * TRAIN_SPEED) % 1e7;
    mats.win.emissiveIntensity = live.night * 3.2;               // glowing carriage windows after dark
    body.castShadow = live.movingShadows;
    const { m, q, sc, p, up, tmp, zero } = tmpv;
    let k = 0;
    for (const dir of [1, -1]) {
      const count = tph > 0 ? Math.min(MAX_TRAINS, Math.ceil(L / st.current.spacing)) : 0;
      for (let i = 0; i < MAX_TRAINS; i++) {
        for (let c = 0; c < CARS; c++, k++) {
          if (i >= count) { body.setMatrixAt(k, zero); win.setMatrixAt(k, zero); red.setMatrixAt(k, zero); continue; }
          let d = ((st.current.phase * dir + i * st.current.spacing) % L + L) % L;
          d += (c - (CARS - 1) / 2) * (CAR_L + CAR_GAP);
          if (d < 4 || d > L - 4) { body.setMatrixAt(k, zero); win.setMatrixAt(k, zero); red.setMatrixAt(k, zero); continue; }
          corridor.metro.at(d, tmp);
          const lat = dir * 2.25;
          q.setFromAxisAngle(up, Math.atan2(-tmp.tz, tmp.tx));
          p.set(tmp.x - tmp.tz * lat, RAIL_Y + 2.0, tmp.z + tmp.tx * lat);
          body.setMatrixAt(k, m.compose(p, q, sc));
          p.y += offWin; win.setMatrixAt(k, m.compose(p, q, sc));
          p.y += offRed; red.setMatrixAt(k, m.compose(p, q, sc));
        }
      }
    }
    body.instanceMatrix.needsUpdate = win.instanceMatrix.needsUpdate = red.instanceMatrix.needsUpdate = true;
  });

  return (
    <group visible={visible}>
      <instancedMesh ref={refs.body} args={[geo.body, mats.body, N]} castShadow frustumCulled={false} />
      <instancedMesh ref={refs.win} args={[geo.win, mats.win, N]} frustumCulled={false} />
      <instancedMesh ref={refs.red} args={[geo.red, mats.red, N]} frustumCulled={false} />
    </group>
  );
}

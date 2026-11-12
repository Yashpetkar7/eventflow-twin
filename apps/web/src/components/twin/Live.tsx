"use client";
// Everything driven by the simulation each frame: station crowd columns, the venue beacon, crowd-flow
// particles and (illustrative) road traffic. Values are read straight from the store — no React re-render.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { project } from "@/lib/geo";
import { hourOf, lfAt, useTwin } from "@/lib/store";
import { canvasTexture } from "./builders";
import { LANE, roadWidth, SHOULDER, type Corridor } from "./City";
import type { StationPlace } from "./Metro";
import type { Models } from "./models";
import { live, mulberry, type SceneJson } from "./sceneData";

const OK = new THREE.Color(0x0e9f6e), WARN = new THREE.Color(0xe39a00), RISK = new THREE.Color(0xc1123f);
const COL_BASE = 31, CAP_H = 110, COL_R = 13;      // column sits on the station roof; CAP_H = 100 % load

/** Column size grows with the camera's working distance so the data stays the most visible thing in every view.
 *  One scale for all columns: in low views the far ones shrink with perspective instead of looming on the skyline. */
const columnScale = (dist: number) => Math.max(1, Math.min(6.2, dist / 950));

export function Columns({ places }: { places: StationPlace[] }) {
  const groups = useRef<Record<string, THREE.Group>>({});
  const pulses = useRef<Record<string, THREE.Mesh>>({});
  const heights = useRef<Record<string, number>>({});
  const geo = useMemo(() => ({
    glass: new THREE.CylinderGeometry(COL_R + 3.5, COL_R + 3.5, 1, 36, 1, true).translate(0, 0.5, 0),
    ring: new THREE.TorusGeometry(COL_R + 4.4, 1.25, 10, 56).rotateX(Math.PI / 2),
    cap: new THREE.TorusGeometry(COL_R, 0.7, 8, 48).rotateX(Math.PI / 2),
    foot: new THREE.CylinderGeometry(COL_R + 6, COL_R + 6, 1.2, 40).translate(0, 0.6, 0),
    bar: new THREE.CylinderGeometry(COL_R, COL_R, 1, 36).translate(0, 0.5, 0),
    pulse: new THREE.RingGeometry(COL_R + 9, COL_R + 14, 56).rotateX(-Math.PI / 2),
  }), []);
  const mats = useMemo(() => places.map(() => ({
    glass: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, side: THREE.BackSide, depthWrite: false, fog: false }),
    ring: new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
    cap: new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.9 }),
    foot: new THREE.MeshBasicMaterial({ color: 0x151b28, fog: false, transparent: true, opacity: 0.55 }),
    bar: new THREE.MeshStandardMaterial({ color: 0x0e9f6e, roughness: 0.45, metalness: 0.0, fog: false, envMapIntensity: 0.15 }),
    pulse: new THREE.MeshBasicMaterial({ color: 0xb0124f, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  })), [places]);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); mats.forEach((m) => Object.values(m).forEach((x) => x.dispose())); }, [geo, mats]);

  const col = useMemo(() => new THREE.Color(), []);
  useFrame(({ camera }, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    const s = useTwin.getState();
    const thr = s.cur?.thr ?? s.threshold;
    places.forEach((p, i) => {
      const g = groups.current[p.id], pulse = pulses.current[p.id];
      if (!g || !pulse) return;
      const [glass, ring, bar, cap] = g.children;
      const lf = lfAt(s.cur, p.id, s.time), over = lf > thr;
      const k = columnScale(live.camDist);
      const target = Math.max(0.02, Math.min(1.7, lf)) * CAP_H;
      const cur = (heights.current[p.id] ?? 0) + (target - (heights.current[p.id] ?? 0)) * Math.min(1, dt * 6);
      heights.current[p.id] = cur;
      const thrH = thr * CAP_H;
      g.scale.setScalar(k);
      glass.scale.y = thrH; ring.position.y = thrH; bar.scale.y = cur; cap.position.y = cur;
      col.copy(over ? RISK : lf > thr * 0.72 ? WARN : OK);
      const m = mats[i];
      m.bar.color.copy(col);
      const beat = s.reducedMotion ? 0.45 : 0.35 + 0.25 * Math.sin(live.animT * 6);
      // self-lit so the colour reads the same at noon, golden hour and night
      m.bar.emissive.copy(col).multiplyScalar(over ? beat + 0.25 : 0.42 + live.night * 0.3 + live.golden * 0.12);
      // the capacity glass fades out when the camera passes right beside a column (fly-through), the bar stays
      const near = Math.max(0, Math.min(1, (camera.position.distanceTo(g.position) - 140) / 320));
      m.glass.opacity = (0.3 - 0.14 * live.night) * near;
      m.ring.color.setHex(over ? 0xffd9e2 : 0xffffff);
      const ph = s.reducedMotion ? 0.35 : (live.animT * 0.8) % 1;
      m.pulse.opacity = over ? 0.55 * (1 - ph) : 0;
      pulse.scale.setScalar(over ? k * (1 + ph * 1.6) : k);
      live.columnTop[p.id] = COL_BASE + (Math.max(cur, thrH) + 16) * k;
    });
  });

  return (
    <group>
      {places.map((p, i) => (
        <group key={p.id}>
          <group position={[p.x, COL_BASE, p.z]} ref={(g) => { if (g) groups.current[p.id] = g; }}>
            <mesh geometry={geo.glass} material={mats[i].glass} renderOrder={3} />
            <mesh geometry={geo.ring} material={mats[i].ring} />
            <mesh geometry={geo.bar} material={mats[i].bar} castShadow />
            <mesh geometry={geo.cap} material={mats[i].cap} />
            <mesh geometry={geo.foot} material={mats[i].foot} />
          </group>
          <mesh geometry={geo.pulse} material={mats[i].pulse} position={[p.x, 1.6, p.z]} renderOrder={4}
            ref={(m) => { if (m) pulses.current[p.id] = m; }} />
        </group>
      ))}
    </group>
  );
}

export function VenueBeacon({ data }: { data: SceneJson }) {
  const g = useRef<THREE.Group>(null), ring = useRef<THREE.Mesh>(null);
  const mats = useMemo(() => ({
    beam: new THREE.MeshBasicMaterial({ color: 0x2f5bff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    ring: new THREE.MeshBasicMaterial({ color: 0x2f5bff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  }), []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useFrame(() => {
    const s = useTwin.getState(), ev = s.forecast?.event;
    if (!g.current || !ring.current) return;
    g.current.visible = live.venueOn = !!ev;
    if (!ev) return;
    const [x, z] = project(data.meta.frame, ev.lat, ev.lon);
    live.venue.set(x, 0, z);
    g.current.position.set(x, 0, z);
    const k = columnScale(live.camDist);
    g.current.scale.set(k, 1, k);
    const ph = s.reducedMotion ? 0.3 : (live.animT * 0.6) % 1;
    ring.current.scale.setScalar(1 + ph * 2.2);
    mats.ring.opacity = 0.7 * (1 - ph);
  });
  return (
    <group ref={g}>
      <mesh material={mats.beam} position-y={480} renderOrder={3}><cylinderGeometry args={[5, 5, 960, 24, 1, true]} /></mesh>
      <mesh ref={ring} material={mats.ring} rotation-x={-Math.PI / 2} position-y={2} renderOrder={4}><ringGeometry args={[16, 21, 48]} /></mesh>
    </group>
  );
}

const P_MAX = 2600;
/** Crowd flows: venue → stations during the exit surge, stations → venue on arrival. Rates = the forecast's
 *  event entries / exits for the current hour (decorative density, not a count). */
export function Crowd({ places }: { places: StationPlace[] }) {
  const visible = useTwin((s) => s.layers.flows && !s.reducedMotion && s.tier < 2);
  const pts = useRef<THREE.Points>(null);
  const pos = useMemo(() => new Float32Array(P_MAX * 3).fill(-999), []);
  const parts = useMemo(() => Array.from({ length: P_MAX }, () => ({ live: false, t: 0, dur: 1, ax: 0, az: 0, bx: 0, bz: 0, wob: 0 })), []);
  const dot = useMemo(() => canvasTexture(32, 32, (c) => { c.fillStyle = "#fff"; c.beginPath(); c.arc(16, 16, 13, 0, Math.PI * 2); c.fill(); }), []);
  const mat = useMemo(() => new THREE.PointsMaterial({ color: 0x1530a8, size: 8, sizeAttenuation: true, map: dot, alphaTest: 0.5, transparent: true, opacity: 0.95, depthWrite: false }), [dot]);
  useEffect(() => () => { mat.dispose(); dot.dispose(); }, [mat, dot]);
  const acc = useRef<Record<string, number>>({});
  const free = useRef(0);

  useFrame((_, dtRaw) => {
    if (!pts.current || !visible) return;
    const dt = Math.min(0.05, dtRaw), s = useTwin.getState(), h = hourOf(s.time);
    mat.size = Math.max(4, Math.min(26, live.camDist * 0.0042));
    mat.color.setHex(live.night > 0.5 ? 0x9fc0ff : 0x1530a8);
    if (live.venueOn) {
      const vx = live.venue.x, vz = live.venue.z;
      for (const p of places) {
        const f = s.flows[p.id];
        if (!f) continue;
        const side = (vx - p.x) * -p.tz + (vz - p.z) * p.tx > 0 ? p.zMax : p.zMin;   // the entrance on the venue's side
        const ex = p.x - p.tz * side, ez = p.z + p.tx * side;
        for (const [key, rate, ax, az, bx, bz] of [[`${p.id}o`, f.out[h], vx, vz, ex, ez], [`${p.id}i`, f.in[h], ex, ez, vx, vz]] as const) {
          let n = (acc.current[key] ?? 0) + (rate / 700) * dt * 6 * (s.tier === 0 ? 1 : 0.45);
          while (n >= 1) {
            n -= 1;
            let tries = 0;
            while (parts[free.current].live && tries++ < 40) free.current = (free.current + 1) % P_MAX;
            const q = parts[free.current];
            if (q.live) break;
            const jit = Math.max(14, Math.hypot(bx - ax, bz - az) * 0.035);
            q.live = true; q.t = 0; q.dur = 3.2 + Math.random() * 2; q.wob = Math.random() * 6;
            q.ax = ax + (Math.random() - 0.5) * jit * 2; q.az = az + (Math.random() - 0.5) * jit * 2;
            q.bx = bx + (Math.random() - 0.5) * jit; q.bz = bz + (Math.random() - 0.5) * jit * 0.5;
          }
          acc.current[key] = n;
        }
      }
    }
    for (let i = 0; i < P_MAX; i++) {
      const q = parts[i];
      if (q.live) { q.t += dt / q.dur; if (q.t >= 1) q.live = false; }
      if (q.live) {
        const f = q.t, sw = Math.sin(f * 8 + q.wob) * 5;
        pos[i * 3] = q.ax + (q.bx - q.ax) * f + sw; pos[i * 3 + 1] = 3 + Math.sin(f * Math.PI) * 10; pos[i * 3 + 2] = q.az + (q.bz - q.az) * f + sw * 0.6;
      } else pos[i * 3 + 1] = -999;
    }
    pts.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pts} material={mat} visible={visible} frustumCulled={false} renderOrder={5}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
    </points>
  );
}

const CARS = 1500, CAR_COLORS = [0xffffff, 0xd9dde3, 0x1f2329, 0xc9c3b6, 0x8a1f1f, 0x2b4a7a, 0xe8d9a8, 0xf2f2f2, 0x9aa0a8];
/** Road traffic on Sheikh Zayed Road. ILLUSTRATIVE ONLY: density follows a fixed daily profile plus the event
 *  surge so the scene feels alive; it is not simulated and no number is derived from it. */
const BUS_EVERY = 40, TAXI_ROOFS = [0xc8102e, 0x1f5fbf, 0x1f8a4c, 0xf2b01e, 0xd9538f, 0xe8731a];      // roof colours of Dubai's taxi fleets; no logos
export function Traffic({ corridor, models = null }: { corridor: Corridor; models?: Models | null }) {
  const visible = useTwin((s) => s.layers.traffic);
  const mesh = useRef<THREE.InstancedMesh>(null), lights = useRef<THREE.Points>(null);
  // realism scene (docs/13 R5): Blender car and bus, cream taxis with a coloured roof, red tail lights at night
  const roofs = useRef<THREE.InstancedMesh>(null), glass = useRef<THREE.InstancedMesh>(null), busBody = useRef<THREE.InstancedMesh>(null), busGlass = useRef<THREE.InstancedMesh>(null), tails = useRef<THREE.Points>(null);
  const car = models?.car.full, bus = models?.bus.full, BUSES = Math.ceil(CARS / BUS_EVERY);
  const xmats = useMemo(() => ({
    paint: new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5, vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.25, metalness: 0.6, vertexColors: true }),
    bus: new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.5, metalness: 0.3, vertexColors: true }),
    tail: new THREE.PointsMaterial({ color: 0xff2a1a, size: 4, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  }), []);
  const tpos = useMemo(() => new Float32Array(CARS * 3).fill(-999), []);
  useEffect(() => () => { Object.values(xmats).forEach((m) => m.dispose()); }, [xmats]);
  const cars = useMemo(() => {
    const rnd = mulberry(7);
    return Array.from({ length: CARS }, (_, i) => {
      const c = i % Math.max(1, corridor.szr.length);
      return { c, s: rnd() * (corridor.szr[c]?.path.length ?? 1), lane: Math.floor(rnd() * 7), v: 0.8 + rnd() * 0.5 };
    });
  }, [corridor]);
  const geo = useMemo(() => car?.body ?? new THREE.BoxGeometry(4.5, 1.5, 1.9).translate(0, 0.75, 0), [car]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5, vertexColors: !!car }), [car]);
  const lpos = useMemo(() => new Float32Array(CARS * 3).fill(-999), []);
  const lmat = useMemo(() => new THREE.PointsMaterial({ color: 0xfff1cc, size: 5, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); lmat.dispose(); }, [geo, mat, lmat]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const col = new THREE.Color();
    for (let i = 0; i < CARS; i++) {
      const taxi = !!car && i % 8 === 3;                                  // one car in eight is a taxi: cream body, coloured roof
      m.setColorAt(i, col.setHex(taxi ? 0xf1e7c9 : CAR_COLORS[i % CAR_COLORS.length]));
      roofs.current?.setColorAt(i, col.setHex(taxi ? TAXI_ROOFS[(i >> 3) % TAXI_ROOFS.length] : CAR_COLORS[i % CAR_COLORS.length]));
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (roofs.current?.instanceColor) roofs.current.instanceColor.needsUpdate = true;
  }, [car, geo]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0), s: { x: 0, z: 0, tx: 0, tz: 0 }, zero: new THREE.Matrix4().makeScale(0, 0, 0) }), []);

  useFrame((_, dtRaw) => {
    const m = mesh.current;
    if (!m || !visible || !corridor.szr.length) return;
    const dt = Math.min(0.05, dtRaw), st = useTwin.getState(), h = st.time;
    const g = (c: number, w: number) => Math.exp(-0.5 * ((h - c) / w) ** 2);
    let ev = 0;
    for (const id in st.flows) ev += st.flows[id].out[hourOf(h)];
    const press = Math.min(2.2, 0.35 + (g(8, 1.2) + g(18, 1.6) + 0.35 * g(13, 3)) * 0.8 + ev / 9000);
    const nVis = Math.round(CARS * Math.min(1, 0.25 + press * 0.42) * (st.tier === 0 ? 1 : st.tier === 1 ? 0.6 : 0.35)), vel = 26 / (1 + press * 0.9);
    const { m: mm, q, p, one, up, s, zero } = tmp;
    const night = live.night > 0.3;
    for (let i = 0; i < CARS; i++) {
      const c = cars[i], ch = corridor.szr[c.c];
      const isBus = !!bus && st.tier === 0 && i % BUS_EVERY === 0, bi = i / BUS_EVERY;
      if (bus && i % BUS_EVERY === 0 && (!isBus || i >= nVis)) { busBody.current?.setMatrixAt(bi, zero); busGlass.current?.setMatrixAt(bi, zero); }
      if (i >= nVis) { m.setMatrixAt(i, zero); roofs.current?.setMatrixAt(i, zero); glass.current?.setMatrixAt(i, zero); lpos[i * 3 + 1] = -999; tpos[i * 3 + 1] = -999; continue; }
      c.s += vel * c.v * dt;
      if (c.s > ch.path.length - 2) c.s -= ch.path.length - 4;
      ch.path.at(c.s, s);
      const lanes = Math.max(1, Math.round(ch.lanes[Math.min(ch.path.n - 1, Math.round(c.s / ch.path.step))]));
      const across = SHOULDER + (Math.min(c.lane, lanes - 1) + 0.5) * LANE, off = roadWidth(lanes) / 2 - across;
      p.set(s.x + s.tz * off, car ? 0.64 : 0.7, s.z - s.tx * off);
      q.setFromAxisAngle(up, Math.atan2(-s.tz, s.tx));
      mm.compose(p, q, one);
      if (isBus) { busBody.current?.setMatrixAt(bi, mm); busGlass.current?.setMatrixAt(bi, mm); m.setMatrixAt(i, zero); roofs.current?.setMatrixAt(i, zero); glass.current?.setMatrixAt(i, zero); }
      else { m.setMatrixAt(i, mm); roofs.current?.setMatrixAt(i, mm); glass.current?.setMatrixAt(i, mm); }
      const front = isBus ? 6.1 : 2.4;
      if (night) {
        lpos[i * 3] = p.x + s.tx * front; lpos[i * 3 + 1] = 1.6; lpos[i * 3 + 2] = p.z + s.tz * front;
        tpos[i * 3] = p.x - s.tx * front; tpos[i * 3 + 1] = st.tier === 0 ? 1.5 : -999; tpos[i * 3 + 2] = p.z - s.tz * front;
      }
    }
    m.instanceMatrix.needsUpdate = true;
    for (const r of [roofs, glass, busBody, busGlass]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
    xmats.tail.opacity = night ? 0.85 : 0; xmats.tail.size = Math.max(3, Math.min(18, live.camDist * 0.0026));
    if (tails.current) { tails.current.visible = night; tails.current.geometry.attributes.position.needsUpdate = true; }
    lmat.opacity = night ? 0.9 : 0;
    lmat.size = Math.max(3.5, Math.min(22, live.camDist * 0.003));
    if (lights.current) { lights.current.visible = night; lights.current.geometry.attributes.position.needsUpdate = true; }
  });

  return (
    <group visible={visible}>
      <instancedMesh ref={mesh} args={[geo, mat, CARS]} castShadow frustumCulled={false} />
      {car && bus && (
        <>
          <instancedMesh ref={roofs} args={[car.roof, xmats.paint, CARS]} frustumCulled={false} />
          <instancedMesh ref={glass} args={[car.win, xmats.glass, CARS]} frustumCulled={false} />
          <instancedMesh ref={busBody} args={[bus.body, xmats.bus, BUSES]} castShadow frustumCulled={false} />
          <instancedMesh ref={busGlass} args={[bus.win, xmats.glass, BUSES]} frustumCulled={false} />
          <points ref={tails} material={xmats.tail} frustumCulled={false}>
            <bufferGeometry><bufferAttribute attach="attributes-position" args={[tpos, 3]} /></bufferGeometry>
          </points>
        </>
      )}
      <points ref={lights} material={lmat} frustumCulled={false}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[lpos, 3]} /></bufferGeometry>
      </points>
    </group>
  );
}

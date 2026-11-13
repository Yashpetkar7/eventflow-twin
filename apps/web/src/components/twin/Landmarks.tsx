"use client";
// Stylised landmarks at their real OpenStreetMap positions, low-poly and merged per landmark:
//   Burj Khalifa        Y-plan, 27 spiral setbacks, pinnacle + spire to 828 m, glass that mirrors the sky
//   Emirates Towers     equilateral-triangle plan, sloped crowns, spires (355 m office, 309 m hotel)
//   Museum of the Future  torus on a green mound with an abstract calligraphy-like pattern (no real text)
//   DWTC tower          honeycomb façade grid
//   Dubai Frame         gold picture frame
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useTwin } from "@/lib/store";
import { canvasTexture } from "./builders";
import { curtainWall } from "./facade";
import { ModelMesh, withAo, type Models } from "./models";
import { live, mulberry, type SceneJson } from "./sceneData";

function burjGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const STEPS = 27, H_TIERS = 585, stepH = H_TIERS / STEPS;
  // hexagonal core, tapering towards the top tier
  for (let i = 0; i < 9; i++) {
    const y0 = (i * H_TIERS) / 9, y1 = ((i + 1) * H_TIERS) / 9, r0 = 24 - i * 2.05, r1 = 24 - (i + 1) * 2.05;
    parts.push(new THREE.CylinderGeometry(r1, r0, y1 - y0, 6).translate(0, (y0 + y1) / 2, 0));
  }
  // three wings 120° apart; wing w steps back at setbacks w, w+3, w+6 … which makes the upward spiral
  for (let w = 0; w < 3; w++) {
    const ang = (w * 2 * Math.PI) / 3;
    let prevTop = 0;
    for (let k = 0; k < 9; k++) {
      const top = Math.min(H_TIERS, (w + 1 + k * 3) * stepH);
      const len = 66 * Math.pow(1 - k / 9.6, 1.1) + 7, wid = 31 - k * 2.5;
      const h = top - prevTop;
      if (h <= 0) continue;
      const box = new THREE.BoxGeometry(len, h, wid).translate(len / 2 + 6, prevTop + h / 2, 0);
      const tip = new THREE.CylinderGeometry(wid / 2, wid / 2, h, 12, 1, false, -Math.PI / 2, Math.PI).rotateY(Math.PI / 2).translate(len + 6, prevTop + h / 2, 0);
      parts.push(box.rotateY(ang), tip.rotateY(ang));
      prevTop = top;
    }
  }
  // pinnacle tiers and the spire
  parts.push(new THREE.CylinderGeometry(5.2, 8.4, 70, 8).translate(0, H_TIERS + 35, 0));
  parts.push(new THREE.CylinderGeometry(2.6, 5.2, 70, 8).translate(0, H_TIERS + 105, 0));
  parts.push(new THREE.CylinderGeometry(0.5, 2.6, 103, 8).translate(0, H_TIERS + 140 + 51.5, 0));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** Triangular shaft with a crown that slopes up to one corner, and a spire from that corner. */
function emiratesTower(side: number, h: number): THREE.BufferGeometry {
  const r = side / Math.sqrt(3), shaftTop = h * 0.74, crownTop = h * 0.9;
  const corner = (i: number, k = 1) => [Math.cos((i * 2 * Math.PI) / 3) * r * k, Math.sin((i * 2 * Math.PI) / 3) * r * k] as const;
  const base = [0, 1, 2].map((i) => corner(i));
  // crown: corner 0 rises to crownTop while the opposite edge stays at shaftTop → the sloped, faceted top
  const topY = [crownTop, shaftTop + (crownTop - shaftTop) * 0.18, shaftTop + (crownTop - shaftTop) * 0.18];
  const top = [corner(0, 0.5), corner(1, 0.86), corner(2, 0.86)];
  const mid = base.map(([x, z]) => [x, z] as const);
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const b0 = [base[i][0], 0, base[i][1]], b1 = [base[j][0], 0, base[j][1]];
    const m0 = [mid[i][0], shaftTop, mid[i][1]], m1 = [mid[j][0], shaftTop, mid[j][1]];
    const t0 = [top[i][0], topY[i], top[i][1]], t1 = [top[j][0], topY[j], top[j][1]];
    tri(b0, m1, b1); tri(b0, m0, m1);            // shaft wall
    tri(m0, t1, m1); tri(m0, t0, t1);            // crown wall
  }
  tri([top[0][0], topY[0], top[0][1]], [top[2][0], topY[2], top[2][1]], [top[1][0], topY[1], top[1][1]]);   // sloped roof
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  body.computeVertexNormals();
  body.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  const spire = new THREE.CylinderGeometry(0.45, 1.9, h - crownTop + 6, 6).translate(top[0][0], crownTop - 6 + (h - crownTop + 6) / 2, top[0][1]).toNonIndexed();
  const g = mergeGeometries([body, spire])!;
  body.dispose(); spire.dispose();
  return g;
}

function frameGeometry(): THREE.BufferGeometry {
  const W = 93, H = 150, T = 9, D = 14;
  return mergeGeometries([
    new THREE.BoxGeometry(T, H, D).translate(-(W - T) / 2, H / 2, 0), new THREE.BoxGeometry(T, H, D).translate((W - T) / 2, H / 2, 0),
    new THREE.BoxGeometry(W, T, D).translate(0, H - T / 2, 0), new THREE.BoxGeometry(W, 6, D + 8).translate(0, 3, 0),
  ])!;
}

/** `models`: the Blender-built landmarks of the realism scene (docs/13 R4); without them the procedural ones are drawn. */
export function Landmarks({ data, models = null }: { data: SceneJson; models?: Models | null }) {
  const visible = useTwin((s) => s.layers.landmarks);
  const lm = data.landmarks;
  const beacon = useRef<THREE.Mesh>(null);
  const built = useMemo(() => {
    const side = (a: number) => Math.sqrt((4 * a) / Math.sqrt(3));
    const vertexAngle = (k: string) => {
      const l = lm[k];
      return l && l.ring.length >= 2 ? Math.atan2(-(l.ring[1] - l.z), l.ring[0] - l.x) : 0;
    };
    // Museum of the Future: long flowing strokes that wrap the ring — reads as calligraphy windows, spells nothing
    const strokes = canvasTexture(1024, 512, (c, w, h) => {
      const rnd = mulberry(3);
      c.fillStyle = "#000"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "#fff"; c.lineCap = "round"; c.lineJoin = "round";
      for (let row = 0; row < 7; row++) {
        let x = -40 + rnd() * 60;
        const y0 = (row + 0.5) * (h / 7);
        while (x < w + 40) {
          c.lineWidth = 5 + rnd() * 9;
          c.beginPath();
          c.moveTo(x, y0 + (rnd() - 0.5) * 22);
          const len = 50 + rnd() * 110;
          c.bezierCurveTo(x + len * 0.3, y0 - 34 - rnd() * 22, x + len * 0.6, y0 + 30 + rnd() * 20, x + len, y0 + (rnd() - 0.5) * 26);
          c.stroke();
          if (rnd() < 0.45) { c.beginPath(); c.arc(x + len * 0.5, y0 - 26 - rnd() * 8, 3 + rnd() * 3, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill(); }
          x += len + 14 + rnd() * 26;
        }
      }
    });
    strokes.wrapS = strokes.wrapT = THREE.RepeatWrapping;
    strokes.repeat.set(3, 1);
    // Trade Centre tower: honeycomb of deep-set windows in a pale concrete lattice
    const honey = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = "#efe8da"; c.fillRect(0, 0, w, h);
      const R = 16, dx = R * 1.5, dy = R * Math.sqrt(3);
      for (let i = -1; i * dx < w + R; i++) for (let j = -1; j * dy < h + R; j++) {
        const cx = i * dx, cy = j * dy + (i % 2 ? dy / 2 : 0);
        c.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; c.lineTo(cx + Math.cos(a) * (R - 4.5), cy + Math.sin(a) * (R - 4.5)); }
        c.closePath();
        c.fillStyle = "#3f5166"; c.fill();
      }
    });
    honey.wrapS = honey.wrapT = THREE.RepeatWrapping;
    honey.repeat.set(4, 12);
    const honeyLit = canvasTexture(256, 256, (c, w, h) => {
      const rnd = mulberry(17);
      c.fillStyle = "#000"; c.fillRect(0, 0, w, h);
      const R = 16, dx = R * 1.5, dy = R * Math.sqrt(3);
      for (let i = -1; i * dx < w + R; i++) for (let j = -1; j * dy < h + R; j++) {
        if (rnd() > 0.45) continue;
        const cx = i * dx, cy = j * dy + (i % 2 ? dy / 2 : 0);
        c.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; c.lineTo(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5)); }
        c.closePath();
        c.fillStyle = "#ffd9a0"; c.fill();
      }
    });
    honeyLit.wrapS = honeyLit.wrapT = THREE.RepeatWrapping;
    honeyLit.repeat.set(4, 12);
    return {
      burj: burjGeometry(),
      et1: lm.et1 ? emiratesTower(side(lm.et1.area), 355) : null,
      et2: lm.et2 ? emiratesTower(side(lm.et2.area), 309) : null,
      a1: vertexAngle("et1"), a2: vertexAngle("et2"),
      torus: new THREE.TorusGeometry(25, 10.5, 32, 96),
      mound: new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      dwtc: new THREE.BoxGeometry(40, 132, 40).translate(0, 66, 0),
      dwtcTop: mergeGeometries([new THREE.BoxGeometry(44, 5, 44).translate(0, 134.5, 0), new THREE.BoxGeometry(24, 12, 24).translate(0, 143, 0), new THREE.CylinderGeometry(0.5, 0.9, 20, 6).translate(0, 159, 0)])!,
      frame: frameGeometry(), beacon: new THREE.SphereGeometry(1, 12, 8), strokes, honey, honeyLit,
    };
  }, [lm]);
  const mats = useMemo(() => ({
    // blue-silver curtain wall: mostly mirror, so it takes the colour of the sky of the hour
    burj: new THREE.MeshStandardMaterial({ color: 0x8ea3ba, metalness: 0.88, roughness: 0.2, envMapIntensity: 1.35, emissive: 0xbcd3f2, emissiveIntensity: 0, flatShading: true }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa7b4, metalness: 0.82, roughness: 0.27, envMapIntensity: 1.25, emissive: 0x9cb6dc, emissiveIntensity: 0, flatShading: true, side: THREE.DoubleSide }),
    mof: new THREE.MeshPhysicalMaterial({ color: 0xe6e8ea, metalness: 0.72, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.9,
      emissiveMap: built.strokes, emissive: 0xffe6bd, emissiveIntensity: 0, bumpMap: built.strokes, bumpScale: -1.1 }),
    mound: new THREE.MeshStandardMaterial({ color: 0x5f9248, roughness: 0.92 }),
    dwtc: new THREE.MeshStandardMaterial({ map: built.honey, bumpMap: built.honey, bumpScale: 1.2, emissiveMap: built.honeyLit, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.62 }),
    crown: new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.9, roughness: 0.26, envMapIntensity: 1.3, emissive: 0xffc35a, emissiveIntensity: 0 }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, fog: false }),
  }), [built]);
  // the same materials for the Blender models, reading the baked ambient occlusion from the vertex colours
  // glass is less of a mirror than the procedural tower's: seen from above, a full mirror only shows the sand
  const wallU = useMemo(() => ({ uNight: { value: 0 }, uTime: { value: 0 } }), []);
  const vmats = useMemo(() => {
    if (!models) return null;
    const glass = () => Object.assign(withAo(mats.burj), { metalness: 0.55, roughness: 0.22, color: new THREE.Color(0xa9c0d6), flatShading: false });
    return { glass: curtainWall(glass(), wallU, { lit: 0.26 }),                       // Emirates Towers and the other glass slots
      burjGlass: curtainWall(glass(), wallU, { bay: 1.3, storey: 3.6, lit: 0.16, show: true }),   // the Burj Khalifa, with its light show after dark
      steel: withAo(mats.steel), concrete: withAo(mats.crown), gold: withAo(mats.gold),
      green: withAo(mats.mound), mof: withAo(mats.mof), dwtc: withAo(mats.dwtc) };
  }, [mats, models, wallU]);
  const burjMats = useMemo(() => (vmats ? { ...vmats, glass: vmats.burjGlass } : null), [vmats]);
  useEffect(() => () => {
    Object.values(built).forEach((v) => (v instanceof THREE.BufferGeometry || v instanceof THREE.Texture) && v.dispose());
    Object.values(mats).forEach((m) => m.dispose());
  }, [built, mats]);
  useEffect(() => () => { if (vmats) Object.values(vmats).forEach((m) => m.dispose()); }, [vmats]);
  useFrame(() => {
    const n = live.night;
    mats.burj.emissiveIntensity = n * 0.3; mats.steel.emissiveIntensity = n * 0.22;      // façade lighting after dark
    mats.mof.emissiveIntensity = n * 1.6; mats.gold.emissiveIntensity = n * 0.5; mats.dwtc.emissiveIntensity = n * 1.1;
    mats.beacon.opacity = n * (0.55 + 0.45 * Math.sin(live.animT * 2.4));                // aviation light on the spire
    beacon.current?.scale.setScalar(Math.max(2.2, Math.min(9, live.camDist / 700)));
    wallU.uNight.value = n; wallU.uTime.value = live.animT;
    if (vmats) {
      vmats.glass.emissiveIntensity = mats.burj.emissiveIntensity * 0.4; vmats.burjGlass.emissiveIntensity = mats.burj.emissiveIntensity * 0.4;
      vmats.steel.emissiveIntensity = mats.steel.emissiveIntensity;
      vmats.mof.emissiveIntensity = mats.mof.emissiveIntensity; vmats.gold.emissiveIntensity = mats.gold.emissiveIntensity; vmats.dwtc.emissiveIntensity = mats.dwtc.emissiveIntensity;
    }
  });
  const side = (a: number) => Math.sqrt((4 * a) / Math.sqrt(3));
  // A tap on a landmark frames it and starts the slow turn round it (the same as tapping its name).
  const tap = (key: string) => ({ onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); useTwin.getState().focusLandmark(key); } });

  if (models && vmats && burjMats) {
    const m = models, et = (k: "et1" | "et2", name: "emirates_office_tower" | "emirates_hotel_tower", modelSide: number, angle: number) => {
      const l = lm[k];
      if (!l) return null;
      const s = side(l.area) / modelSide;                              // the model's footprint scaled to the real one
      return <group position={[l.x, 0, l.z]} rotation-y={angle} scale={[s, 1, s]} {...tap("et")}><ModelMesh model={m[name]} mats={vmats} /></group>;
    };
    return (
      <group visible={visible}>
        {lm.burj && (
          <group position={[lm.burj.x, 0, lm.burj.z]} rotation-y={-lm.burj.angle} {...tap("burj")}>
            <ModelMesh model={m.burj_khalifa} mats={burjMats} />
            <mesh ref={beacon} geometry={built.beacon} material={mats.beacon} position-y={830} />
          </group>
        )}
        {et("et1", "emirates_office_tower", 54, built.a1)}
        {et("et2", "emirates_hotel_tower", 48, built.a2)}
        {lm.mof && <group position={[lm.mof.x, 0, lm.mof.z]} rotation-y={-lm.mof.angle} {...tap("mof")}><ModelMesh model={m.museum_of_the_future} mats={vmats} /></group>}
        {lm.dwtc && <group position={[lm.dwtc.x, 0, lm.dwtc.z]} rotation-y={-lm.dwtc.angle} {...tap("dwtc")}><ModelMesh model={m.trade_centre_tower} mats={vmats} /></group>}
        {lm.frame && <group position={[lm.frame.x, 0, lm.frame.z]} rotation-y={-lm.frame.angle} {...tap("frame")}><ModelMesh model={m.dubai_frame} mats={vmats} /></group>}
      </group>
    );
  }

  return (
    <group visible={visible}>
      {lm.burj && (
        <group position={[lm.burj.x, 0, lm.burj.z]} rotation-y={-lm.burj.angle}>
          <mesh geometry={built.burj} material={mats.burj} castShadow />
          <mesh ref={beacon} geometry={built.beacon} material={mats.beacon} position-y={830} />
        </group>
      )}
      {lm.et1 && built.et1 && <mesh geometry={built.et1} material={mats.steel} position={[lm.et1.x, 0, lm.et1.z]} rotation-y={built.a1} castShadow />}
      {lm.et2 && built.et2 && <mesh geometry={built.et2} material={mats.steel} position={[lm.et2.x, 0, lm.et2.z]} rotation-y={built.a2} castShadow />}
      {lm.mof && (
        <group position={[lm.mof.x, 0, lm.mof.z]} rotation-y={-lm.mof.angle}>
          <mesh geometry={built.mound} material={mats.mound} scale={[58, 15, 46]} receiveShadow />
          <mesh geometry={built.torus} material={mats.mof} position-y={15 + 38} scale={[1.18, 1.4, 0.86]} castShadow />
        </group>
      )}
      {lm.dwtc && (
        <group position={[lm.dwtc.x, 0, lm.dwtc.z]} rotation-y={-lm.dwtc.angle}>
          <mesh geometry={built.dwtc} material={mats.dwtc} castShadow />
          <mesh geometry={built.dwtcTop} material={mats.crown} castShadow />
        </group>
      )}
      {lm.frame && <mesh geometry={built.frame} material={mats.gold} position={[lm.frame.x, 0, lm.frame.z]} rotation-y={-lm.frame.angle} castShadow />}
    </group>
  );
}

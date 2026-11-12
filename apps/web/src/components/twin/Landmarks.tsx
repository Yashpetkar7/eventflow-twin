"use client";
// Stylised landmarks at their real OpenStreetMap positions: Burj Khalifa (Y-plan with spiral setbacks),
// Emirates Towers (triangular twins), Museum of the Future (torus on a green mound), the Dubai World Trade
// Centre tower and the Dubai Frame. Low-poly, merged per landmark.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useTwin } from "@/lib/store";
import { canvasTexture } from "./builders";
import { live, mulberry, type SceneJson } from "./sceneData";

function burjGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const STEPS = 27, H_TIERS = 600, stepH = H_TIERS / STEPS;
  // central hexagonal core, tapering
  for (let i = 0; i < 6; i++) {
    const y0 = (i * H_TIERS) / 6, y1 = ((i + 1) * H_TIERS) / 6, r0 = 21 - i * 2.6, r1 = 21 - (i + 1) * 2.6;
    parts.push(new THREE.CylinderGeometry(r1, r0, y1 - y0, 6).translate(0, (y0 + y1) / 2, 0));
  }
  // three wings; wing w steps back at setbacks w, w+3, w+6 … (the spiral)
  for (let w = 0; w < 3; w++) {
    const ang = (w * 2 * Math.PI) / 3;
    let prevTop = 0;
    for (let k = 0; k < 9; k++) {
      const top = Math.min(H_TIERS, (w + 1 + k * 3) * stepH);
      const len = 62 * Math.pow(1 - k / 9.4, 1.15) + 6, wid = 25 - k * 1.9;
      const h = top - prevTop;
      if (h <= 0) continue;
      const box = new THREE.BoxGeometry(len, h, wid).translate(len / 2 + 4, prevTop + h / 2, 0);
      const tip = new THREE.CylinderGeometry(wid / 2, wid / 2, h, 10, 1, false, -Math.PI / 2, Math.PI).rotateY(Math.PI / 2).translate(len + 4, prevTop + h / 2, 0);
      parts.push(box.rotateY(ang), tip.rotateY(ang));
      prevTop = top;
    }
  }
  // pinnacle and spire to 828 m
  parts.push(new THREE.CylinderGeometry(3.2, 7.5, 110, 8).translate(0, H_TIERS + 55, 0));
  parts.push(new THREE.CylinderGeometry(0.7, 3.2, 118, 8).translate(0, H_TIERS + 110 + 59, 0));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  parts.forEach((p) => p.dispose());
  return g;
}

function emiratesTower(side: number, h: number): THREE.BufferGeometry {
  const r = side / Math.sqrt(3);
  const shaft = new THREE.CylinderGeometry(r, r, h * 0.82, 3).translate(0, h * 0.41, 0);
  // sloped crown: a triangular wedge that leans to one edge, then the spire
  const crown = new THREE.CylinderGeometry(r * 0.16, r, h * 0.1, 3).translate(0, h * 0.87, 0);
  const pos = crown.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > h * 0.9) pos.setX(i, pos.getX(i) + r * 0.55);
  const spire = new THREE.CylinderGeometry(0.5, 1.6, h * 0.1, 6).translate(r * 0.55, h * 0.95, 0);
  const g = mergeGeometries([shaft, crown, spire].map((p) => p.toNonIndexed()))!;
  g.computeVertexNormals();
  return g;
}

function frameGeometry(): THREE.BufferGeometry {
  const W = 93, H = 150, T = 9, D = 14;
  const parts = [
    new THREE.BoxGeometry(T, H, D).translate(-(W - T) / 2, H / 2, 0), new THREE.BoxGeometry(T, H, D).translate((W - T) / 2, H / 2, 0),
    new THREE.BoxGeometry(W, T, D).translate(0, H - T / 2, 0), new THREE.BoxGeometry(W, 6, D + 8).translate(0, 3, 0),
  ];
  return mergeGeometries(parts)!;
}

export function Landmarks({ data }: { data: SceneJson }) {
  const visible = useTwin((s) => s.layers.landmarks);
  const lm = data.landmarks;
  const built = useMemo(() => {
    const side = (a: number) => Math.sqrt((4 * a) / Math.sqrt(3));
    const vertexAngle = (k: string) => {
      const l = lm[k];
      return l && l.ring.length >= 2 ? Math.atan2(-(l.ring[1] - l.z), l.ring[0] - l.x) : 0;
    };
    // Museum of the Future: flowing strokes hint at the calligraphy windows (abstract — no real text)
    const strokes = canvasTexture(512, 256, (c, w, h) => {
      const rnd = mulberry(3);
      c.fillStyle = "#000"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "#fff"; c.lineCap = "round";
      for (let i = 0; i < 46; i++) {
        c.lineWidth = 2 + rnd() * 5;
        c.beginPath();
        let x = rnd() * w, y = rnd() * h;
        c.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          const nx = x + 30 + rnd() * 70, ny = y + (rnd() - 0.5) * 60;
          c.quadraticCurveTo(x + 20 + rnd() * 20, y + (rnd() - 0.5) * 90, nx, ny);
          x = nx; y = ny;
        }
        c.stroke();
      }
    });
    strokes.wrapS = strokes.wrapT = THREE.RepeatWrapping;
    strokes.repeat.set(3, 2);
    const arches = canvasTexture(128, 256, (c, w, h) => {
      c.fillStyle = "#f4efe6"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#5f6f80";
      for (let y = 6; y < h; y += 16) for (let x = 6; x < w; x += 16) {
        c.beginPath(); c.moveTo(x, y + 12); c.lineTo(x, y + 5); c.quadraticCurveTo(x + 5, y - 3, x + 10, y + 5); c.lineTo(x + 10, y + 12); c.fill();
      }
    });
    arches.wrapS = arches.wrapT = THREE.RepeatWrapping;
    arches.repeat.set(4, 6);
    return {
      burj: burjGeometry(),
      et1: lm.et1 ? emiratesTower(side(lm.et1.area), 355) : null,      // office tower 355 m
      et2: lm.et2 ? emiratesTower(side(lm.et2.area), 309) : null,      // hotel tower 309 m
      a1: vertexAngle("et1"), a2: vertexAngle("et2"),
      torus: new THREE.TorusGeometry(25, 10.5, 28, 72),
      mound: new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      dwtc: new THREE.BoxGeometry(40, 138, 40).translate(0, 69, 0), dwtcTop: new THREE.BoxGeometry(22, 14, 22).translate(0, 145, 0),
      frame: frameGeometry(), strokes, arches,
    };
  }, [lm]);
  const mats = useMemo(() => ({
    metal: new THREE.MeshStandardMaterial({ color: 0x9fb1c4, metalness: 0.55, roughness: 0.32, emissive: 0x9db8d8, emissiveIntensity: 0 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8f9daa, metalness: 0.6, roughness: 0.36, emissive: 0x8fa9c8, emissiveIntensity: 0 }),
    mof: new THREE.MeshStandardMaterial({ color: 0xe2e7ec, metalness: 0.85, roughness: 0.2, emissiveMap: built.strokes, emissive: 0xffe9c4, emissiveIntensity: 0, bumpMap: built.strokes, bumpScale: -1.2 }),
    mound: new THREE.MeshStandardMaterial({ color: 0x6e9b53, roughness: 0.9 }),
    dwtc: new THREE.MeshStandardMaterial({ map: built.arches, roughness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 0.85, roughness: 0.28, emissive: 0xffc860, emissiveIntensity: 0 }),
  }), [built]);
  useEffect(() => () => {
    Object.values(built).forEach((v) => (v instanceof THREE.BufferGeometry || v instanceof THREE.Texture) && v.dispose());
    Object.values(mats).forEach((m) => m.dispose());
  }, [built, mats]);
  useFrame(() => {
    const n = live.night;
    mats.metal.emissiveIntensity = n * 0.22; mats.steel.emissiveIntensity = n * 0.16;
    mats.mof.emissiveIntensity = n * 1.3; mats.gold.emissiveIntensity = n * 0.35;
  });

  return (
    <group visible={visible}>
      {lm.burj && <mesh geometry={built.burj} material={mats.metal} position={[lm.burj.x, 0, lm.burj.z]} rotation-y={-lm.burj.angle} castShadow />}
      {lm.et1 && built.et1 && <mesh geometry={built.et1} material={mats.steel} position={[lm.et1.x, 0, lm.et1.z]} rotation-y={built.a1} castShadow />}
      {lm.et2 && built.et2 && <mesh geometry={built.et2} material={mats.steel} position={[lm.et2.x, 0, lm.et2.z]} rotation-y={built.a2} castShadow />}
      {lm.mof && (
        <group position={[lm.mof.x, 0, lm.mof.z]} rotation-y={-lm.mof.angle}>
          <mesh geometry={built.mound} material={mats.mound} scale={[58, 15, 46]} receiveShadow />
          <mesh geometry={built.torus} material={mats.mof} position-y={15 + 38} scale={[1.18, 1.38, 0.82]} castShadow />
        </group>
      )}
      {lm.dwtc && (
        <group position={[lm.dwtc.x, 0, lm.dwtc.z]} rotation-y={-lm.dwtc.angle}>
          <mesh geometry={built.dwtc} material={mats.dwtc} castShadow />
          <mesh geometry={built.dwtcTop} material={mats.steel} castShadow />
        </group>
      )}
      {lm.frame && <mesh geometry={built.frame} material={mats.gold} position={[lm.frame.x, 0, lm.frame.z]} rotation-y={-lm.frame.angle} castShadow />}
    </group>
  );
}

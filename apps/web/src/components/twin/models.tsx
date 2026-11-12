"use client";
// Blender-built landmark and metro models for the realism scene (docs/13 R4): scripts/blender/build_models.py →
// public/models/*.glb (Draco; the decoder is served from public/draco, so nothing leaves localhost).
// A model is a set of geometries keyed by material slot name (glass, steel, concrete, …); the scene maps those names
// onto its own materials, which already handle sky reflections and night lighting. Each model has a full version
// and a 25 % one, swapped by camera distance. Ambient occlusion is in the vertex colours.
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { live } from "./sceneData";

export const MODEL_NAMES = ["burj_khalifa", "emirates_office_tower", "emirates_hotel_tower", "museum_of_the_future", "trade_centre_tower",
  "dubai_frame", "metro_station", "metro_car", "palm_a", "palm_b", "palm_c", "car", "bus"] as const;          // viaduct_segment.glb is built too; the scene sweeps its viaduct along the real track
export type ModelName = (typeof MODEL_NAMES)[number];
export type Parts = Record<string, THREE.BufferGeometry>;
export interface Model { full: Parts; lod: Parts }
export type Models = Record<ModelName, Model>;
const LOD_AT = 6000;                                               // camera working distance (m) beyond which the 25 % version is drawn

function parts(scene: THREE.Object3D): Parts {
  const by: Record<string, THREE.BufferGeometry[]> = {};
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const slot = (Array.isArray(m.material) ? m.material[0] : m.material).name.replace(/\.\d+$/, "");
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    (by[slot] ??= []).push(g);
  });
  return Object.fromEntries(Object.entries(by).map(([k, gs]) => [k, gs.length > 1 ? mergeGeometries(gs)! : gs[0]]));
}

let cached: Promise<Models | null> | null = null;
/** All models, or null if any file is missing or fails to decode (the scene then keeps its procedural landmarks). */
export function loadModels(): Promise<Models | null> {
  cached ??= (async () => {
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    const loader = new GLTFLoader().setDRACOLoader(draco);
    try {
      const out = {} as Models;
      await Promise.all(MODEL_NAMES.map(async (n) => {
        const [full, lod] = await Promise.all([loader.loadAsync(`/models/${n}.glb`), loader.loadAsync(`/models/${n}_lod1.glb`)]);
        out[n] = { full: parts(full.scene), lod: parts(lod.scene) };
      }));
      document.documentElement.dataset.sceneModels = String(MODEL_NAMES.length);       // read by the UI tests
      return out;
    } catch {
      return null;
    } finally {
      draco.dispose();
    }
  })();
  return cached;
}

/** One model: a mesh per material slot, full detail up close and the 25 % version from far away. */
export function ModelMesh({ model, mats, castShadow = true }: { model: Model; mats: Record<string, THREE.Material>; castShadow?: boolean }) {
  const full = useRef<THREE.Group>(null), lod = useRef<THREE.Group>(null);
  useFrame(() => {
    const far = live.camDist > LOD_AT;
    if (full.current) full.current.visible = !far;
    if (lod.current) lod.current.visible = far;
  });
  const meshes = (p: Parts) => Object.entries(p).map(([slot, g]) => <mesh key={slot} geometry={g} material={mats[slot] ?? mats.concrete} castShadow={castShadow} receiveShadow />);
  return (
    <>
      <group ref={full}>{meshes(model.full)}</group>
      <group ref={lod} visible={false}>{meshes(model.lod)}</group>
    </>
  );
}

/** A copy of a material that reads the model's vertex colours (the baked ambient occlusion). */
export function withAo<T extends THREE.Material>(m: T): T {
  const c = m.clone() as T;
  c.vertexColors = true;
  return c;
}

"use client";
// The WebGL canvas: loaded lazily (behind the static poster) and only when WebGL is available.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { nightFactor } from "@/lib/daylight";
import { useTwin } from "@/lib/store";
import { installHaze } from "./atmosphere";
import { CameraRig } from "./CameraRig";
import { buildCorridor, City } from "./City";
import { LabelProjector } from "./Labels";
import { Landmarks } from "./Landmarks";
import { Columns, Crowd, Traffic, VenueBeacon } from "./Live";
import { Metro, placeStations, Trains } from "./Metro";
import { loadModels, type Models } from "./models";
import { loadManifest, MAX_RECOVERIES, MIN_TIER, STEP_DOWN_FPS, type Manifest } from "@/lib/manifest";
import { landmarkSpots, live, loadScene, type SceneJson } from "./sceneData";
import { Sky } from "./Sky";

declare global { interface Window { __eft?: { fps: number; frames: number; ready: boolean; tier: number; geometries: number; textures: number; programs: number; calls: number; triangles: number; shadow_redraws: number; sun: { elevation: number; azimuth: number } | null } } }

// `?tone=agx` swaps the tone curve of the realism scene for a side-by-side with ACES (docs/13 R2).
const AGX = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tone") === "agx";

/** Frames per second (published for the Playwright tests) and the automatic quality tier:
 *  below 40 fps for 3 s → step down (tier 1: no ambient occlusion, pixel ratio 1, smaller shadow map, fewer cars and
 *  particles; tier 2: no shadows, no particles). 45 s at the display's cap → step back up, at most twice. */
function Stats() {
  const { gl } = useThree();
  const acc = useRef({ t: 0, n: 0, total: 0, low: 0, high: 0, recoveries: 0, warm: 0, shadows: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    // draw calls and triangles of the whole previous frame (shadow pass + scene + post-processing): the renderer's
    // counters are reset here, once a frame, instead of before every pass; shadow_redraws = shadow-map redraws since
    // the last publish, about a second ago
    const calls = gl.info.render.calls, triangles = gl.info.render.triangles;
    gl.info.reset();
    a.t += dt; a.n++; a.total++;
    if (a.t < 1) return;
    const measured = a.n / a.t, s = useTwin.getState(), fps = s.fpsOverride ?? measured;
    live.fps = measured;
    a.t = 0; a.n = 0; a.warm++;
    window.__eft = { fps: measured, frames: a.total, ready: true, tier: s.tier, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0, calls, triangles, shadow_redraws: live.shadowDraws - a.shadows, sun: live.sun };
    a.shadows = live.shadowDraws;
    // a hidden or throttled page reports ~1 fps: that is not a slow GPU, so it never changes the tier
    if (a.warm < 8 || (s.fpsOverride === null && measured < 5)) return;
    a.low = fps < (s.tier === 0 ? STEP_DOWN_FPS : 40) ? a.low + 1 : 0;
    a.high = fps >= 57 ? a.high + 1 : 0;
    if (a.low >= 3 && s.tier < 2) { useTwin.setState({ tier: (s.tier + 1) as 1 | 2 }); a.low = 0; a.high = 0; }
    else if (a.high >= 45 && s.tier > MIN_TIER && a.recoveries < MAX_RECOVERIES) { useTwin.setState({ tier: (s.tier - 1) as 0 | 1 }); a.recoveries++; a.high = 0; }
  });
  return null;
}

function Ready() {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => useTwin.setState({ sceneReady: true })); } });
  return null;
}

function World({ data, manifest, models, tier }: { data: SceneJson; manifest: Manifest | null; models: Models | null; tier: number }) {
  const stations = useTwin((s) => s.stations);
  const corridor = useMemo(() => buildCorridor(data), [data]);
  const places = useMemo(() => placeStations(data, corridor, stations), [data, corridor, stations]);
  const spots = useMemo(() => landmarkSpots(data), [data]);
  // realism scene, full quality: bloom for the night lights only (lit windows are the only thing brighter than 1)
  const glow = useTwin((s) => !!manifest && tier === 0 && nightFactor(s.time) > 0.3);
  return (
    <>
      <Sky frame={data.meta.frame} tier={tier} real={!!manifest} />
      <City data={data} corridor={corridor} manifest={manifest} models={models} />
      <Landmarks data={data} models={models} />
      <Metro corridor={corridor} places={places} models={models} />
      <Trains corridor={corridor} models={models} />
      <Traffic corridor={corridor} models={models} />
      <Columns places={places} />
      <VenueBeacon data={data} />
      <Crowd places={places} />
      <CameraRig places={places} corridor={corridor} spots={spots} />
      <LabelProjector places={places} spots={spots} />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        {/* realism scene: ground contact shadows are baked (R1) and the scene has six times the geometry, so the screen-space pass runs on its cheaper setting */}
        {tier > 0 ? <></> : <N8AO aoRadius={16} distanceFalloff={1.2} intensity={2.4} quality={manifest ? "performance" : "medium"} color="#1a2030" />}
        {glow ? <Bloom mipmapBlur intensity={0.55} luminanceThreshold={1.05} luminanceSmoothing={0.2} /> : <></>}
        <SMAA />
        <ToneMapping mode={manifest && AGX ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
      <Stats />
      <Ready />
    </>
  );
}

export default function TwinCanvas({ label }: { label: string }) {
  const [data, setData] = useState<{ scene: SceneJson; manifest: Manifest | null; models: Models | null } | null>(null);
  const tier = useTwin((s) => s.tier);
  useEffect(() => { Promise.all([loadScene(), loadManifest()]).then(async ([scene, manifest]) => { if (manifest) installHaze(); setData({ scene, manifest, models: manifest ? await loadModels() : null }); }).catch(() => useTwin.setState({ glFailed: true })); }, []);
  if (!data) return null;
  return (
    <Canvas
      flat shadows dpr={tier > 0 ? 1 : [1, 1.5]} aria-label={label} role="img"
      gl={{ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true, stencil: false }}
      camera={{ fov: 38, near: 20, far: 60000, position: [0, 4000, 6000] }}
      onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFShadowMap; gl.toneMappingExposure = 1; gl.info.autoReset = false; }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Suspense fallback={null}>
        <World data={data.scene} manifest={data.manifest} models={data.models} tier={tier} />
      </Suspense>
    </Canvas>
  );
}

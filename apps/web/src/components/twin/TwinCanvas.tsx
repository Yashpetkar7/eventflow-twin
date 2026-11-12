"use client";
// The WebGL canvas: loaded lazily (behind the static poster) and only when WebGL is available.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { useTwin } from "@/lib/store";
import { CameraRig } from "./CameraRig";
import { buildCorridor, City } from "./City";
import { LabelProjector } from "./Labels";
import { Landmarks } from "./Landmarks";
import { Columns, Crowd, Traffic, VenueBeacon } from "./Live";
import { Metro, placeStations, Trains } from "./Metro";
import { landmarkSpots, live, loadScene, type SceneJson } from "./sceneData";
import { Sky } from "./Sky";

declare global { interface Window { __eft?: { fps: number; frames: number; ready: boolean; tier: number; geometries: number; textures: number; programs: number } } }

/** Frames per second (published for the Playwright tests) and the automatic quality tier:
 *  below 40 fps for 3 s → step down (tier 1: no ambient occlusion, pixel ratio 1, smaller shadow map, fewer cars and
 *  particles; tier 2: no shadows, no particles). 45 s at the display's cap → step back up, at most twice. */
function Stats() {
  const { gl } = useThree();
  const acc = useRef({ t: 0, n: 0, total: 0, low: 0, high: 0, recoveries: 0, warm: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt; a.n++; a.total++;
    if (a.t < 1) return;
    const measured = a.n / a.t, s = useTwin.getState(), fps = s.fpsOverride ?? measured;
    live.fps = measured;
    a.t = 0; a.n = 0; a.warm++;
    window.__eft = { fps: measured, frames: a.total, ready: true, tier: s.tier, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 };
    // a hidden or throttled page reports ~1 fps: that is not a slow GPU, so it never changes the tier
    if (a.warm < 8 || (s.fpsOverride === null && measured < 5)) return;
    a.low = fps < 40 ? a.low + 1 : 0;
    a.high = fps >= 57 ? a.high + 1 : 0;
    if (a.low >= 3 && s.tier < 2) { useTwin.setState({ tier: (s.tier + 1) as 1 | 2 }); a.low = 0; a.high = 0; }
    else if (a.high >= 45 && s.tier > 0 && a.recoveries < 2) { useTwin.setState({ tier: (s.tier - 1) as 0 | 1 }); a.recoveries++; a.high = 0; }
  });
  return null;
}

function Ready() {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => useTwin.setState({ sceneReady: true })); } });
  return null;
}

function World({ data, tier }: { data: SceneJson; tier: number }) {
  const stations = useTwin((s) => s.stations);
  const corridor = useMemo(() => buildCorridor(data), [data]);
  const places = useMemo(() => placeStations(data, corridor, stations), [data, corridor, stations]);
  const spots = useMemo(() => landmarkSpots(data), [data]);
  return (
    <>
      <Sky frame={data.meta.frame} tier={tier} />
      <City data={data} corridor={corridor} />
      <Landmarks data={data} />
      <Metro corridor={corridor} places={places} />
      <Trains corridor={corridor} />
      <Traffic corridor={corridor} />
      <Columns places={places} />
      <VenueBeacon data={data} />
      <Crowd places={places} />
      <CameraRig places={places} corridor={corridor} spots={spots} />
      <LabelProjector places={places} spots={spots} />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        {tier > 0 ? <></> : <N8AO aoRadius={16} distanceFalloff={1.2} intensity={2.4} quality="medium" color="#1a2030" />}
        <SMAA />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
      <Stats />
      <Ready />
    </>
  );
}

export default function TwinCanvas({ label }: { label: string }) {
  const [data, setData] = useState<SceneJson | null>(null);
  const tier = useTwin((s) => s.tier);
  useEffect(() => { loadScene().then(setData).catch(() => useTwin.setState({ glFailed: true })); }, []);
  if (!data) return null;
  return (
    <Canvas
      flat shadows dpr={tier > 0 ? 1 : [1, 1.5]} aria-label={label} role="img"
      gl={{ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true, stencil: false }}
      camera={{ fov: 38, near: 20, far: 60000, position: [0, 4000, 6000] }}
      onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFShadowMap; gl.toneMappingExposure = 1; }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Suspense fallback={null}>
        <World data={data} tier={tier} />
      </Suspense>
    </Canvas>
  );
}

"use client";
// The WebGL canvas: loaded lazily (behind the static poster) and only when WebGL is available.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
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
import { live, loadScene, type SceneJson } from "./sceneData";
import { Sky } from "./Sky";

declare global { interface Window { __eft?: { fps: number; frames: number; ready: boolean; calls: number; triangles: number } } }

/** Frames per second, published for the Playwright performance test (docs/metrics.md). */
function Stats() {
  const { gl } = useThree();
  const acc = useRef({ t: 0, n: 0, total: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt; a.n++; a.total++;
    if (a.t >= 1) {
      live.fps = a.n / a.t;
      window.__eft = { fps: live.fps, frames: a.total, ready: true, calls: gl.info.render.calls, triangles: gl.info.render.triangles };
      a.t = 0; a.n = 0;
    }
  });
  return null;
}

function Ready() {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => useTwin.setState({ sceneReady: true })); } });
  return null;
}

function World({ data, low }: { data: SceneJson; low: boolean }) {
  const stations = useTwin((s) => s.stations);
  const corridor = useMemo(() => buildCorridor(data), [data]);
  const places = useMemo(() => placeStations(data, corridor, stations), [data, corridor, stations]);
  return (
    <>
      <Sky frame={data.meta.frame} />
      <City data={data} corridor={corridor} />
      <Landmarks data={data} />
      <Metro corridor={corridor} places={places} />
      <Trains corridor={corridor} />
      <Traffic corridor={corridor} />
      <Columns places={places} />
      <VenueBeacon data={data} />
      <Crowd places={places} />
      <CameraRig places={places} corridor={corridor} />
      <LabelProjector places={places} data={data} />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        {low ? <></> : <N8AO aoRadius={16} distanceFalloff={1.2} intensity={2.4} quality="medium" color="#1a2030" />}
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
  const [low, setLow] = useState(false);
  useEffect(() => { loadScene().then(setData).catch(() => useTwin.setState({ glFailed: true })); }, []);
  if (!data) return null;
  return (
    <Canvas
      flat shadows dpr={low ? 1 : [1, 1.5]} aria-label={label} role="img"
      gl={{ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true, stencil: false }}
      camera={{ fov: 38, near: 20, far: 60000, position: [0, 4000, 6000] }}
      onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFShadowMap; gl.toneMappingExposure = 1; }}
      style={{ position: "absolute", inset: 0 }}
    >
      {/* automatic quality tier: drop ambient occlusion and pixel ratio if the frame rate stays low */}
      <PerformanceMonitor bounds={() => [38, 60]} flipflops={2} onDecline={() => setLow(true)} />
      <Suspense fallback={null}>
        <World data={data} low={low} />
      </Suspense>
    </Canvas>
  );
}

"use client";
// Orbit camera with smooth tweens between presets. Drag = rotate, right-drag / shift-drag / two-finger drag = pan,
// wheel / pinch = zoom. Any manual move leaves the preset ("free").
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useTwin } from "@/lib/store";
import type { Corridor } from "./City";
import type { StationPlace } from "./Metro";
import { camBus, live, type LandmarkSpot } from "./sceneData";

interface Cam { theta: number; phi: number; r: number; tx: number; ty: number; tz: number }
const R_MIN = 140, R_MAX = 12000;

export function CameraRig({ places, corridor, spots }: { places: StationPlace[]; corridor: Corridor; spots: LandmarkSpot[] }) {
  const { camera, gl, size } = useThree();
  const cur = useRef<Cam>({ theta: -0.1, phi: 0.93, r: 7600, tx: 60, ty: 40, tz: -520 });
  const dst = useRef<Cam>({ ...cur.current });
  const fly = useRef(0);

  const overviewR = () => {
    const cam = camera as THREE.PerspectiveCamera;
    const half = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * (size.width / Math.max(1, size.height)));
    return Math.max(4200, Math.min(12000, 3700 / Math.tan(half)));
  };
  const preset = (k: string): Partial<Cam> => {
    const s = useTwin.getState(), p = places.find((x) => x.id === s.selected) ?? places[0];
    switch (k) {
      case "close": return { theta: -0.46, phi: 1.08, r: 620, tx: p?.x ?? 0, ty: 70, tz: p?.z ?? 0 };
      case "landmark": {                                 // the landmark and its neighbourhood, seen from the sea side
        const l = spots.find((x) => x.key === s.focus) ?? spots[0];
        return l ? { theta: -0.38, phi: 1.16, r: l.r, tx: l.x, ty: l.h * 0.42, tz: l.z } : {};
      }
      case "top": return { theta: 0, phi: 0.06, r: overviewR() * 1.02, tx: 60, ty: 0, tz: -300 };
      case "fly": return { phi: 1.34, r: 360, ty: 52 };                                   // low, looking down the corridor to the skyline
      case "orbit": return { phi: 1.2, r: overviewR() * 0.58, tx: 200, ty: 120, tz: -380 };  // flatter: horizon, haze and sky in frame
      default: return { theta: -0.1, phi: 0.93, r: overviewR(), tx: 60, ty: 40, tz: -520 };
    }
  };

  /** Take the short way round after many orbits. */
  const unwind = () => { dst.current.theta += Math.round((cur.current.theta - dst.current.theta) / (2 * Math.PI)) * 2 * Math.PI; };

  // preset changes (camNonce bumps on every request, including re-selecting a station in close-up)
  useEffect(() => useTwin.subscribe((s, prev) => {
    if (s.camNonce !== prev.camNonce && s.cam !== "free") {
      if (s.cam === "fly") fly.current = 0;
      Object.assign(dst.current, preset(s.cam));
      unwind();
    }
  }), [places, spots, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    camBus.zoom = (f) => {
      dst.current.r = Math.min(R_MAX, Math.max(R_MIN, dst.current.r * f));
      if (useTwin.getState().cam !== "free") useTwin.setState({ cam: "free" });
    };
    return () => { camBus.zoom = () => {}; };
  }, []);
  useEffect(() => { Object.assign(dst.current, preset(useTwin.getState().cam)); Object.assign(cur.current, dst.current); }, [places.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = gl.domElement;
    const pts = new Map<number, { x: number; y: number; b: number; sh: boolean }>();
    let pinch = 0, mid: { x: number; y: number } | null = null;
    const free = () => { if (useTwin.getState().cam !== "free") useTwin.setState({ cam: "free" }); };
    const pan = (dx: number, dy: number) => {
      const d = dst.current, k = d.r / 900, c = Math.cos(d.theta), s = Math.sin(d.theta);
      d.tx = Math.max(-4200, Math.min(4500, d.tx + (-dx * c - dy * s) * k));
      d.tz = Math.max(-2600, Math.min(1900, d.tz + (dx * s - dy * c) * k));
    };
    const down = (e: PointerEvent) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); pinch = 0; mid = null; };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) === 0) return;
      const d = dst.current;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], dist = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch) d.r = Math.min(R_MAX, Math.max(R_MIN, (d.r * pinch) / dist));
        if (mid) pan((m.x - mid.x) * 0.6, (m.y - mid.y) * 0.6);
        pinch = dist; mid = m;
      } else if (p.b === 2 || p.sh) pan(dx, dy);
      else { d.theta -= dx * 0.006; d.phi = Math.min(1.45, Math.max(0.05, d.phi - dy * 0.005)); }
      free();
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; mid = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); dst.current.r = Math.min(R_MAX, Math.max(R_MIN, dst.current.r * (1 + Math.sign(e.deltaY) * 0.1))); free(); };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("contextmenu", menu);
    return () => {
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel); el.removeEventListener("contextmenu", menu);
    };
  }, [gl]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw), s = useTwin.getState(), d = dst.current, c = cur.current;
    if (s.cam === "fly") {
      const L = corridor.metro.length;
      fly.current = (fly.current + dt * (s.reducedMotion ? 0 : 80)) % (L - 1500);
      const q = corridor.metro.at(900 + fly.current, { x: 0, z: 0, tx: 0, tz: 0 });
      // fly beside the viaduct, over the sea-side carriageway, so the station columns pass by instead of through the lens
      d.tx = q.x - q.tz * 125; d.tz = q.z + q.tx * 125;
      d.theta = Math.atan2(-q.tx, -q.tz) + 0.2;
      unwind();
    }
    if (s.cam === "orbit" && !s.reducedMotion) d.theta += dt * 0.08;
    if (s.cam === "landmark" && !s.reducedMotion) d.theta += dt * 0.15;       // a full turn round the landmark in about 40 s; any drag takes over
    const f = Math.min(1, dt * 3.2);
    (Object.keys(c) as (keyof Cam)[]).forEach((k) => { c[k] += (d[k] - c[k]) * f; });
    camera.position.set(c.tx + c.r * Math.sin(c.phi) * Math.sin(c.theta), c.ty + c.r * Math.cos(c.phi), c.tz + c.r * Math.sin(c.phi) * Math.cos(c.theta));
    camera.lookAt(c.tx, c.ty, c.tz);
    const cam = camera as THREE.PerspectiveCamera, near = Math.max(4, c.r * 0.012);
    if (Math.abs(cam.near - near) > near * 0.1) { cam.near = near; cam.updateProjectionMatrix(); }
    live.camDist = c.r; live.camTarget.set(c.tx, c.ty, c.tz); live.camTheta = c.theta;
  });
  return null;
}

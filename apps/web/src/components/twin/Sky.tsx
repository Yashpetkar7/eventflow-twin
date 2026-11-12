"use client";
// Time of day: sun path, sky dome (gradient, sun glow, thin cirrus, stars), desert haze, golden hour with long
// shadows, blue hour and a moonlit night. The sky is also rendered into a small cube map whenever the hour
// changes, so glass and metal reflect the sky of the moment (no HDRI file, nothing fetched).
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { compass, type Frame } from "@/lib/geo";
import { nightFactor } from "@/lib/daylight";
import { sunPosition } from "@/lib/sun";
import { useTwin } from "@/lib/store";
import { R7 } from "./perf";
import { live } from "./sceneData";

// Stylised day for the exhibit: golden hour 16:30–18:30, blue hour to ~19:30 (docs/09 #54).
const SUNRISE = 6.3, SUNSET = 18.45;
type Stop = [number, number, number];              // hour, zenith colour, horizon colour
const SKY: Stop[] = [
  [0, 0x050914, 0x121a30], [5.2, 0x0a1124, 0x1d2948], [6.2, 0x47669f, 0xf2c79e], [7.4, 0x3f86d8, 0xbfd9ee],
  [15.6, 0x3f86d8, 0xbfd9ee], [16.6, 0x4a86cf, 0xf1dbb4], [17.6, 0x5a7fc0, 0xf3cc9c], [18.4, 0x4a5f9c, 0xf0a070],
  [18.9, 0x25356b, 0x9a6f86], [19.5, 0x0f1836, 0x2c3a66], [20.3, 0x050914, 0x121a30], [24, 0x050914, 0x121a30],
];
// Realism scene (docs/13 R2): the same sky colours, keyed by the real sun's elevation in degrees instead of the clock.
const SKY_E: Stop[] = [
  [-90, 0x050914, 0x121a30], [-12, 0x050914, 0x121a30], [-7, 0x0f1836, 0x2c3a66], [-3.5, 0x25356b, 0x9a6f86], [-0.5, 0x4a5f9c, 0xf0a070],
  [4, 0x5a7fc0, 0xf3cc9c], [10, 0x4a86cf, 0xf1dbb4], [18, 0x3f86d8, 0xbfd9ee], [90, 0x3f86d8, 0xbfd9ee],
];
const DUST = new THREE.Color(0xd9c8a8);            // desert dust in the daytime haze
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const DOME_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DOME_FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uGlow; uniform float uNight; uniform float uT;
  varying vec3 vDir;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  void main(){
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    vec3 c = mix(uHor, uTop, pow(up, 0.45));
    c = mix(c, uHor * 1.04, exp(-up * 9.0) * 0.55);                       // haze band on the horizon
    float s = max(dot(d, normalize(uSun)), 0.0);
    c += uGlow * (pow(s, 900.0) * 4.0 + pow(s, 40.0) * 0.4 + pow(s, 5.0) * 0.16);
    if (d.y > 0.02) {                                                      // thin cirrus, lit by the sun colour
      vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uT * 0.004, 0.0);
      float cl = smoothstep(0.52, 0.86, fbm(uv * vec2(1.0, 2.4))) * smoothstep(0.02, 0.22, d.y) * 0.5;
      c = mix(c, mix(vec3(1.0), uGlow, 0.45) * (1.0 - 0.82 * uNight), cl);
      vec2 g = floor(d.xz / (d.y + 0.25) * 240.0);                         // stars
      float st = step(0.9972, hash(g)) * (0.6 + 0.4 * sin(uT * 2.0 + hash(g + 3.0) * 40.0));
      c += vec3(0.9, 0.95, 1.0) * st * uNight * (1.0 - cl * 2.0) * smoothstep(0.05, 0.3, d.y);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

/** `real`: sun from the scenario date and the clock (solar declination + equation of time) instead of the stylised day. */
export function Sky({ frame, tier = 0, real = false }: { frame: Frame; tier?: number; real?: boolean }) {
  const { scene, gl } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null), hemi = useRef<THREE.HemisphereLight>(null);
  const uniforms = useMemo(() => ({
    uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) },
    uGlow: { value: new THREE.Color() }, uNight: { value: 0 }, uT: { value: 0 },
  }), []);
  const dome = useMemo(() => new THREE.ShaderMaterial({ uniforms, side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG }), [uniforms]);
  const c = useMemo(() => ({
    a: new THREE.Color(), b: new THREE.Color(), top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(),
    gold: new THREE.Color(0xffbd74), white: new THREE.Color(0xfff0dc), moon: new THREE.Color(0x93aae6),
    fillDay: new THREE.Color(0xdbe9ff), fillGold: new THREE.Color(0x9fb6ee), fillNight: new THREE.Color(0x3a4f86),
    bounceDay: new THREE.Color(0xd2b58a), bounceNight: new THREE.Color(0x1b2233), dir: new THREE.Vector3(),
  }), []);

  // Reflection probe: the sky dome over a sand-coloured floor, re-rendered when the hour moves.
  const probe = useMemo(() => {
    const env = new THREE.Scene();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), dome);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0xcdb48c });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(50, 24).rotateX(-Math.PI / 2), floorMat);
    floor.position.y = -0.5;
    env.add(ball, floor);
    return { env, ball, floor, floorMat, rt: null as THREE.WebGLRenderTarget | null, at: -99, wall: 0 };
  }, [dome]);
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl]);
  const cache = useRef({ dir: new THREE.Vector3(), x: 1e9, z: 1e9, half: 0 });       // what the shadow map was last drawn for

  useEffect(() => {
    scene.fog = new THREE.Fog(0xcfe0ee, 5200, 46000);
    return () => {
      scene.environment = null; scene.fog = null;
      probe.rt?.dispose(); pmrem.dispose(); probe.ball.geometry.dispose(); probe.floor.geometry.dispose(); probe.floorMat.dispose(); dome.dispose();
    };
  }, [scene, pmrem, probe, dome]);

  // quality tier: half-size shadow map at tier 1, no shadows at tier 2
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    const n = tier === 0 ? 4096 : 2048;
    l.castShadow = tier < 2;
    l.shadow.autoUpdate = false;                           // redrawn on demand, see the frame loop
    if (l.shadow.mapSize.x !== n) { l.shadow.mapSize.set(n, n); l.shadow.map?.dispose(); l.shadow.map = null; }
    live.shadowDirty = 2;
  }, [tier]);
  // hiding or showing a layer changes what casts (an effect, so the scene already has the change)
  const layers = useTwin((s) => s.layers);
  useEffect(() => { live.shadowDirty = 2; }, [layers]);

  useFrame((state, dt) => {
    const st = useTwin.getState(), h = st.time;
    const sp = real ? sunPosition(st.events.find((e) => e.id === st.scenario.eventId)?.date ?? "2025-10-13", h) : null;
    const nf = sp ? 1 - smooth(-8, 2, sp.elevation) : nightFactor(h);
    live.night = nf; live.daylight = 1 - nf; live.animT += Math.min(0.05, dt);
    live.sun = sp;
    const stops = sp ? SKY_E : SKY, key = sp ? sp.elevation : h;
    let i = 0;
    while (i < stops.length - 2 && stops[i + 1][0] < key) i++;
    const k = (key - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
    c.top.copy(c.a.setHex(stops[i][1])).lerp(c.b.setHex(stops[i + 1][1]), k);
    c.hor.copy(c.a.setHex(stops[i][2])).lerp(c.b.setHex(stops[i + 1][2]), k);
    uniforms.uTop.value.copy(c.top); uniforms.uHor.value.copy(c.hor); uniforms.uNight.value = nf; uniforms.uT.value = live.animT;

    // sun: rises east-south-east, culminates in the south, sets west-south-west — on the camera's side, so the
    // skyline is front-lit and shadows fall away from the viewer at golden hour
    const day = Math.max(0, Math.min(1, (h - SUNRISE) / (SUNSET - SUNRISE)));
    const up = sp ? sp.elevation > -1.5 : h > SUNRISE - 0.2 && h < SUNSET + 0.25;
    // radians; the moon stands high. The light never drops under 6 degrees so shadows stay finite at sunrise and sunset.
    const elev = !up ? 0.7 : sp ? Math.max(0.11, (sp.elevation * Math.PI) / 180) : Math.max(0.11, Math.sin(Math.PI * day) * 0.85);
    const [dx, dz] = compass(frame, !up ? 205 : sp ? sp.azimuth : 106 + 148 * day);
    c.dir.set(dx * Math.cos(elev), Math.sin(elev), dz * Math.cos(elev));
    uniforms.uSun.value.copy(c.dir);
    const golden = up ? 1 - smooth(0.16, 0.55, elev) : 0;                             // 1 = low sun
    live.golden = golden * (1 - nf);
    c.sun.copy(up ? c.white : c.moon).lerp(up ? c.gold : c.moon, golden);
    uniforms.uGlow.value.copy(c.sun).multiplyScalar(up ? 1 - nf * 0.9 : 0.35);

    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(c.hor).lerp(c.top, 0.12 + 0.22 * golden);
      fog.near = 5200 - 700 * golden; fog.far = 46000 - 9000 * golden - 12000 * nf;     // warm evening haze sits a little closer
      if (real) {                                    // haze chunk (atmosphere.ts): fog.far = visibility, dusty by day, darker at night
        fog.color.lerp(DUST, 0.3 * (1 - nf)).multiplyScalar(1 - 0.35 * nf);
        fog.far = 30000 - 7000 * golden - 9000 * nf;
      }
    }

    if (sun.current) {
      const t = live.camTarget, k = cache.current, want = Math.max(420, Math.min(3200, live.camDist * 0.66));
      const half = Math.abs(k.half - want) > want * 0.04 ? want : k.half;       // the shadow box follows the view in steps of 4 % (crisp close-ups, wide overviews)
      sun.current.color.copy(c.sun);
      sun.current.intensity = up ? (1 - nf) * (2.25 + 1.9 * golden) + 0.25 * nf : 0.55;
      if (real) sun.current.intensity *= 1 + 0.9 * live.golden;      // exposure: a camera opens up when the real sun is low
      sun.current.position.set(t.x + c.dir.x * 7000, c.dir.y * 7000, t.z + c.dir.z * 7000);
      sun.current.target.position.set(t.x, 0, t.z);
      sun.current.target.updateMatrixWorld();
      // The city does not move, so the shadow map is redrawn only when its content would change by about a screen
      // pixel: the sun has turned, the view has moved or zoomed, or a caster has changed (live.shadowDirty). Cars and
      // trains cast only in views where one is wider than ~1.5 px, and there the map is redrawn every frame as before.
      const sh = sun.current.shadow;
      const px = live.camDist * 2 * Math.tan((19 * Math.PI) / 180) / state.size.height;     // metres per pixel at the camera target (fov 38)
      live.movingShadows = !(real && R7.shadow) || px < (live.movingShadows ? 1.7 : 1.5);     // the corridor scene keeps a redraw every frame
      const turned = c.dir.angleTo(k.dir) > Math.max(0.0002, px / 800);                       // an 800 m lever: the tallest shadow tips move ~1 px
      const moved = half !== k.half || Math.hypot(t.x - k.x, t.z - k.z) > half * 0.02;
      if (live.movingShadows || live.shadowDirty > 0 || turned || moved || !sh.map) {
        const cam = sh.camera;
        if (k.half !== half) {
          cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
          cam.updateProjectionMatrix();
        }
        sh.bias = -0.00012 * (half / 600);
        sh.normalBias = 0.6 + half / 900;
        k.dir.copy(c.dir); k.x = t.x; k.z = t.z; k.half = half;
        sh.needsUpdate = true;
        live.shadowDraws++;
        if (live.shadowDirty > 0) live.shadowDirty--;
      }
    }
    if (hemi.current) {
      // cool sky fill against the warm sun = readable shadows at golden hour; blue moonlight ambience at night
      hemi.current.color.copy(c.fillDay).lerp(c.fillGold, golden).lerp(c.fillNight, nf);
      hemi.current.groundColor.copy(c.bounceDay).lerp(c.bounceNight, nf);
      hemi.current.intensity = 0.36 - 0.1 * golden + 0.04 * nf;
      if (real) hemi.current.intensity += 0.55 * live.golden;        // … and the sky does most of the lighting then
    }

    // refresh the reflection probe when the sky has changed enough (at most ~3 times a second)
    const now = state.clock.elapsedTime;
    if (Math.abs(h - probe.at) > 0.2 && now - probe.wall > 0.3) {
      probe.floorMat.color.setHex(0xcdb48c).multiplyScalar(0.12 + 0.88 * (1 - nf));
      const next = pmrem.fromScene(probe.env, 0.03);
      scene.environment = next.texture;
      probe.rt?.dispose();
      probe.rt = next; probe.at = h; probe.wall = now;
    }
    scene.environmentIntensity = 0.42 + 0.1 * golden + 0.3 * nf;
  });

  return (
    <>
      <mesh material={dome} renderOrder={-10} frustumCulled={false}><sphereGeometry args={[42000, 48, 24]} /></mesh>
      <hemisphereLight ref={hemi} args={[0xdbe9ff, 0xd2b58a, 0.6]} />
      <directionalLight ref={sun} castShadow shadow-mapSize={[4096, 4096]} shadow-camera-near={100} shadow-camera-far={16000} />
    </>
  );
}

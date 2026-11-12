"use client";
// Time of day: sun path, sky dome (gradient, sun glow, thin cirrus, stars), desert haze, golden hour with long
// shadows, blue hour and a moonlit night. The sky is also rendered into a small cube map whenever the hour
// changes, so glass and metal reflect the sky of the moment (no HDRI file, nothing fetched).
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { compass, type Frame } from "@/lib/geo";
import { useTwin } from "@/lib/store";
import { live } from "./sceneData";

// Stylised day for the exhibit: golden hour 16:30–18:30, blue hour to ~19:30 (docs/09 #54).
const SUNRISE = 6.3, SUNSET = 18.45;
type Stop = [number, number, number];              // hour, zenith colour, horizon colour
const SKY: Stop[] = [
  [0, 0x050914, 0x121a30], [5.2, 0x0a1124, 0x1d2948], [6.2, 0x47669f, 0xf2c79e], [7.4, 0x3f86d8, 0xbfd9ee],
  [15.6, 0x3f86d8, 0xbfd9ee], [16.6, 0x4a86cf, 0xf1dbb4], [17.6, 0x5a7fc0, 0xf3cc9c], [18.4, 0x4a5f9c, 0xf0a070],
  [18.9, 0x25356b, 0x9a6f86], [19.5, 0x0f1836, 0x2c3a66], [20.3, 0x050914, 0x121a30], [24, 0x050914, 0x121a30],
];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const nightFactor = (h: number) => (h < 12 ? 1 - smooth(5.5, 6.8, h) : smooth(18.3, 19.6, h));

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

export function Sky({ frame }: { frame: Frame }) {
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

  useEffect(() => {
    scene.fog = new THREE.Fog(0xcfe0ee, 5200, 46000);
    return () => {
      scene.environment = null; scene.fog = null;
      probe.rt?.dispose(); pmrem.dispose(); probe.ball.geometry.dispose(); probe.floor.geometry.dispose(); probe.floorMat.dispose(); dome.dispose();
    };
  }, [scene, pmrem, probe, dome]);

  useFrame((state, dt) => {
    const h = useTwin.getState().time, nf = nightFactor(h);
    live.night = nf; live.daylight = 1 - nf; live.animT += Math.min(0.05, dt);
    let i = 0;
    while (i < SKY.length - 2 && SKY[i + 1][0] < h) i++;
    const k = (h - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
    c.top.copy(c.a.setHex(SKY[i][1])).lerp(c.b.setHex(SKY[i + 1][1]), k);
    c.hor.copy(c.a.setHex(SKY[i][2])).lerp(c.b.setHex(SKY[i + 1][2]), k);
    uniforms.uTop.value.copy(c.top); uniforms.uHor.value.copy(c.hor); uniforms.uNight.value = nf; uniforms.uT.value = live.animT;

    // sun: rises east-south-east, culminates in the south, sets west-south-west — on the camera's side, so the
    // skyline is front-lit and shadows fall away from the viewer at golden hour
    const day = Math.max(0, Math.min(1, (h - SUNRISE) / (SUNSET - SUNRISE)));
    const up = h > SUNRISE - 0.2 && h < SUNSET + 0.25;
    const elev = up ? Math.max(0.11, Math.sin(Math.PI * day) * 0.85) : 0.7;           // radians; the moon stands high
    const [dx, dz] = compass(frame, up ? 106 + 148 * day : 205);
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
    }

    if (sun.current) {
      const t = live.camTarget, half = Math.max(420, Math.min(3200, live.camDist * 0.66));
      sun.current.color.copy(c.sun);
      sun.current.intensity = up ? (1 - nf) * (2.25 + 1.9 * golden) + 0.25 * nf : 0.55;
      sun.current.position.set(t.x + c.dir.x * 7000, c.dir.y * 7000, t.z + c.dir.z * 7000);
      sun.current.target.position.set(t.x, 0, t.z);
      sun.current.target.updateMatrixWorld();
      const cam = sun.current.shadow.camera;
      if (Math.abs(cam.right - half) > half * 0.04) {       // the shadow box follows the view (crisp close-ups, wide overviews)
        cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
        cam.updateProjectionMatrix();
      }
      sun.current.shadow.bias = -0.00012 * (half / 600);
      sun.current.shadow.normalBias = 0.6 + half / 900;
    }
    if (hemi.current) {
      // cool sky fill against the warm sun = readable shadows at golden hour; blue moonlight ambience at night
      hemi.current.color.copy(c.fillDay).lerp(c.fillGold, golden).lerp(c.fillNight, nf);
      hemi.current.groundColor.copy(c.bounceDay).lerp(c.bounceNight, nf);
      hemi.current.intensity = 0.36 - 0.1 * golden + 0.04 * nf;
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

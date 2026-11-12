"use client";
// Time of day: sun path for Dubai in November, sky gradient, haze, golden hour, blue hour and night.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { compass, type Frame } from "@/lib/geo";
import { useTwin } from "@/lib/store";
import { live } from "./sceneData";

const SUNRISE = 6.4, SUNSET = 17.6;                // Dubai, mid-November (local time)
type Stop = [number, number, number];              // hour, zenith colour, horizon colour
const SKY: Stop[] = [
  [0, 0x070b18, 0x141c33], [5.2, 0x0b1226, 0x1f2a4a], [6.3, 0x4f6fa8, 0xf0c39a], [7.6, 0x4f8fd6, 0xc4dcee],
  [15.6, 0x4f8fd6, 0xc4dcee], [16.9, 0x5f8fd0, 0xf6cfa0], [17.5, 0x6283bd, 0xf5b383], [18.2, 0x35487c, 0xd98f6e], [19.0, 0x121b3a, 0x33406a],
  [20.2, 0x070b18, 0x141c33], [24, 0x070b18, 0x141c33],
];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const nightFactor = (h: number) => (h < 12 ? 1 - smooth(5.6, 6.9, h) : smooth(17.3, 19.1, h));

export function Sky({ frame }: { frame: Frame }) {
  const { scene, gl } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null), hemi = useRef<THREE.HemisphereLight>(null);
  const uniforms = useMemo(() => ({ uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: new THREE.Color() } }), []);
  const dome = useMemo(() => new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uGlow; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), 0.42);
        vec3 c = mix(uHor, uTop, t);
        float s = max(dot(d, normalize(uSun)), 0.0);
        c += uGlow * (pow(s, 600.0) * 3.0 + pow(s, 24.0) * 0.32 + pow(s, 4.0) * 0.1);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }), [uniforms]);
  const c = useMemo(() => ({ a: new THREE.Color(), b: new THREE.Color(), top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), warm: new THREE.Color(0xffb070), white: new THREE.Color(0xfff3e0), moon: new THREE.Color(0x9fb4e6), dir: new THREE.Vector3() }), []);

  useEffect(() => {
    scene.fog = new THREE.Fog(0xcfe0ee, 5200, 46000);
    // reflections: a small cube map rendered once from a daytime sky gradient (no HDRI download)
    const pm = new THREE.PMREMGenerator(gl);
    const env = new THREE.Scene();
    const m = dome.clone();
    m.uniforms = { uTop: { value: new THREE.Color(0x7fb0e6) }, uHor: { value: new THREE.Color(0xe9eef2) }, uSun: { value: new THREE.Vector3(0.4, 0.7, -0.5) }, uGlow: { value: new THREE.Color(0xfff0d8) } };
    const ball = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), m);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(50, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xcdbf9f }));
    floor.position.y = -1;
    env.add(ball, floor);
    const rt = pm.fromScene(env, 0.02);
    scene.environment = rt.texture;
    return () => { scene.environment = null; scene.fog = null; rt.dispose(); pm.dispose(); ball.geometry.dispose(); floor.geometry.dispose(); m.dispose(); dome.dispose(); };
  }, [scene, gl, dome]);

  useFrame((_, dt) => {
    const h = useTwin.getState().time, nf = nightFactor(h);
    live.night = nf; live.daylight = 1 - nf; live.animT += Math.min(0.05, dt);
    let i = 0;
    while (i < SKY.length - 2 && SKY[i + 1][0] < h) i++;
    const k = (h - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
    c.top.copy(c.a.setHex(SKY[i][1])).lerp(c.b.setHex(SKY[i + 1][1]), k);
    c.hor.copy(c.a.setHex(SKY[i][2])).lerp(c.b.setHex(SKY[i + 1][2]), k);
    uniforms.uTop.value.copy(c.top); uniforms.uHor.value.copy(c.hor);
    (scene.fog as THREE.Fog).color.copy(c.hor);
    // sun: rises east-south-east, culminates in the south (~46° in November), sets west-south-west
    const day = Math.max(0, Math.min(1, (h - SUNRISE) / (SUNSET - SUNRISE)));
    const up = h > SUNRISE - 0.3 && h < SUNSET + 0.3;
    const elev = up ? Math.max(0.17, Math.sin(Math.PI * day) * 0.8) : 0.62;              // radians; moon stands high
    const [dx, dz] = compass(frame, up ? 108 + 144 * day : 200);
    c.dir.set(dx * Math.cos(elev), Math.sin(elev), dz * Math.cos(elev));
    uniforms.uSun.value.copy(c.dir);
    const low = smooth(0.17, 0.55, elev);
    c.sun.copy(up ? c.warm : c.moon).lerp(up ? c.white : c.moon, low);
    uniforms.uGlow.value.copy(c.sun).multiplyScalar(up ? 1 - nf : 0.25);
    if (sun.current) {
      const t = live.camTarget, half = Math.max(420, Math.min(3000, live.camDist * 0.62));
      sun.current.color.copy(c.sun);
      sun.current.intensity = up ? 0.2 + (1 - nf) * (4.4 - 1.5 * low) : 0.3;      // low sun: stronger, warmer, longer shadows
      sun.current.position.set(t.x + c.dir.x * 6000, c.dir.y * 6000, t.z + c.dir.z * 6000);
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
    if (hemi.current) { hemi.current.intensity = 0.16 + 0.5 * (1 - nf); hemi.current.color.copy(c.top).lerp(up ? c.sun : c.white, 0.35 + 0.25 * (1 - low)); }
    scene.environmentIntensity = 0.08 + 0.42 * (1 - nf);
  });

  return (
    <>
      <mesh material={dome} renderOrder={-10} frustumCulled={false}><sphereGeometry args={[42000, 32, 16]} /></mesh>
      <hemisphereLight ref={hemi} args={[0xdfeeff, 0xc9b38a, 0.9]} />
      <ambientLight intensity={0.06} />
      <directionalLight ref={sun} castShadow shadow-mapSize={[4096, 4096]} shadow-camera-near={100} shadow-camera-far={14000} />
    </>
  );
}

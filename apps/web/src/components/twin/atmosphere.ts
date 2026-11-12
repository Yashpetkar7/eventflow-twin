// Atmosphere for the realism scene (?scene=v2, docs/13 R2): one haze function for every material, and the ground /
// water shader that turns the R1 bake (satellite colour, AO, land-cover mask) into sand, parks, asphalt and sea.
import * as THREE from "three";

/** Aerial perspective. three.js compiles `fog_fragment` into every built-in material, so replacing that one chunk puts
 *  the same haze on buildings, ground, roads, metro, landmarks and water alike: density rises with distance
 *  (fog.far = visibility), and the haze brightens and warms towards the sun. Call once, before the canvas mounts. */
export function installHaze() {
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
  #ifdef USE_FOG
    float eftHaze = 1.0 - exp(-1.6 * pow(vFogDepth / fogFar, 1.5));       // ≈ 20 % at 7 km, 60 % at 20 km by day
    vec3 eftHazeCol = fogColor;
    #if defined( STANDARD ) && NUM_DIR_LIGHTS > 0
      float eftToSun = max(dot(normalize(-vViewPosition), directionalLights[0].direction), 0.0);
      eftHazeCol = mix(eftHazeCol, eftHazeCol * 0.6 + directionalLights[0].color * 0.16, pow(eftToSun, 6.0) * 0.6);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, eftHazeCol, eftHaze);
  #endif`;
}

const NOISE = /* glsl */ `
  float eftHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float eftN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(eftHash(i), eftHash(i + vec2(1, 0)), f.x), mix(eftHash(i + vec2(0, 1)), eftHash(i + vec2(1, 1)), f.x), f.y); }`;

// Six wave bands: direction (x, z), wavelength in metres, slope amplitude, speed. Each band fades out before its
// wavelength falls under two pixels, so distant water is smooth instead of shimmering.
const WAVES: [number, number, number, number, number][] = [
  [0.86, 0.5, 190, 0.05, 0.35], [-0.36, 0.93, 95, 0.06, 0.5], [0.97, -0.24, 41, 0.07, 0.8],
  [0.2, 0.98, 17, 0.08, 1.2], [-0.78, 0.62, 7.3, 0.08, 1.9], [0.6, -0.8, 3.1, 0.07, 2.7],
];
const waves = WAVES.map(([dx, dz, len, amp, speed]) => /* glsl */ `
    eftWN += vec2(${dx.toFixed(2)}, ${dz.toFixed(2)}) * cos(dot(vGw.xz, vec2(${dx.toFixed(2)}, ${dz.toFixed(2)})) * ${(6.2832 / len).toFixed(4)} + uTime * ${speed.toFixed(2)})
      * ${amp.toFixed(3)} * (1.0 - smoothstep(${(len * 0.12).toFixed(2)}, ${(len * 0.5).toFixed(2)}, eftPx));`).join("");

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;

export interface GroundTextures { map: THREE.Texture; ao?: THREE.Texture | null; mask?: THREE.Texture | null }

/** Ground of the realism ring. Land: satellite colour × baked AO, with mask-driven close-up detail (sand ripple on
 *  bare ground, mottled grass in parks, grain on built-up land). Water (mask G, or everything when `allWater`):
 *  multi-band wave normals, shallow turquoise near the shore, soft foam; the standard material's Fresnel and specular
 *  then reflect the sky map and the sun. `time` is one shared uniform. */
export function groundMaterial(tex: GroundTextures, time: { value: number }, allWater = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: tex.map, roughness: 0.97, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAo = { value: tex.ao ?? white };
    sh.uniforms.uMask = { value: tex.mask ?? white };
    sh.uniforms.uAllWater = { value: allWater ? 1 : 0 };
    sh.uniforms.uHasMask = { value: tex.mask ? 1 : 0 };
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGw;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGw = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uAo; uniform sampler2D uMask; uniform float uAllWater; uniform float uHasMask; uniform float uTime;
        varying vec3 vGw;
        float eftWater = 0.0; float eftPx = 1.0; vec2 eftWN = vec2(0.0);
        ${NOISE}`)
      .replace("#include <map_fragment>", /* glsl */ `#include <map_fragment>
        {
          vec3 mk = uAllWater > 0.5 ? vec3(0.0, 1.0, 0.0) : texture2D(uMask, vMapUv).rgb * uHasMask;
          // ponytail: blurred water mask (3 mip levels up) stands in for distance to shore; bake a distance field if the band must be exact
          float open = uAllWater > 0.5 ? 1.0 : texture2D(uMask, vMapUv, 3.0).g * uHasMask;
          eftPx = max(fwidth(vGw.x), fwidth(vGw.z));                       // metres per pixel
          float near = 1.0 - smoothstep(0.4, 5.0, eftPx);                  // close-up detail only
          float grain = eftN(vGw.xz * 0.9) * 0.5 + eftN(vGw.xz * 0.23) * 0.5;
          float ripple = sin(vGw.x * 0.55 + vGw.z * 0.21 + eftN(vGw.xz * 0.05) * 6.0) * 0.5 + 0.5;
          float bare = clamp(1.0 - mk.r - mk.g - mk.b, 0.0, 1.0);
          vec3 land = diffuseColor.rgb;
          land *= 1.0 + near * (bare * (0.12 * (ripple - 0.5) + 0.12 * (grain - 0.5)) + mk.r * 0.26 * (grain - 0.55) + mk.b * 0.16 * (grain - 0.6));
          land = mix(land, land * vec3(0.9, 1.03, 0.84), mk.r * near * 0.45);
          land *= texture2D(uAo, vMapUv).r;

          eftWater = smoothstep(0.45, 0.6, mk.g);
          ${waves}
          float deep = smoothstep(0.55, 1.0, open);
          vec3 sea = mix(vec3(0.09, 0.44, 0.45), vec3(0.015, 0.12, 0.19), deep);        // shallow turquoise → deep Gulf
          sea = mix(sea, diffuseColor.rgb, 0.22);                                       // keep the satellite's sandbars
          float foam = (1.0 - smoothstep(0.5, 0.64, open)) * smoothstep(0.4, 0.8, eftN(vGw.xz * 0.11 + uTime * 0.04));
          sea = mix(sea, vec3(0.9), foam * 0.5 * (1.0 - smoothstep(2.0, 14.0, eftPx)));
          diffuseColor.rgb = mix(land, sea, eftWater);
        }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.1 + 0.28 * smoothstep(0.5, 10.0, eftPx), eftWater);   // far water averages its glints`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(eftWN.x, 0.0, eftWN.y, 0.0)).xyz * eftWater);`);
  };
  return m;
}

/** 1 × 1 texture of one colour (the open sea beyond the baked overview). */
export function solidTexture(hex: number): THREE.DataTexture {
  const c = new THREE.Color(hex).convertLinearToSRGB();
  const t = new THREE.DataTexture(new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

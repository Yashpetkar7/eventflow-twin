// Façade shader for the realism scene (docs/13 R3): one material, a different wall per building type.
//   0 tower        glass curtain wall: mullions every 1.6 m, a spandrel band per storey, reflects the sky map
//   1 mid-rise     sand concrete, window bays, balconies on some columns
//   2 villa        cream walls, a few windows
//   3 low-rise     ribbon windows, or a patterned screen on some
//   4 warehouse    blank ribbed walls, loading doors on the ground floor
//   5 mosque, 6 stadium   plain walls, sparse openings
// Storey height and bay width come from the type; the pattern is laid out in metres along the wall and above ground.
// Level of detail per axis from the screen-space size of a cell: single windows → column stripes → the mean tone,
// so nothing shimmers at a distance. Night: lit windows (warm in homes, cool in offices), lit crowns above 200 m.
// R9 (decision #114): interior mapping. Where a window is more than a few pixels wide, the view ray is followed into a
// box behind the glass (back wall, side walls, floor, ceiling), so windows have depth and move with the camera; by
// day the room shows dimly through the glass, at night a lit room is bright at its ceiling and falls off into the
// corners, and some rooms have a blind part-way down. No geometry and no texture: a dozen operations per pixel,
// only on resolved windows. `curtainWall` below gives the landmark models the same treatment from world position.
import * as THREE from "three";

/** `side`: double for buildings by the corridor (the inside of a parapet shows in close-ups), front only for the far ring,
 *  where drawing back faces would double the rasterising of 60,000 buildings for nothing visible. */
export function facadeMaterialV2(uniforms: { uNight: { value: number } }, side: THREE.Side = THREE.DoubleSide): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.04, side });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec3 aInfo;
        varying vec2 vFac; varying float vSeed; varying float vType; varying float vTall;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vFac = uv; vSeed = aInfo.x; vType = aInfo.y; vTall = aInfo.z;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float uNight; varying vec2 vFac; varying float vSeed; varying float vType; varying float vTall;
        float eftHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float eftGlass = 0.0;`)
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        if (vType > -0.5) {
          float t = vType;
          // storey height, bay width (metres) and the window's box inside a cell (x0, x1, y0, y1), per type
          float storey = t < 0.5 ? 3.9 : t < 1.5 ? 3.2 : t < 2.5 ? 3.3 : t < 3.5 ? 4.6 : t < 4.5 ? 6.0 : 4.2;
          float bay = t < 0.5 ? 1.6 : t < 1.5 ? 3.4 : t < 2.5 ? 4.4 : t < 3.5 ? 5.2 : t < 4.5 ? 8.0 : 6.0;
          vec4 box = t < 0.5 ? vec4(0.05, 0.95, 0.24, 1.0) : t < 1.5 ? vec4(0.2, 0.8, 0.3, 0.8) : t < 2.5 ? vec4(0.3, 0.7, 0.3, 0.76)
                   : t < 3.5 ? vec4(0.04, 0.96, 0.36, 0.82) : t < 4.5 ? vec4(0.25, 0.75, 0.0, 0.72) : vec4(0.42, 0.58, 0.25, 0.85);
          float present = t < 0.5 ? 1.0 : t < 1.5 ? 0.92 : t < 2.5 ? 0.5 : t < 3.5 ? 1.0 : t < 4.5 ? 0.45 : 0.4;     // share of cells that have the opening
          storey = vTall / max(1.0, floor(vTall / storey + 0.5));                    // whole storeys over the height
          vec2 g = vec2(vFac.x / bay, vFac.y / storey), id = floor(g), f = fract(g), fw = fwidth(g);
          float cx = 1.0 - smoothstep(0.3, 0.8, fw.x), cy = 1.0 - smoothstep(0.3, 0.8, fw.y), both = cx * cy;
          float h1 = eftHash(id + vSeed * 97.0), h2 = eftHash(id.xx + vSeed * 31.0);
          float px = step(box.x, f.x) * step(f.x, box.y), py = step(box.z, f.y) * step(f.y, box.w);
          float has = mix(present, step(h1, present), both);
          float open = mix(box.y - box.x, px, cx) * mix(box.w - box.z, py, cy) * has;
          float body = step(vFac.y, vTall - 1.3);                                    // the top band is parapet
          if (t > 3.5 && t < 4.5) open *= step(id.y, 0.5);                           // warehouses: doors on the ground floor only
          float crown = t < 0.5 ? step(200.0, vTall) * step(vTall * 0.92, vFac.y) : 0.0;
          open *= body * (1.0 - crown);

          vec3 wallCol = diffuseColor.rgb;
          if (t > 0.5 && t < 1.5) {                                                  // balconies: slab shadow and a light parapet on some columns
            float bal = step(0.45, h2) * both * body;
            wallCol *= 1.0 - 0.38 * bal * (1.0 - step(0.1, f.y));
            wallCol = mix(wallCol, wallCol * 1.12, bal * step(0.1, f.y) * (1.0 - step(0.3, f.y)));
            open *= 1.0 - bal * (1.0 - step(0.3, f.y));
          }
          if (t > 2.5 && t < 3.5 && vSeed > 0.6) {                                   // patterned screen instead of windows
            vec2 q = vFac / 1.3;
            float lat = (1.0 - smoothstep(0.1, 0.16, abs(fract(q.x + q.y) - 0.5))) + (1.0 - smoothstep(0.1, 0.16, abs(fract(q.x - q.y) - 0.5)));
            float cs = 1.0 - smoothstep(0.25, 0.7, max(fwidth(q.x), fwidth(q.y)));
            wallCol *= 1.0 - 0.28 * mix(0.3, clamp(lat, 0.0, 1.0), cs) * body;
            open *= 0.25;
          }
          if (t > 3.5 && t < 4.5) wallCol *= 0.94 + 0.06 * mix(0.5, step(0.5, fract(vFac.x / 0.9)), 1.0 - smoothstep(0.2, 0.6, fwidth(vFac.x / 0.9)));   // ribbed cladding
          wallCol *= 0.97 + 0.06 * mix(0.5, step(0.06, f.y), cy);                    // floor lines
          wallCol *= 0.74 + 0.26 * smoothstep(0.0, 5.0, vFac.y);                     // contact shadow at the base

          vec3 glass = t < 0.5 ? mix(vec3(0.12, 0.24, 0.31), vec3(0.26, 0.45, 0.5), eftHash(id * 1.7 + vSeed))
                               : mix(vec3(0.08, 0.12, 0.17), vec3(0.2, 0.28, 0.36), eftHash(id * 1.7 + vSeed));
          glass = mix(glass, wallCol * 0.5, t > 3.5 && t < 4.5 ? 1.0 : 0.0);         // warehouse doors are dark panels, not glass
          eftGlass = open * (t > 3.5 && t < 4.5 ? 0.0 : 1.0);
          // the room behind the window (interior mapping)
          float roomK = eftGlass * (1.0 - smoothstep(0.05, 0.16, max(fw.x, fw.y)));
          float roomLight = 1.0;
          if (roomK > 0.01) {
            vec3 P = -vViewPosition;
            vec3 dpx = dFdx(P), dpy = dFdy(P);
            vec2 dux = dFdx(vFac), duy = dFdy(vFac);
            vec3 T = normalize(dpx * duy.y - dpy * dux.y), B = normalize(dpy * dux.x - dpx * duy.x);
            vec3 Nw = normalize(cross(T, B)), rd = normalize(P);
            if (dot(Nw, rd) > 0.0) Nw = -Nw;                                       // towards the camera
            vec3 d = vec3(dot(rd, T), dot(rd, B), max(-dot(rd, Nw), 0.02));        // z runs into the room
            vec2 size = vec2(bay * (box.y - box.x), storey * (box.w - box.z));
            vec3 o = vec3((f.x - box.x) / (box.y - box.x) * size.x, (f.y - box.z) / (box.w - box.z) * size.y, 0.0);
            float depth = t < 0.5 ? 5.5 : 3.8;
            float tx = (d.x > 0.0 ? size.x - o.x : o.x) / max(abs(d.x), 1e-4);
            float ty = (d.y > 0.0 ? size.y - o.y : o.y) / max(abs(d.y), 1e-4);
            float tz = depth / d.z, tm = min(tz, min(tx, ty));
            vec3 hit = o + d * tm;
            float rh = eftHash(id * 3.3 + vSeed * 11.0);
            vec3 tone = mix(vec3(0.62, 0.56, 0.5), vec3(0.8, 0.79, 0.76), rh);     // wall paint differs room to room
            float back = step(tz, min(tx, ty)), ceilK = (1.0 - back) * step(ty, tx) * step(0.0, d.y), floorK = (1.0 - back) * step(ty, tx) * (1.0 - step(0.0, d.y));
            vec3 room = tone * (back * 0.78 + (1.0 - back) * 0.6);
            room = mix(room, tone * 1.15, ceilK);
            room = mix(room, tone * vec3(0.42, 0.38, 0.34), floorK);
            room *= mix(1.0, 0.55, back * (1.0 - smoothstep(0.0, 0.95, hit.y)) * step(0.5, rh));     // furniture band along the back wall of some rooms
            room *= 1.0 - 0.45 * clamp(hit.z / depth, 0.0, 1.0);                   // darker towards the back
            roomLight = (0.55 + 0.9 * ceilK + 0.35 * back) * (1.0 - 0.4 * clamp(hit.z / depth, 0.0, 1.0));
            float blind = step(eftHash(id * 5.1 + vSeed * 3.0), 0.34) * step(1.0 - eftHash(id * 2.3 + vSeed) * 0.75, (f.y - box.z) / (box.w - box.z));
            room = mix(room, vec3(0.78, 0.76, 0.72), blind);
            roomLight = mix(roomLight, 0.9, blind);
            glass = mix(glass, glass * 0.5 + room * 0.3, roomK);
            eftGlass *= 1.0 - 0.6 * blind * roomK;                                 // a blind is matt, not a mirror
          }
          diffuseColor.rgb = mix(wallCol, glass, open * 0.94);

          float share = (t < 0.5 ? 0.2 : t < 1.5 ? 0.3 : t < 2.5 ? 0.38 : t < 3.5 ? 0.14 : 0.04) * (0.6 + 0.8 * vSeed);   // some buildings are busier than others
          float lit = mix(share, step(eftHash(id + vSeed * 53.0), share), both);
          vec3 lamp = (t > 0.5 && t < 2.5) ? mix(vec3(1.0, 0.78, 0.5), vec3(1.0, 0.9, 0.72), h1) : mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.95, 0.85), step(0.7, h1));
          totalEmissiveRadiance += lamp * uNight * open * (t > 3.5 && t < 4.5 ? 0.0 : 1.0) * lit * (t < 0.5 ? 0.85 : 1.25) * mix(1.0, roomLight, roomK);
          totalEmissiveRadiance += vec3(0.55, 0.7, 0.95) * uNight * crown * (0.35 + 0.35 * mix(0.5, step(0.5, f.y), cy));   // lit crown on the tallest towers
        }
        diffuseColor.rgb *= 1.0 - 0.45 * uNight;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, eftGlass);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, vType < 0.5 ? 0.8 : 0.55, eftGlass);`);
  };
  return m;
}

/** Curtain wall for the landmark models (R8): the model's glass slots get storeys, mullions and lit floors, laid out
 *  in metres from the world position and the wall's own direction, so it needs no texture coordinates and follows any
 *  shape (the Burj's rounded wing tips, the Emirates Towers' slanted crowns). `show` adds slow bands of light that
 *  climb the tower after dark (the Burj Khalifa's façade lighting, stylised). Patches the material in place. */
export function curtainWall<T extends THREE.MeshStandardMaterial>(m: T, u: { uNight: { value: number }; uTime: { value: number } }, opts: { bay?: number; storey?: number; show?: boolean; lit?: number } = {}): T {
  const bay = (opts.bay ?? 1.5).toFixed(2), storey = (opts.storey ?? 3.9).toFixed(2), lit = (opts.lit ?? 0.2).toFixed(2);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = u.uNight; sh.uniforms.uTime = u.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLw; varying vec3 vLn;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLw = (modelMatrix * vec4(transformed, 1.0)).xyz; vLn = mat3(modelMatrix) * objectNormal;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float uNight; uniform float uTime; varying vec3 vLw; varying vec3 vLn;
        float eftLh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float eftFrame = 0.0;`)
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        {
          vec3 n = normalize(vLn);
          float wall = 1.0 - smoothstep(0.5, 0.8, abs(n.y));                       // roofs and slopes stay plain
          vec2 h = normalize(n.xz + vec2(1e-5));
          vec2 g = vec2(dot(vLw.xz, vec2(-h.y, h.x)) / ${bay}, vLw.y / ${storey}), id = floor(g), f = fract(g), fw = fwidth(g);
          float cx = 1.0 - smoothstep(0.3, 0.8, fw.x), cy = 1.0 - smoothstep(0.3, 0.8, fw.y);
          float mull = mix(0.07, step(abs(f.x - 0.5), 0.035) + step(0.465, abs(f.x - 0.5)), cx);
          float span = mix(0.2, step(f.y, 0.2), cy);
          eftFrame = clamp(mull + span, 0.0, 1.0) * wall;
          diffuseColor.rgb *= 1.0 - 0.34 * eftFrame;
          diffuseColor.rgb *= 0.93 + 0.14 * eftLh(id * 1.3) * (1.0 - eftFrame) * cx * cy * wall;      // panes differ slightly
          float pane = (1.0 - eftFrame) * wall;
          float on = mix(${lit}, step(eftLh(id + 7.0), ${lit}), cx * cy);
          totalEmissiveRadiance += vec3(1.0, 0.92, 0.78) * uNight * pane * on * 0.95;
          ${opts.show ? `float band = pow(0.5 + 0.5 * sin(vLw.y * 0.021 - uTime * 0.9), 14.0) + 0.5 * pow(0.5 + 0.5 * sin(vLw.y * 0.047 + uTime * 0.55), 22.0);
          totalEmissiveRadiance += vec3(0.62, 0.8, 1.0) * uNight * wall * band * 0.9;` : ""}
        }`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, eftFrame);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.35, eftFrame);");
  };
  m.customProgramCacheKey = () => `eft-curtain-${bay}-${storey}-${lit}-${opts.show ? 1 : 0}`;
  return m;
}

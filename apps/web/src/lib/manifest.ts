// The v2 scene manifest. No three.js here: the page shell (credits) reads it too.
/** Realism ring (docs/13_REALISM_FABLE_TASKS.md, R1–R7), baked by scripts/realism_bake.py → public/geo/v2/.
 *  Since decision #108 it is the default scene on the visitor kiosk and on any window at least 900 px wide; a phone
 *  keeps the lighter corridor scene. `?scene=v1` / `?scene=v2` force one or the other. */
const Q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const VISITOR_KIOSK = Q?.get("kiosk") === "1";
const WIDE = typeof window !== "undefined" && window.innerWidth >= 900;
export const SCENE_V2 = !!Q && Q.get("scene") !== "v1" && (Q.get("scene") === "v2" || VISITOR_KIOSK || WIDE);
/** Lowest quality tier the automatic step-up may return to. Full quality (0) unless the booth asks for the lighter
 *  level with `?quality=light` (tier 1: no screen-space shading, smaller shadow map, fewer extras). */
export const MIN_TIER: 0 | 1 = SCENE_V2 && Q?.get("quality") === "light" ? 1 : 0;
/** Frame rate under which full quality steps down to tier 1 (3 s in a row). The kiosk is the booth's resting screen and
 *  R6 measured it at 47–57 fps at full quality on the Windows laptop, so there it leaves full quality under 50 fps
 *  instead of 40 and does not climb back (no flip-flopping in front of a visitor). */
export const STEP_DOWN_FPS = SCENE_V2 && VISITOR_KIOSK ? 50 : 40;
export const MAX_RECOVERIES = SCENE_V2 && VISITOR_KIOSK ? 0 : 2;
type Box = [number, number, number, number];      // x0, x1, z0, z1 in local metres
export interface ManifestChunk { id: string; extent: Box; n: number; buildings: string; ground: string; ao: string; mask: string }
export interface ChunkJson { buildings: number[][]; roof: number[]; cls: number[]; src: number[] }
export interface Manifest {
  version: number; generated: string; ring: Box; wide: Box; extent: Box;
  overview: { file: string; mask: string; extent: Box };
  ao_corridor: { file: string; extent: Box };
  ghosts: number[][]; chunks: ManifestChunk[];
  counts: { buildings: number; estimated: number; by_height_source: Record<string, number>; by_class: Record<string, number> };
  provenance: { dataset: string; source: string; licence: string; date: string; count: string }[];
}
let manifest: Promise<Manifest | null> | null = null;
/** The v2 manifest, or null when v2 is off or its files are missing (the twin then shows the corridor scene). */
export function loadManifest(): Promise<Manifest | null> {
  manifest ??= SCENE_V2 ? fetch("/geo/v2/manifest.json").then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null)).catch(() => null) : Promise.resolve(null);
  return manifest;
}

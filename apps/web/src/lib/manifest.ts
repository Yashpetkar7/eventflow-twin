// The v2 scene manifest. No three.js here: the page shell (credits) reads it too.
/** Realism ring (docs/13_REALISM_FABLE_TASKS.md, R1), baked by scripts/realism_bake.py → public/geo/v2/.
 *  The workspace shows it with `?scene=v2` (R6, decision #100: the corridor scene stays its default). The visitor kiosk
 *  (`?kiosk=1`) shows it by default at quality tier 1 or lower (decision #101); `?scene=v1` switches it off. */
const Q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const VISITOR_KIOSK = Q?.get("kiosk") === "1";
export const SCENE_V2 = !!Q && (Q.get("scene") === "v2" || (VISITOR_KIOSK && Q.get("scene") !== "v1"));
/** Lowest quality tier the automatic step-up may return to. R6 measured the kiosk on v2 at 47–57 fps at tier 0 (under
 *  the 50 fps floor in two of five runs) and 60 at tier 1, so the kiosk on v2 never goes above tier 1. */
export const MIN_TIER: 0 | 1 = SCENE_V2 && VISITOR_KIOSK ? 1 : 0;
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

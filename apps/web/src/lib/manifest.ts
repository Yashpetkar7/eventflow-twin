// The v2 scene manifest. No three.js here: the page shell (credits) reads it too.
/** Realism ring (docs/13_REALISM_FABLE_TASKS.md, R1), baked by scripts/realism_bake.py → public/geo/v2/.
 *  Only with `?scene=v2` until R6 decides it is booth-ready; the corridor scene above stays the default. */
export const SCENE_V2 = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("scene") === "v2";
type Box = [number, number, number, number];      // x0, x1, z0, z1 in local metres
export interface ManifestChunk { id: string; extent: Box; n: number; buildings: string; ground: string; ao: string; mask: string }
export interface ChunkJson { buildings: number[][]; roof: number[]; cls: number[]; src: number[] }
export interface Manifest {
  version: number; generated: string; ring: Box; wide: Box; extent: Box;
  overview: { file: string; mask: string; extent: Box };
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

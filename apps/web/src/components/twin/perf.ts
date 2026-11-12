// Realism R7 (decision #103): the frame-rate work on ?scene=v2. Each part has a switch, so it can be measured on its
// own on any laptop from one build: /?scene=v2&r7off=shadow,palms (tests/r7_fps.mjs takes the same query as its 3rd argument).
//   shadow  the shadow map is redrawn only when the sun, the view or a caster has changed (Sky.tsx)
//   palms   palms in three levels of detail by distance from the camera (City.tsx)
//   cars    25 % car and bus models from far away; hidden vehicles are not sent to the GPU (Live.tsx)
//   order   the ground is drawn after everything else that is opaque (Ring.tsx)
// Off unless asked for with &r7on=tiles — it did not help on the laptop R7 was measured on (fewer triangles, more draw calls):
//   tiles   buildings in 2.5 km tiles (1.25 km by the corridor) instead of 5 km chunks (Ring.tsx)
const list = (key: string) => new Set((typeof window !== "undefined" ? new URLSearchParams(window.location.search).get(key) ?? "" : "").split(","));
const off = list("r7off"), on = list("r7on");
export const R7 = { shadow: !off.has("shadow"), palms: !off.has("palms"), cars: !off.has("cars"), order: !off.has("order"), tiles: on.has("tiles") };
/** Side of a building tile in metres: far ring, by the corridor. */
export const TILE_FAR = 2500, TILE_NEAR = 1250;

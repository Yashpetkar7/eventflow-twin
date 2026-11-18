import { useSyncExternalStore } from "react";

// True when the browser can create a WebGL context. Callers check it on the client, before a 3D canvas mounts:
// THREE.WebGLRenderer throws during mount when no context exists, and nothing catches that, so the whole page fails.
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

// Probed once per page: creating contexts is not free, and the answer does not change while the page is open.
let probed: boolean | null = null;
const snapshot = () => (probed ??= webglAvailable());
const serverSnapshot = () => null;
const subscribe = () => () => {};

/** WebGL on this client: null during the server render and hydration (so neither renders a canvas), then true or
 *  false. A hook over an external value instead of state set in an effect (react-hooks/set-state-in-effect). */
export function useWebgl(): boolean | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

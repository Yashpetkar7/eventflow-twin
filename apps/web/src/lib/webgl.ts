// True when the browser can create a WebGL context. Callers check it on the client, before a 3D canvas mounts:
// THREE.WebGLRenderer throws during mount when no context exists, and nothing catches that, so the whole page fails.
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

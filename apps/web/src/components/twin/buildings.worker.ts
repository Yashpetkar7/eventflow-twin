// Web worker: builds one chunk's building geometry off the main thread (docs/13 R3) and hands the arrays back
// without copying. Bundled with the app — nothing is fetched.
import { buildBuildings, type BuildingInput } from "./buildingsV2";

self.onmessage = (e: MessageEvent<{ id: number; input: BuildingInput }>) => {
  const out = buildBuildings(e.data.input);
  (self as unknown as Worker).postMessage({ id: e.data.id, out }, Object.values(out).map((a) => a.buffer));
};

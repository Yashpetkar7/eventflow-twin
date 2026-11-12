// MapLibre runs tile parsing in a Web Worker. Turbopack does not serve the package's worker module, so we ship
// it as a static file (public/map/maplibre-gl-worker.mjs) and point MapLibre at it with setWorkerUrl().
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json"));
mkdirSync("public/map", { recursive: true });
copyFileSync(join(dist, "dist/maplibre-gl-worker.mjs"), "public/map/maplibre-gl-worker.mjs");
console.log("copied maplibre-gl-worker.mjs → public/map/");

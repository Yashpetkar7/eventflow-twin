import { defineConfig } from "@playwright/test";

// UI tests run against the real API + web app.
//   local (default): starts or reuses the API on :8000 and the web app on :$EFT_WEB_PORT (default 3000)
//   remote:          EFT_BASE_URL=https://<deployment> runs against a deployed site and starts nothing
const remote = process.env.EFT_BASE_URL;
const port = Number(process.env.EFT_WEB_PORT ?? 3000);
// EFT_API_PORT: a second checkout (git worktree) can run its own API and web app next to the main one
const apiPort = Number(process.env.EFT_API_PORT ?? 8000);
const apiEnv = apiPort === 8000 ? undefined : { NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}` };
// EFT_NO_WEBGL=1 (set by CI): Chrome without WebGL, so the app takes its table-view fallback instead of waiting on a
// 3D scene that software rendering on a GPU-less runner never finishes; tests that need the scene skip themselves.
const noGL = !!process.env.EFT_NO_WEBGL;
const glArgs = noGL ? ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"]
  : [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"];

// Without WebGL these drive the 3D scene itself, so they cannot run (every one passes on a laptop with a GPU):
// the visitor kiosk (its attract screen and story are the 3D twin), camera recentre and landmark fly-to, the quality
// tier that reacts to the frame rate, and the realism shaders. Frame-rate measurements skip themselves on CI.
const NEEDS_3D = /kiosk: the visitor watches the AI team work|recentre brings the 3D view|landmarks|quality tier steps down|realism scene: figures/;

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  testIgnore: noGL ? ["**/kiosk.spec.ts"] : [],
  grepInvert: noGL ? NEEDS_3D : undefined,
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: remote ?? `http://localhost:${port}`,
    channel: "chrome",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    launchOptions: { args: glArgs },
  },
  webServer: remote ? undefined : [
    { command: `${process.platform === "win32" ? ".venv\\Scripts\\python" : ".venv/bin/python"} -m uvicorn apps.api.eventflow.main:app --port ${apiPort}`, cwd: "../..", url: `http://localhost:${apiPort}/healthz`, reuseExistingServer: true, timeout: 60_000 },
    { command: `npm run dev -- -p ${port}`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 120_000, env: apiEnv },
  ],
});

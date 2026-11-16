import { defineConfig } from "@playwright/test";

// UI tests run against the real API + web app.
//   local (default): starts or reuses the API on :8000 and the web app on :$EFT_WEB_PORT (default 3000)
//   remote:          EFT_BASE_URL=https://<deployment> runs against a deployed site and starts nothing
const remote = process.env.EFT_BASE_URL;
const port = Number(process.env.EFT_WEB_PORT ?? 3000);
// EFT_API_PORT: a second checkout (git worktree) can run its own API and web app next to the main one
const apiPort = Number(process.env.EFT_API_PORT ?? 8000);
const apiEnv = apiPort === 8000 ? undefined : { NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}` };

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: remote ?? `http://localhost:${port}`,
    channel: "chrome",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    // EFT_NO_GL=1 (the CI ui job): no WebGL at all, so the app takes its table fallback. GitHub runners draw WebGL in
    // software, too slow for the 3D checks (120 s test timeouts); those checks are skipped under EFT_NO_GL, the rest run.
    launchOptions: { args: process.env.EFT_NO_GL === "1"
      ? ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"]
      : [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] },
  },
  webServer: remote ? undefined : [
    { command: `${process.platform === "win32" ? ".venv\\Scripts\\python" : ".venv/bin/python"} -m uvicorn apps.api.eventflow.main:app --port ${apiPort}`, cwd: "../..", url: `http://localhost:${apiPort}/healthz`, reuseExistingServer: true, timeout: 60_000 },
    { command: `npm run dev -- -p ${port}`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 120_000, env: apiEnv },
  ],
});

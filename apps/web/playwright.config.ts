import { defineConfig } from "@playwright/test";

// UI tests run against the real API + web app (started here if they are not already running).
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] },
  },
  webServer: [
    { command: "../../.venv/bin/python -m uvicorn apps.api.eventflow.main:app --port 8000", cwd: "../..", url: "http://localhost:8000/healthz", reuseExistingServer: true, timeout: 60_000 },
    { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
  ],
});

// The kiosk in the booth's own setup: the installed Chrome started with --kiosk (real full screen on this machine's
// screen, its real resolution and scaling), not a Playwright-sized page. Connects over the DevTools port only to read
// the frame rate and tier, then presses the reach button once and saves a screenshot of it.
//   node tests/kiosk_real_chrome.mjs [base url] [out]   → eval/results/ui/<out> (default booth_windows/kiosk_real_chrome.json)
//   Windows; set CHROME to the chrome.exe path if it is not in the usual place. The screen is taken over for ~50 s.
import { chromium } from "@playwright/test";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3100", out = process.argv[3] ?? "booth_windows/kiosk_real_chrome.json";
const OUT = path.resolve(import.meta.dirname, "../../../eval/results/ui", out);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const chrome = process.env.CHROME ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
const power = () => { try { return [1, 4, 5].includes(+execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Battery).BatteryStatus"').toString().trim()) ? "Battery Power" : "AC Power"; } catch { return "unknown"; } };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "eft-kiosk-"));
const proc = spawn(chrome, ["--kiosk", "--remote-debugging-port=9333", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--use-angle=d3d11", "--ignore-gpu-blocklist", `${base}/?kiosk=1`], { stdio: "ignore" });
let browser;
for (let i = 0; i < 40 && !browser; i++) { try { browser = await chromium.connectOverCDP("http://127.0.0.1:9333"); } catch { await new Promise((r) => setTimeout(r, 500)); } }
try {
  const page = browser.contexts()[0].pages().find((p) => p.url().includes("kiosk=1"));
  await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
  await page.waitForFunction(() => { const [a, b] = (document.documentElement.dataset.sceneV2 ?? "0/1").split("/"); return a === b; }, null, { timeout: 120000 });
  await page.waitForTimeout(30000);                        // the brief: open /?kiosk=1, wait 30 s, then measure
  const samples = [], tiers = [];
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); const e = await page.evaluate(() => window.__eft ?? {}); samples.push(+(e.fps ?? 0).toFixed(1)); tiers.push(e.tier ?? -1); }
  const dev = await page.evaluate(() => { const gl = document.createElement("canvas").getContext("webgl2"), x = gl?.getExtension("WEBGL_debug_renderer_info"), c = document.querySelector("canvas");
    return { gpu: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : "unknown", screen: `${screen.width}x${screen.height}`, window: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio, canvas: c ? `${c.width}x${c.height}` : "none" }; });
  await page.getByTestId("kiosk-reach").click();             // reach mode: every control in the lower half
  await page.waitForTimeout(1500);
  const shot = OUT.replace(/\.json$/, "_reach.png");
  await page.screenshot({ path: shot });
  const res = { suite: "ui_fps_kiosk_real_chrome", timestamp: new Date().toISOString(), target: base, url: "/?kiosk=1",
    viewport: `installed Chrome --kiosk, screen ${dev.screen}, window ${dev.window} at device pixel ratio ${dev.dpr}`, canvas_pixels: dev.canvas, gpu: dev.gpu,
    power_source: power(), avg_fps: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1), min_fps: Math.min(...samples),
    tier_at_end: tiers[tiers.length - 1], samples, tiers, reach_screenshot: path.basename(shot) };
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  console.log(res.url, "avg", res.avg_fps, "min", res.min_fps, "tier", res.tier_at_end, "|", res.power_source, "|", res.viewport, "| canvas", res.canvas_pixels);
} finally {
  await browser?.close().catch(() => {});
  proc.kill();
}

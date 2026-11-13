// Frame rate of the visitor kiosk's attract screen (full-screen 3D, slow orbit) — the booth's resting state.
//   node tests/kiosk_fps.mjs [base url] [scene] [out]   → eval/results/ui/fps_kiosk.json, or fps_kiosk_<scene>.json, or
//   eval/results/ui/<out> when given (e.g. realism_r7/kiosk_fps_tier0_after.json)
//   realism scene on the production build: node tests/kiosk_fps.mjs http://localhost:3100 v2
//   a 4th argument adds to the query, e.g. "quality=light"; EFT_HEADED=1 opens real Chrome in kiosk mode on this
//   machine's own screen (its real resolution and scaling) instead of a headless 1920×1080 page
// Run on mains power with no other 3D page open. Samples are one-second averages; the tier is recorded so a reading
// taken after the automatic quality step-down cannot pass as full quality.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000", scene = process.argv[3] ?? "", extra = process.argv[5] ?? "", headed = process.env.EFT_HEADED === "1";
const power = () => {              // "AC Power" / "Battery Power": a throttled battery run must never pass as a mains run
  try {
    if (process.platform === "darwin") return execSync("pmset -g batt").toString().match(/'(.+?)'/)?.[1] ?? "unknown";
    if (process.platform === "win32") return execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Battery).BatteryStatus"').toString().trim() === "2" ? "AC Power" : "Battery Power";
  } catch { /* fall through */ }
  return "unknown";
};
const OUT = path.resolve(import.meta.dirname, "../../../eval/results/ui", process.argv[4] ?? `fps_kiosk${scene ? "_" + scene : ""}.json`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: !headed,
  args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", ...(headed ? ["--kiosk"] : [])] });
const page = await browser.newPage(headed ? { viewport: null } : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const url = `/?kiosk=1${scene ? "&scene=" + scene : ""}${extra ? "&" + extra : ""}`;
await page.goto(base + url);
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
if (scene === "v2") await page.waitForFunction(() => { const [a, b] = (document.documentElement.dataset.sceneV2 ?? "0/1").split("/"); return a === b; }, null, { timeout: 120000 });
await page.waitForTimeout(8000);
const samples = [], tiers = [];                    // the tier per second shows when the kiosk stepped down by itself
for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); const e = await page.evaluate(() => window.__eft ?? {}); samples.push(+(e.fps ?? 0).toFixed(1)); tiers.push(e.tier ?? -1); }
const dev = await page.evaluate(() => { const gl = document.createElement("canvas").getContext("webgl2"), x = gl?.getExtension("WEBGL_debug_renderer_info"), c = document.querySelector("canvas");
  return { gpu: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : "unknown", window: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio, canvas: c ? `${c.width}x${c.height}` : "none" }; });
const out = { suite: "ui_fps_kiosk", timestamp: new Date().toISOString(), target: base, url, viewport: headed ? `real Chrome in kiosk mode, window ${dev.window} at device pixel ratio ${dev.dpr}` : "1920x1080 (3D full screen)",
  canvas_pixels: dev.canvas, gpu: dev.gpu, power_source: power(),
  avg_fps: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1), min_fps: Math.min(...samples), tier_at_end: tiers[tiers.length - 1], samples, tiers };
// keep every run: one reading is not a verdict when the result sits near the floor
const runs = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")).runs ?? []) : [];
out.runs = [...runs, { timestamp: out.timestamp, target: base, power_source: out.power_source, canvas_pixels: out.canvas_pixels, avg_fps: out.avg_fps, min_fps: out.min_fps, tier_at_end: out.tier_at_end }];
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(out.url, "avg", out.avg_fps, "min", out.min_fps, "tier", out.tier_at_end, "|", out.power_source, "|", out.canvas_pixels);
await browser.close();

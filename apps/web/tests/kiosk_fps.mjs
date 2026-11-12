// Frame rate of the visitor kiosk's attract screen (full-screen 3D, slow orbit) — the booth's resting state.
//   node tests/kiosk_fps.mjs [base url] [scene] [out]   → eval/results/ui/fps_kiosk.json, or fps_kiosk_<scene>.json, or
//   eval/results/ui/<out> when given (e.g. realism_r7/kiosk_fps_tier0_after.json)
//   realism scene on the production build: node tests/kiosk_fps.mjs http://localhost:3100 v2
// Run on mains power with no other 3D page open. Samples are one-second averages; the tier is recorded so a reading
// taken after the automatic quality step-down cannot pass as full quality.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000", scene = process.argv[3] ?? "";
const OUT = path.resolve(import.meta.dirname, "../../../eval/results/ui", process.argv[4] ?? `fps_kiosk${scene ? "_" + scene : ""}.json`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`${base}/?kiosk=1${scene ? "&scene=" + scene : ""}`);
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
if (scene === "v2") await page.waitForFunction(() => { const [a, b] = (document.documentElement.dataset.sceneV2 ?? "0/1").split("/"); return a === b; }, null, { timeout: 120000 });
await page.waitForTimeout(8000);
const samples = [];
for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); samples.push(+(await page.evaluate(() => window.__eft?.fps ?? 0)).toFixed(1)); }
const out = { suite: "ui_fps_kiosk", timestamp: new Date().toISOString(), target: base, url: `/?kiosk=1${scene ? "&scene=" + scene : ""}`, viewport: "1920x1080 (3D full screen)",
  avg_fps: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1), min_fps: Math.min(...samples), tier_at_end: await page.evaluate(() => window.__eft?.tier ?? -1), samples };
// keep every run: one reading is not a verdict when the result sits near the floor
const runs = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")).runs ?? []) : [];
out.runs = [...runs, { timestamp: out.timestamp, target: base, avg_fps: out.avg_fps, min_fps: out.min_fps, tier_at_end: out.tier_at_end }];
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(out.url, "avg", out.avg_fps, "min", out.min_fps, "tier", out.tier_at_end);
await browser.close();

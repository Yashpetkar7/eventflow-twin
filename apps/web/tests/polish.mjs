// Before/after captures for the visual polish pass: 5 camera presets × 3 times of day, 3D view only.
//   node tests/polish.mjs before|after     → eval/results/ui/polish/<label>_<HHMM>_<preset>.jpg + <label>_fps.json
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const label = process.argv[2] ?? "after";
const OUT = path.resolve(import.meta.dirname, "../../../eval/results/ui/polish");
fs.mkdirSync(OUT, { recursive: true });
const TIMES = [[10, "1000"], [17.5, "1730"], [21.5, "2130"]];
const CAMS = ["overview", "close", "top", "fly", "orbit"];

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(process.env.EFT_URL ?? "http://localhost:3000/");
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
const fps = {};
for (const [time, tag] of TIMES) {
  for (const cam of CAMS) {
    await page.evaluate(([t, c]) => { const s = window.__twin; s.setState({ time: t, playing: false, selected: "EMT", tab: "station" }); s.getState().setCam(c); }, [time, cam]);
    await page.waitForTimeout(cam === "fly" ? 7000 : 5000);
    fps[`${tag}_${cam}`] = +(await page.evaluate(() => window.__eft?.fps ?? 0)).toFixed(1);
    await page.locator(".view").screenshot({ path: `${OUT}/${label}_${tag}_${cam}.jpg`, type: "jpeg", quality: 86 });
  }
}
const all = Object.values(fps);
fs.writeFileSync(`${OUT}/${label}_fps.json`, JSON.stringify({ label, timestamp: new Date().toISOString(), viewport: "1920x1080", avg_fps: +(all.reduce((a, b) => a + b, 0) / all.length).toFixed(1), min_fps: Math.min(...all), per_shot: fps }, null, 2));
console.log(label, "avg fps", (all.reduce((a, b) => a + b, 0) / all.length).toFixed(1), "min", Math.min(...all));
await browser.close();

// Before/after pictures for the realism passes R8–R10 (decision #114): room interiors behind windows, the curtain
// wall on the landmark towers, cloud shadows, vignette and the lamp pools on the road.
//   node tests/r10_shots.mjs <label> [base url]        → eval/results/ui/realism_r10/<label>_<view>.jpg + <label>_fps.json
// "before" is taken from a build without the changes (for example the live site), "after" from this one.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const label = process.argv[2] ?? "after", base = (process.argv[3] ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = path.resolve(import.meta.dirname, "../../../eval/results/ui/realism_r10");
fs.mkdirSync(OUT, { recursive: true });
// view: store state, wheel notches towards the target (negative = zoom in), seconds to settle
const VIEWS = [
  ["street_1000", { time: 10, selected: "EMT", cam: "close" }, -14, 7],
  ["street_2130", { time: 21.5, selected: "FIC", cam: "close" }, -14, 7],
  ["burj_1730", { time: 17.5, focus: "burj", cam: "landmark" }, -6, 8],
  ["burj_2130", { time: 21.5, focus: "burj", cam: "landmark" }, -6, 8],
  ["towers_1000", { time: 10, focus: "et", cam: "landmark" }, -8, 8],
  ["overview_1500", { time: 15, cam: "overview" }, 0, 7],
];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 240)); });
await page.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); } catch { /* ignore */ } });
await page.goto(`${base}/?scene=v2`);
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 120000 });
await page.waitForFunction(() => { const [a, b] = (document.documentElement.dataset.sceneV2 ?? "0/1").split("/"); return a === b; }, null, { timeout: 180000 });
await page.evaluate(() => {                              // the 3D view alone: hide the panels around it
  const st = document.createElement("style");
  st.textContent = '[data-testid="view"] { position: fixed !important; inset: 0 !important; z-index: 9999 !important; background: #000 } [data-testid="view"] > *:not(:has(canvas)):not(canvas) { display: none !important }';
  document.head.append(st);
  window.dispatchEvent(new Event("resize"));
});
const fps = {};
for (const [name, state, wheel, wait] of VIEWS) {
  await page.evaluate((s) => { const t = window.__twin; const { cam, ...rest } = s; t.setState({ playing: false, ...rest }); t.getState().setCam(cam); }, state);
  await page.waitForTimeout(3500);
  await page.mouse.move(960, 560);
  for (let i = 0; i < Math.abs(wheel); i++) { await page.mouse.wheel(0, wheel < 0 ? -240 : 240); await page.waitForTimeout(90); }
  await page.waitForTimeout(wait * 1000);
  fps[name] = { fps: +(await page.evaluate(() => window.__eft?.fps ?? 0)).toFixed(1), tier: await page.evaluate(() => window.__eft?.tier) };
  await page.screenshot({ path: path.join(OUT, `${label}_${name}.jpg`), quality: 88, type: "jpeg" });
}
fs.writeFileSync(path.join(OUT, `${label}_fps.json`), JSON.stringify({ label, base, when: new Date().toISOString(), viewport: "1920x1080", views: fps, errors: [...new Set(errors)].slice(0, 8) }, null, 1));
console.log(JSON.stringify({ label, fps, errors: [...new Set(errors)].slice(0, 5) }));
await browser.close();

// Developer helper: one screenshot of the running app in a given state.
//   node tests/shot.mjs out.png '{"time":17.5,"cam":"overview"}' [url] [width] [height]
import { chromium } from "@playwright/test";

const [out = "shot.png", stateJson = "{}", url = "http://localhost:3000/", w = "1920", h = "1080"] = process.argv.slice(2);
const state = JSON.parse(stateJson);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
await page.goto(url);
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 60000 });
await page.evaluate((s) => {
  const t = window.__twin;
  const { cam, event, ...rest } = s;
  if (event) t.getState().selectEvent(event);
  if (Object.keys(rest).length) t.setState(rest);
  if (cam) t.getState().setCam(cam);
}, state);
await page.waitForTimeout(state.wait ?? 4500);
const eft = await page.evaluate(() => window.__eft);
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, fps: eft?.fps?.toFixed(1), errors: [...new Set(errors)].slice(0, 5) }));
await browser.close();

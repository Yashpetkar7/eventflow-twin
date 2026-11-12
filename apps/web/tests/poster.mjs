// The static poster shown while the 3D canvas loads: a clean render of the scene itself (canvas pixels only —
// no HUD, labels or buttons), golden hour, overview.   node tests/poster.mjs   → public/poster.jpg
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(process.env.EFT_URL ?? "http://localhost:3000/");
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
await page.evaluate(() => { const t = window.__twin; t.setState({ time: 16.9, playing: false }); t.getState().setCam("overview"); });
await page.waitForTimeout(5000);
const url = await page.evaluate(() => document.querySelector(".view canvas").toDataURL("image/jpeg", 0.82));
fs.writeFileSync(path.resolve(import.meta.dirname, "../public/poster.jpg"), Buffer.from(url.split(",")[1], "base64"));
console.log("poster.jpg written", Math.round(url.length * 0.75 / 1024), "kB");
await browser.close();

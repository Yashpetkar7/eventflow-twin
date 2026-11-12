// Booth backup video of the visitor kiosk (task K8, decision #104): the attract screen, the two ways in, then
// "Show me in 60 seconds" plays the planner story with captions, and a short look at the rider tip.
//   node tests/backup_video_kiosk.mjs [base url]     (API + web running; default http://localhost:3000)
// Output: exhibit/video/eventflow_kiosk_show.mp4 (git-ignored; copy to the USB stick). Use a production build
// (npm run build && npm run start) so the dev-mode badge is not in the picture. Converts to MP4 when ffmpeg is installed.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const base = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(import.meta.dirname, "../../../exhibit/video");
fs.mkdirSync(OUT, { recursive: true });
const size = { width: 1920, height: 1080 };
const browser = await chromium.launch({ channel: "chrome", headless: process.env.HEADED !== "1",
  args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: OUT, size } });
const page = await ctx.newPage();
const phase = (p, timeout = 60_000) => page.waitForFunction((x) => document.querySelector('[data-testid="kiosk"]')?.dataset.phase === x, p, { timeout });

await page.goto(`${base}/?kiosk=1&idle=600`);
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90_000 });
await page.waitForFunction(() => { const [a, b] = (document.documentElement.dataset.sceneV2 ?? "1/1").split("/"); return a === b; }, null, { timeout: 120_000 });
const t0 = Date.now();
await page.waitForTimeout(7000);                                        // the attract screen
await page.getByTestId("kiosk-start").click();
await page.waitForTimeout(3500);                                        // the two ways in
await page.getByTestId("kiosk-show").click();
await phase("decide", 120_000);
await phase("attract", 60_000);                                         // the show ends by itself
await page.waitForTimeout(3000);
await page.getByTestId("kiosk-start").click();                          // … and the rider's side of the story
await page.waitForTimeout(1500);
await page.getByTestId("kiosk-rider").click();
await page.getByTestId("kiosk-advice").waitFor({ timeout: 30_000 });
await page.waitForTimeout(6000);
await page.getByTestId("kiosk-mode").getByRole("button").nth(1).click();
await page.waitForTimeout(6000);
const seconds = Math.round((Date.now() - t0) / 1000);
const video = page.video();
await ctx.close();
await browser.close();

const webm = path.join(OUT, "eventflow_kiosk_show.webm");
fs.renameSync(await video.path(), webm);
let out = webm;
try {
  const mp4 = path.join(OUT, "eventflow_kiosk_show.mp4");
  // the recording starts while the scene is still loading: cut that part off
  const lead = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", webm]).toString()) - seconds - 1;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(Math.max(0, lead)), "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  fs.rmSync(webm);
  out = mp4;
} catch { /* ffmpeg not installed: the .webm plays in Chrome and VLC */ }
console.log(`kiosk video: ${out} (${seconds} s of kiosk, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);

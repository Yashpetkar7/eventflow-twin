// Booth backup video (task K8): records the guided demo in kiosk mode at 1920×1080, then a short visitor segment
// (hot day → AI plan → approve → Arabic → break-point card), into exhibit/video/ (git-ignored; copy to the USB stick).
//   node tests/backup_video.mjs [base url]          (API + web running; default http://localhost:3000)
// Converts to MP4 with ffmpeg when it is installed. Headless capture can drop frames on heavy scenes; for the
// smoothest copy, screen-record the kiosk with macOS (Shift-Cmd-5) while this script drives it with HEADED=1.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const base = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(import.meta.dirname, "../../../exhibit/video");
fs.mkdirSync(OUT, { recursive: true });
const size = { width: 1920, height: 1080 };

const browser = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: OUT, size } });
const page = await ctx.newPage();
await page.goto(`${base}/?kiosk=1&idle=600`);
await page.waitForFunction(() => window.__twin?.getState().forecast && !window.__twin.getState().loading, null, { timeout: 60000 });
await page.waitForTimeout(3000);                                   // let the scene settle on camera

// 1 · the guided demo, exactly as the idle loop plays it at the booth
await page.getByRole("button", { name: "Guided demo" }).click();
await page.waitForFunction(() => window.__twin.getState().tourStep !== null, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => window.__twin.getState().tourStep === null, null, { timeout: 180000 });
await page.waitForTimeout(1500);

// 2 · a visitor's turn: hot day pushes World Trade Centre over the line, ask the agents, approve option 1
await page.evaluate(() => window.__twin.getState().clearPlans());
await page.getByRole("button", { name: "Hot day" }).click();
await page.waitForFunction(() => window.__twin.getState().forecast?.weather === "hot" && !window.__twin.getState().loading);
await page.waitForTimeout(2000);
await page.getByRole("tab", { name: /AI plan/ }).click();
await page.getByRole("button", { name: "Plan with AI agents" }).click();
await page.waitForSelector(".opt", { timeout: 30000 });
await page.waitForTimeout(4000);
await page.locator(".opt").first().getByRole("button", { name: "Approve" }).click();
await page.waitForTimeout(3500);
await page.getByRole("tab", { name: "Station" }).click();         // the break-point card
await page.waitForTimeout(4000);
await page.getByRole("button", { name: /عربي/ }).click();         // Arabic, right-to-left
await page.waitForTimeout(4000);
await page.getByRole("button", { name: /English/ }).click();
await page.waitForTimeout(2000);
await page.evaluate(() => { const s = window.__twin.getState(); s.clearPlans(); s.setCam("orbit"); });
await page.waitForTimeout(6000);

const video = page.video();
await ctx.close();
await browser.close();
const webm = path.join(OUT, "eventflow_backup_demo.webm");
fs.renameSync(await video.path(), webm);
let final = webm;
try {
  const mp4 = path.join(OUT, "eventflow_backup_demo.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  final = mp4;
} catch { /* ffmpeg not installed: the .webm plays in Chrome and VLC */ }
const mb = (fs.statSync(final).size / 1e6).toFixed(1);
console.log(`written ${final} (${mb} MB)`);

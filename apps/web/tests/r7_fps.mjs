// Realism R7 (decision #103): frame rate of ?scene=v2 with the display cap removed, so headroom above 60 fps shows.
//   node tests/r7_fps.mjs <label> [base url] [extra query]   → eval/results/ui/realism_r7/<label>_fps.json
//   e.g. node tests/r7_fps.mjs after http://localhost:3100       (production build: npm run build && npm run start -- -p 3100)
//        node tests/r7_fps.mjs no_shadow_cache http://localhost:3100 "r7off=shadow"     (switches: src/components/twin/perf.ts)
//   R7_BUILD="…" adds a note on the build under test to the result file (e.g. "MIN_TIER 0").
// Chrome runs with --disable-frame-rate-limit --disable-gpu-vsync (as in decision #96). Per camera preset and time of
// day: 4 s to settle, then 8 one-second samples; draw calls and triangles are those of one whole frame (shadow pass,
// scene and post-processing). Run on mains power with no other 3D page open; the power source is recorded (macOS, Windows).
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const label = process.argv[2] ?? "after", base = process.argv[3] ?? "http://localhost:3100", extra = process.argv[4] ?? "";
const OUT = path.resolve(import.meta.dirname, "../../../eval/results/ui/realism_r7");
fs.mkdirSync(OUT, { recursive: true });
const TIMES = [[10, "1000"], [21.5, "2130"]], CAMS = ["overview", "close", "top", "orbit"];
const power = () => {              // "AC Power" / "Battery Power": a throttled battery run must never pass as a mains run
  try {
    if (process.platform === "darwin") return execSync("pmset -g batt").toString().match(/'(.+?)'/)?.[1] ?? "unknown";
    if (process.platform === "win32") {
      // Win32_Battery.BatteryStatus: 1 discharging, 4 low, 5 critical = running on the battery; 2 and 6–9 (charging) and 11 = on mains.
      // A status of 6–9 used to be written down as "Battery Power", so a mains run on a charging laptop would have been mislabelled.
      const s = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Battery).BatteryStatus"').toString().trim().split(/\s+/)[0];
      return s === "" ? "AC Power (no battery)" : ["1", "4", "5"].includes(s) ? "Battery Power" : "AC Power";
    }
  } catch { /* fall through */ }
  return "unknown";
};
const git = (cmd) => { try { return execSync(`git ${cmd}`).toString().trim(); } catch { return "unknown"; } };

const browser = await chromium.launch({ channel: "chrome", headless: true, args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11",
  "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--disable-frame-rate-limit", "--disable-gpu-vsync"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const url = `/?scene=v2${extra ? "&" + extra : ""}`;
await page.goto(base + url);
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
await page.waitForFunction(() => { const [a, b] = (document.documentElement.dataset.sceneV2 ?? "0/1").split("/"); return a === b; }, null, { timeout: 120000 });
const gpu = await page.evaluate(() => { const gl = document.createElement("canvas").getContext("webgl2"), e = gl?.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown"; });
await page.waitForTimeout(4000);
const cases = {};
for (const [time, tag] of TIMES) {
  for (const cam of CAMS) {
    await page.evaluate(([t, c]) => { const s = window.__twin; s.setState({ time: t, playing: false, selected: "EMT", tab: "station" }); s.getState().setCam(c); }, [time, cam]);
    await page.waitForTimeout(4000);
    const samples = [];
    let info = {};
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); info = await page.evaluate(() => window.__eft ?? {}); samples.push(+(info.fps ?? 0).toFixed(1)); }
    const sorted = [...samples].sort((a, b) => a - b);
    cases[`${tag}_${cam}`] = { median_fps: sorted[4], min_fps: sorted[0], max_fps: sorted[7], calls: info.calls ?? null, triangles: info.triangles ?? null, tier: info.tier ?? -1, samples };
    console.log(label, tag, cam.padEnd(8), "median", String(sorted[4]).padStart(6), "min", String(sorted[0]).padStart(6), "calls", info.calls, "tris", info.triangles, "tier", info.tier);
  }
}
// the visitor kiosk's resting screen (3D full screen, slow orbit at 17:30); its tier is recorded: the kiosk is held at
// tier 1 unless MIN_TIER in src/lib/manifest.ts is 0 in the build under test
await page.goto(`${base}/?kiosk=1&scene=v2${extra ? "&" + extra : ""}`);
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
await page.waitForFunction(() => { const [a, b] = (document.documentElement.dataset.sceneV2 ?? "0/1").split("/"); return a === b; }, null, { timeout: 120000 });
await page.waitForTimeout(8000);
{
  const samples = [];
  let info = {};
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(1000); info = await page.evaluate(() => window.__eft ?? {}); samples.push(+(info.fps ?? 0).toFixed(1)); }
  const sorted = [...samples].sort((a, b) => a - b);
  cases.kiosk_attract_1730_orbit = { median_fps: sorted[5], min_fps: sorted[0], max_fps: sorted[9], calls: info.calls ?? null, triangles: info.triangles ?? null, tier: info.tier ?? -1, samples };
  console.log(label, "kiosk attract  median", sorted[5], "min", sorted[0], "calls", info.calls, "tris", info.triangles, "tier", info.tier);
}
fs.writeFileSync(`${OUT}/${label}_fps.json`, JSON.stringify({ suite: "ui_fps_uncapped_r7", label, git_sha: git("rev-parse --short HEAD"), uncommitted_changes: git("status --porcelain -- src") !== "", build: process.env.R7_BUILD ?? "", timestamp: new Date().toISOString(), target: base, url,
  viewport: "1920x1080 (workspace: all layers on, clock paused; kiosk: 3D full screen)", chrome_flags: "--disable-frame-rate-limit --disable-gpu-vsync", gpu, power_source: power(), cases }, null, 2));
await browser.close();

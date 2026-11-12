// Final 1920×1080 screenshots for the poster, nomination and LinkedIn (task C6) → submission/images/final/.
//   node tests/final_shots.mjs [base url]        (API + web running)
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(import.meta.dirname, "../../../submission/images/final");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });

async function page(url) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await p.goto(base + url);
  await p.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
  return p;
}
const state = (p, fn) => p.evaluate(fn);
const ready = (p) => p.waitForFunction(() => !window.__twin.getState().loading);
const shots = [];

// 1 · overview at golden hour, GITEX 2025 day 1
let p = await page("/");
await state(p, () => { const t = window.__twin; t.setState({ time: 17.25, tab: "station", selected: "WTC" }); t.getState().setCam("overview"); });
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/1_overview_golden_hour.png` }); shots.push("1_overview_golden_hour.png");
await p.close();

// 2 · station close-up with the AI options (hot day pushes World Trade Centre over the line)
p = await page("/");
await p.getByRole("button", { name: "Hot day" }).click();
await p.waitForFunction(() => window.__twin.getState().forecast?.weather === "hot" && !window.__twin.getState().loading);
await p.getByRole("tab", { name: /AI plan/ }).click();
await p.getByRole("button", { name: "Plan with AI agents" }).click();
await p.locator(".opt").first().waitFor();
await state(p, () => { const t = window.__twin; t.setState({ selected: "WTC" }); t.getState().setCam("close"); });
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/2_station_closeup_ai_options.png` }); shots.push("2_station_closeup_ai_options.png");
// 3 · after approval: back under the threshold, report with the before/after scoreboard
await p.locator(".opt").first().getByRole("button", { name: "Approve" }).click();
await p.waitForFunction(() => window.__twin.getState().applied.length === 1);
await p.getByRole("tab", { name: "Report" }).click();
await state(p, () => window.__twin.getState().setCam("overview"));
await p.waitForTimeout(4500);
await p.screenshot({ path: `${OUT}/3_after_approval_report.png` }); shots.push("3_after_approval_report.png");
await p.close();

// 4 · night: downtown celebration (hypothetical scenario), Burj Khalifa/Dubai Mall over the line
p = await page("/");
await state(p, () => window.__twin.getState().selectEvent("downtown_night"));
await ready(p);
await p.waitForTimeout(800);
await state(p, () => { const t = window.__twin; t.getState().focusLandmark("burj"); });
await p.waitForTimeout(5500);
await p.screenshot({ path: `${OUT}/4_night_downtown.png` }); shots.push("4_night_downtown.png");
await p.close();

// 5 · Arabic, right to left, with the break-point card
p = await page("/?lang=ar");
await state(p, () => { const t = window.__twin; t.setState({ time: 15.75, tab: "station", selected: "WTC" }); t.getState().setCam("overview"); });
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/5_arabic_view.png` }); shots.push("5_arabic_view.png");
await p.close();

// 6 · break point in English (Station tab)
p = await page("/");
await state(p, () => { const t = window.__twin; t.setState({ tab: "station", selected: "WTC" }); t.getState().setCam("close"); });
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/6_break_point.png` }); shots.push("6_break_point.png");
await p.close();

await browser.close();
console.log("written", shots.length, "screenshots to", OUT);

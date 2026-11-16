// Screenshots of the agent team on screen (docs/15): the workspace "AI team" tab mid-run and after it, and the kiosk's
// "watch the AI team work" step.   node tests/team_shots.mjs [base url]   → eval/results/ui/team/*.png
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = path.resolve(import.meta.dirname, "../../../eval/results/ui/team");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const errors = [];
const shot = async (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

// workspace
let page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); } catch { /* ignore */ } });
await page.goto(`${base}/?scene=v1`);
await page.waitForFunction(() => window.__twin?.getState().ready && !window.__twin.getState().loading, null, { timeout: 120000 });
await page.evaluate(() => window.__twin.getState().patchScenario({ weather: "hot" }));
await page.waitForFunction(() => !window.__twin.getState().loading, null, { timeout: 60000 });
await page.getByRole("tab", { name: /AI team/ }).click();
await page.getByTestId("team-run").click();
await page.waitForFunction(() => window.__twin.getState().missionShown >= 12, null, { timeout: 60000 });
await shot(page, "workspace_team_running");
await page.waitForFunction(() => window.__twin.getState().planStatus === "ready", null, { timeout: 60000 });
await page.waitForTimeout(800);
await shot(page, "workspace_team_done");
await page.locator(".tabpanel").evaluate((el) => { el.scrollTop = 900; });
await page.waitForTimeout(300);
await shot(page, "workspace_team_checks");
await page.locator(".tabpanel").evaluate((el) => { el.scrollTop = 4000; });
await page.waitForTimeout(300);
await shot(page, "workspace_team_scorecard");
await page.getByRole("tab", { name: /AI plan/ }).click();
await page.waitForTimeout(300);
await shot(page, "workspace_ai_tab_stress_badges");
await page.close();

// kiosk
page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(`${base}/?kiosk=1&scene=v1`);
await page.waitForFunction(() => window.__twin?.getState().ready, null, { timeout: 120000 });
await page.evaluate(() => window.__twin.getState().patchScenario({ weather: "hot" }));
await page.waitForFunction(() => !window.__twin.getState().loading, null, { timeout: 60000 });
await page.evaluate(() => { void window.__twin.getState().runAgents("en"); });
await page.waitForTimeout(400);
await shot(page, "kiosk_state_check");
await page.close();
await browser.close();
console.log(JSON.stringify({ out: OUT, errors }));

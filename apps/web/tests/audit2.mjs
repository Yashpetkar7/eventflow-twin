// UI audit, second pass (docs/16 section 2C, decision #130): pictures and a few measured checks of the views that the
// Playwright suite does not look at one by one. Needs the API on :8000 and the web app running.
//   node tests/audit2.mjs [base url]      → eval/results/ui/audit2/*.jpg + audit2.json
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = path.resolve(import.meta.dirname, "../../../eval/results/ui/audit2");
fs.mkdirSync(OUT, { recursive: true });
const LANDMARKS = ["burj", "mall", "mof", "et", "difc", "dwtc", "frame", "canal", "fountain", "address", "skyview", "zaabeel", "arena", "arab"];
const TIMES = [[15.83, "day"], [21.5, "night"]];
const report = { base, when: new Date().toISOString(), checks: {}, console_errors: [] };
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); } catch { /* ignore */ } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") report.console_errors.push(m.text().slice(0, 200)); });
const ready = async () => {
  await page.waitForFunction(() => { const s = window.__twin?.getState(); return s?.ready && s.sceneReady; }, null, { timeout: 120000 });
  await page.waitForFunction(() => { const [a, b] = (document.documentElement.dataset.sceneV2 ?? "1/1").split("/"); return a === b; }, null, { timeout: 180000 });
};
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 72 });
const overflow = () => page.evaluate(() => ({ w: document.documentElement.scrollWidth, vw: window.innerWidth, h: document.documentElement.scrollHeight, vh: window.innerHeight }));
const settled = () => page.waitForFunction(() => !window.__twin.getState().loading);

// ---- workspace: overview, the fourteen landmarks and the six stations in close-up, by day and by night
await page.goto(base + "/");
await ready();
const stations = await page.evaluate(() => window.__twin.getState().stations.map((s) => s.id));
for (const [time, tag] of TIMES) {
  await page.evaluate((t) => { const s = window.__twin; s.setState({ time: t, playing: false }); s.getState().setCam("overview"); }, time);
  await page.waitForTimeout(5000);
  await shot(`overview_${tag}`);
  for (const k of LANDMARKS) {
    await page.evaluate((key) => window.__twin.getState().focusLandmark(key), k);
    await page.waitForTimeout(3800);
    await shot(`lm_${k}_${tag}`);
  }
  for (const id of stations) {
    await page.evaluate((x) => { const s = window.__twin.getState(); s.select(x); s.setCam("close"); }, id);
    await page.waitForTimeout(3800);
    await shot(`station_${id}_${tag}`);
  }
}

// ---- workspace: the duty shift, the debate card and the operations brief (open, print, Escape, close button, Arabic)
await page.evaluate(() => { const s = window.__twin; s.setState({ tab: "alerts" }); s.getState().setCam("overview"); });
await page.locator('[data-incident="train_fault"]').click();
await page.waitForTimeout(600); await settled();
await page.getByTestId("duty-start").click();
await page.getByTestId("duty-item").waitFor({ timeout: 60000 });
await shot("duty_inbox");
await page.getByTestId("duty-approve").click();
await page.getByTestId("duty-done").waitFor({ timeout: 60000 });
await page.getByTestId("duty-brief").click();
await page.getByTestId("brief").waitFor();
await shot("brief_en");
await page.emulateMedia({ media: "print" });
await page.screenshot({ path: path.join(OUT, "brief_print_preview.jpg"), type: "jpeg", quality: 72, fullPage: true });
const pdf = await page.pdf({ format: "A4" });
report.checks.brief_print = { pdf_bytes: pdf.length, pages: (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length };
await page.emulateMedia({ media: "screen" });
await page.keyboard.press("Escape");
report.checks.brief_escape_closes = (await page.getByTestId("brief").count()) === 0;
await page.getByTestId("duty-brief").click();
await page.getByTestId("brief-close").click();
report.checks.brief_button_closes = (await page.getByTestId("brief").count()) === 0;
await page.evaluate(() => window.__twin.setState({ tab: "team" }));
await page.waitForTimeout(1200);
await shot("debate_en");
await page.getByRole("button", { name: "عربي" }).click();
await page.waitForTimeout(1500);
await page.evaluate(() => window.__twin.setState({ tab: "alerts" }));
await page.getByTestId("duty-brief").click();
report.checks.brief_arabic_dir = await page.getByTestId("brief").getAttribute("dir");
await shot("brief_ar");
await page.getByTestId("brief-close").click();
await shot("duty_done_ar");

// ---- tablet width (768 px): workspace and kiosk
await page.getByRole("button", { name: "English" }).click().catch(() => {});
await page.setViewportSize({ width: 768, height: 1024 });
await page.waitForTimeout(2500);
report.checks.tablet_workspace = await overflow();
await page.screenshot({ path: path.join(OUT, "tablet_workspace.jpg"), type: "jpeg", quality: 72, fullPage: true });
await page.goto(base + "/?kiosk=1&idle=600");
await ready();
await page.waitForTimeout(2500);
report.checks.tablet_kiosk_attract = await overflow();
await shot("tablet_kiosk_attract");
await page.getByTestId("kiosk-start").click();
await page.getByTestId("kiosk-planner").click();
await page.waitForTimeout(1500);
report.checks.tablet_kiosk_event = await overflow();
await shot("tablet_kiosk_event");

// ---- kiosk, planner journey in Arabic with larger text and high contrast, through the new train-fault step
await page.setViewportSize({ width: 1920, height: 1080 });
await page.goto(base + "/?kiosk=1&idle=600");
await ready();
await page.locator(".klang").click();
await page.getByTestId("kiosk-start").click();
await page.getByTestId("kiosk-planner").click();
await page.locator(".kseg button").nth(1).click();                            // hot day
await page.waitForTimeout(700); await settled();
await page.locator(".kcard > .kgo").click();
await page.locator(".kquiz button").first().click();
await page.locator(".kverdict").waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
await shot("kiosk_ar_reveal");
await page.locator(".kstack .kgo:not(.ghost)").click();
await page.locator(".kcard > .kgo.ghost").click();                            // "not sure, ask the AI"
await page.locator(".kopt").first().waitFor({ timeout: 40000 });
await shot("kiosk_ar_plan");
await page.locator(".kopt .kgo").first().click();
await page.waitForFunction(() => document.querySelector('[data-testid="kiosk"]').dataset.phase === "decide", null, { timeout: 20000 });
await page.waitForTimeout(1500);
await shot("kiosk_ar_decide");
const fits = () => page.evaluate(() => [...document.querySelectorAll(".kcard button")].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { text: b.innerText.slice(0, 30), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right), left: Math.round(r.left) }; }));
report.checks.kiosk_ar_decide_buttons = await fits();
await page.getByTestId("kiosk-duty-ask").click();
await page.getByTestId("kiosk-duty-go").click();
await page.waitForFunction(() => document.querySelector('[data-testid="kiosk-duty"]')?.dataset.view === "decision", null, { timeout: 60000 });
await page.locator(".ktools .kpill").first().click();                         // larger text
await page.waitForTimeout(800);
await shot("kiosk_ar_duty_large_text");
report.checks.kiosk_duty_large_text_buttons = await fits();
report.checks.kiosk_duty_large_text_card = await page.evaluate(() => { const c = document.querySelector(".kcard"); return { scroll: c.scrollHeight, client: c.clientHeight }; });
await page.getByTestId("kiosk-contrast").click();
await page.waitForTimeout(800);
await shot("kiosk_ar_duty_large_text_contrast");
await page.locator(".ktools .kpill").first().click();                         // back to normal text, contrast stays
await page.locator(".klang").click();
await page.waitForTimeout(800);
await shot("kiosk_en_duty_contrast");
await page.getByTestId("kiosk-duty-approve").click();
await page.waitForFunction(() => document.querySelector('[data-testid="kiosk-duty"]')?.dataset.view === "result", null, { timeout: 60000 });
await page.waitForTimeout(1200);
await shot("kiosk_en_duty_result_contrast");

fs.writeFileSync(path.join(OUT, "audit2.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.checks, null, 1));
console.log("console errors:", [...new Set(report.console_errors)].slice(0, 6));
await browser.close();

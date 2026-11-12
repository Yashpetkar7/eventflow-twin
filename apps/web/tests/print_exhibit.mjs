// Print the booth material (task K8): captures a high-resolution hero image of the 3D twin from the running app,
// then prints exhibit/poster/poster.html (A1) and the two A4 handouts to PDF.
//   node tests/print_exhibit.mjs [base url]      (API + web running; default http://localhost:3000)
// Normally run through `python scripts/build_exhibit_print.py`, which also makes the QR code.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const base = process.argv[2] ?? "http://localhost:3000";
const DIR = path.resolve(import.meta.dirname, "../../../exhibit/poster");
fs.mkdirSync(path.join(DIR, "img"), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });

// 1 · hero: the 3D view only (HUD hidden, OpenStreetMap attribution kept), golden hour, 2× pixel density
const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await p.goto(base + "/");
await p.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
await p.evaluate(() => { const t = window.__twin; t.setState({ time: 17.25, tab: "station", selected: "WTC" }); t.getState().setCam("overview"); });
await p.addStyleTag({ content: ".clock,.kpis,.mapctl,.viewbottom,.camtools,.legend,.hudcol,.focuschip,.banner{display:none!important}" });
await p.waitForTimeout(6000);
await p.locator(".view").first().screenshot({ path: path.join(DIR, "img/hero.png") });
// close-ups: the break-point card (normal day), then the top AI option on a hot day
await p.getByRole("tab", { name: "Station" }).click();
await p.waitForTimeout(800);
await p.locator(".card.brk").first().screenshot({ path: path.join(DIR, "img/break.png") });
await p.getByRole("button", { name: "Hot day" }).click();
await p.waitForFunction(() => window.__twin.getState().forecast?.weather === "hot" && !window.__twin.getState().loading);
await p.getByRole("tab", { name: /AI plan/ }).click();
await p.getByRole("button", { name: "Plan with AI agents" }).click();
await p.locator(".opt").first().waitFor({ timeout: 30000 });
await p.waitForTimeout(800);
await p.locator(".opt").first().screenshot({ path: path.join(DIR, "img/option.png") });
await p.close();
// the Arabic interface, right to left
const ar = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await ar.goto(base + "/?lang=ar");
await ar.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });
await ar.evaluate(() => { const t = window.__twin; t.setState({ time: 15.75, tab: "station", selected: "WTC" }); t.getState().setCam("overview"); });
await ar.waitForTimeout(5000);
await ar.screenshot({ path: path.join(DIR, "img/arabic.png") });
await ar.close();

// 2 · print the HTML pages (fonts and images load from the repo)
const pdf = async (file, out, size) => {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(DIR, file)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await page.pdf({ path: path.join(DIR, out), printBackground: true, ...size, pageRanges: "1" });
  await page.screenshot({ path: path.join(DIR, "img", out.replace(".pdf", "_preview.png")), fullPage: true });
  await page.close();
  console.log("written", path.join("exhibit/poster", out));
};
await pdf("poster.html", "EventFlow_Twin_A1_poster.pdf", { width: "594mm", height: "841mm" });
await pdf("handout_en.html", "EventFlow_Twin_A4_handout_EN.pdf", { width: "210mm", height: "297mm" });
await pdf("handout_ar.html", "EventFlow_Twin_A4_handout_AR.pdf", { width: "210mm", height: "297mm" });
await browser.close();

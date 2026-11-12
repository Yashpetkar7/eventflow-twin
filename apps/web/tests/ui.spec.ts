// Exhibit UI checks + the screenshots required by the F1 acceptance (eval/results/ui/).
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../eval/results/ui");
fs.mkdirSync(OUT, { recursive: true });

type TwinState = { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean };
type TwinWindow = Window & { __twin: { getState: () => TwinState; setState: (s: object) => void }; __eft?: { fps: number; frames: number } };

async function open(page: Page, url = "/") {
  await page.goto(url);
  await page.waitForFunction(() => { const s = (window as unknown as TwinWindow).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
}
const settle = (page: Page, ms = 3500) => page.waitForTimeout(ms);
const twin = (page: Page, fn: string) => page.evaluate(`(() => { const t = window.__twin; ${fn} })()`);
const idle = (page: Page) => page.waitForFunction(() => !(window as unknown as TwinWindow).__twin.getState().loading);

test("workspace EN, day", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("synthetic-badge")).toBeVisible();          // SYNTHETIC label whenever is_synthetic
  await expect(page.locator(".kpi").first()).toContainText("%");
  await settle(page);
  await page.screenshot({ path: `${OUT}/workspace_en_day.png` });
});

test("workspace EN, golden hour and night", async ({ page }) => {
  await open(page);
  await twin(page, "t.setState({ time: 17.2 })");
  await settle(page);
  await page.screenshot({ path: `${OUT}/workspace_en_golden_hour.png` });
  await twin(page, "t.getState().selectEvent('downtown_night')");
  await idle(page);
  await settle(page, 5000);
  await expect(page.locator(".hud")).toHaveClass(/night/);
  await page.screenshot({ path: `${OUT}/workspace_en_night.png` });
  await twin(page, "t.getState().setCam('close')");
  await settle(page, 5000);
  await page.screenshot({ path: `${OUT}/station_closeup_night.png` });
});

test("workspace AR (RTL), day and night", async ({ page }) => {
  await open(page, "/?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".tabs")).toContainText("المحطة");
  await settle(page);
  await page.screenshot({ path: `${OUT}/workspace_ar_day.png` });
  await twin(page, "t.getState().selectEvent('downtown_night')");
  await idle(page);
  await settle(page, 5000);
  await page.screenshot({ path: `${OUT}/workspace_ar_night.png` });
});

test("kiosk mode: touch targets ≥ 48 px, no context menu", async ({ page }) => {
  await open(page, "/?kiosk=1&idle=600");
  await expect(page.locator("body")).toHaveClass(/kiosk/);
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button, select, input[type=range], .checks label")]
    .filter((el) => el.offsetParent !== null && !el.closest(".labels"))
    .map((el) => ({ el: `${el.tagName}.${el.className}:${(el.textContent ?? "").trim().slice(0, 20)}`, h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
    .filter((x) => x.h < 48 || x.w < 44));
  expect(small, JSON.stringify(small)).toEqual([]);
  const prevented = await page.evaluate(() => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; });
  expect(prevented).toBe(true);
  await settle(page);
  await page.screenshot({ path: `${OUT}/kiosk.png` });
});

test("demo flow: hot day → agents → approve → re-simulated → report", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Hot day" }).click();
  await idle(page);
  await expect(page.locator(".kpi").nth(1)).not.toHaveText(/^0Over/);                         // station-hours over threshold > 0
  await page.getByRole("tab", { name: /AI plan/ }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await expect(page.locator(".opt")).toHaveCount(3, { timeout: 20_000 });
  await expect(page.locator(".agent-steps li.done")).toHaveCount(8);
  await expect(page.locator(".opt").first().locator(".verify")).toContainText("figures match the simulator");
  await twin(page, "t.getState().setCam('close')");
  await settle(page, 4000);
  await page.screenshot({ path: `${OUT}/ai_options_station_closeup.png` });
  await page.locator(".opt").first().getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".kpi").nth(3)).toContainText("1");                              // plans applied
  await expect(page.locator(".kpi").nth(1).locator("b")).toHaveText("0");                    // back under the threshold
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.locator(".log li")).toHaveCount(1);
  await expect(page.locator(".log")).toContainText("approved");
  await expect(page.getByText("Evidence")).toBeVisible();
  await settle(page, 1500);
  await page.screenshot({ path: `${OUT}/report_after_approval.png` });
});

test("guided demo runs end to end and logs its approval as guided-demo", async ({ page, request }) => {
  await open(page);
  const before = (await (await request.get("http://localhost:8000/decisions?limit=1")).json()).total;
  await page.getByRole("button", { name: "Guided demo" }).click();
  await expect(page.locator(".tour")).toContainText("GITEX Global 2025");
  await expect(page.locator(".tour")).toContainText("hot day", { timeout: 30_000 });
  await expect(page.locator(".tour")).toContainText("stay in charge", { timeout: 40_000 });
  await expect(page.locator(".kpi").nth(3)).toContainText("1", { timeout: 20_000 });
  await expect(page.locator(".tour")).toHaveCount(0, { timeout: 30_000 });
  const log = await (await request.get("http://localhost:8000/decisions?limit=1")).json();
  expect(log.total).toBe(before + 1);
  expect(log.items[0].user).toBe("guided-demo");
});

test("my plan: live preview from /simulate, approve", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Rain" }).click();
  await idle(page);
  await page.getByRole("tab", { name: "My plan" }).click();
  await page.locator(".ctl").nth(0).getByRole("button", { name: /3 min/ }).first().click();
  await expect(page.getByText("Effect of your plan")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Approve my plan" }).click();
  await expect(page.locator(".kpi").nth(3)).toContainText("1");
});

test("table view and WebGL fallback", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator("table.data tbody tr")).toHaveCount(6);
  await page.screenshot({ path: `${OUT}/table_view.png` });
  // no WebGL at all → table view with a clear message
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; });
  await open(page);
  await expect(page.locator("table.data tbody tr")).toHaveCount(6);
  await expect(page.getByText("3D needs WebGL")).toBeVisible();
  await page.screenshot({ path: `${OUT}/webgl_fallback.png` });
});

test("offline: no request leaves localhost", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { const h = new URL(r.url()).hostname; if (!["localhost", "127.0.0.1"].includes(h) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url()); });
  await open(page);
  await page.getByRole("tab", { name: /AI plan/ }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await settle(page, 4000);
  await page.getByRole("button", { name: "عربي" }).click();
  await settle(page, 1500);
  fs.writeFileSync(`${OUT}/network.json`, JSON.stringify({ external_requests: external, checked: new Date().toISOString() }, null, 2));
  expect(external).toEqual([]);
});

test("API down: saved results keep the twin alive", async ({ page }) => {
  await page.route("http://localhost:8000/**", (r) => r.abort());
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as TwinWindow).__twin?.getState().ready, null, { timeout: 60_000 });
  await expect(page.locator(".banner")).toContainText("not reachable");
  await expect(page.locator(".kpi").first()).toContainText("%");
});

test("performance: fps with every layer on (1920×1080)", async ({ page }) => {
  await open(page);
  await twin(page, "t.setState({ playing: true, speed: 1 })");
  const samples: Record<string, number[]> = {};
  for (const cam of ["overview", "close", "top", "fly", "orbit"]) {
    await twin(page, `t.getState().setCam('${cam}')`);
    await page.waitForTimeout(3000);
    samples[cam] = [];
    for (let i = 0; i < 5; i++) { await page.waitForTimeout(1000); samples[cam].push(await page.evaluate(() => (window as unknown as TwinWindow).__eft?.fps ?? 0)); }
  }
  const all = Object.values(samples).flat(), avg = all.reduce((a, b) => a + b, 0) / all.length;
  const info = await page.evaluate(() => { const c = document.createElement("canvas").getContext("webgl2"); const e = c?.getExtension("WEBGL_debug_renderer_info"); return { renderer: e ? c!.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown", dpr: devicePixelRatio, canvas: [document.querySelector("canvas")!.width, document.querySelector("canvas")!.height] }; });
  fs.writeFileSync(`${OUT}/fps.json`, JSON.stringify({ suite: "ui_fps", timestamp: new Date().toISOString(), viewport: "1920x1080", layers: "all on, clock playing", mode: process.env.EFT_MODE ?? "next dev",
    avg_fps: +avg.toFixed(1), min_fps: +Math.min(...all).toFixed(1), per_camera: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)])), ...info }, null, 2));
  expect(avg).toBeGreaterThanOrEqual(50);
});

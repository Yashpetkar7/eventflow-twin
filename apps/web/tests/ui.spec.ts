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

test("recentre brings the 3D view back after dragging and zooming", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Top-down" }).click();
  const box = (await page.locator(".view canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 240, box.y + box.height / 2 + 90, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -600);
  const cam = () => page.evaluate(() => (window as unknown as { __twin: { getState: () => { cam: string } } }).__twin.getState().cam);
  expect(await cam()).toBe("free");
  await expect(page.locator(".mapctl button").first()).toHaveClass(/moved/);
  await page.getByRole("button", { name: "Recentre" }).click();
  expect(await cam()).toBe("top");                                   // back to the preset that was active
  await page.keyboard.press("Home");
  expect(await cam()).toBe("top");
});

test("landmarks: tap one and the camera frames it with its area", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Landmarks/ }).click();
  await page.locator(".lmmenu").getByRole("button", { name: "Burj Khalifa" }).click();
  await expect(page.locator(".focuschip")).toContainText("Burj Khalifa");
  await expect(page.locator(".focuschip")).toContainText("Nearest station: Burj Khalifa/Dubai Mall");
  await settle(page, 4500);
  await page.screenshot({ path: `${OUT}/landmark_burj_khalifa.png` });
  // a landmark label in the 3D view is tappable too
  await page.locator(".labels .tag.lm", { hasText: "The Dubai Mall" }).click();
  await expect(page.locator(".focuschip")).toContainText("The Dubai Mall");
  // full-width map and back
  await page.getByRole("button", { name: "Full-width map" }).click();
  await expect(page.locator(".rail")).toBeHidden();
  await settle(page, 1500);
  await page.screenshot({ path: `${OUT}/full_width_map.png` });
  await page.keyboard.press("Escape");
  await expect(page.locator(".rail")).toBeVisible();
  await page.locator(".focuschip button").click();
  await expect(page.locator(".focuschip")).toHaveCount(0);
});

test("overlays never overlap each other or the labels (wide and narrow)", async ({ page }) => {
  for (const [w, h] of [[1920, 1080], [1280, 800], [860, 1000], [545, 1100], [420, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
    await settle(page, 2500);
    const clash = await page.evaluate(() => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const hits = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const panels = [...document.querySelectorAll("[data-overlay]")].filter((e) => rect(e).width > 0);
      const labels = [...document.querySelectorAll(".labels .tag")].filter((e) => { const r = rect(e); return r.right > 0 && r.bottom > 0 && r.width > 0; });
      const out: string[] = [];
      panels.forEach((a, i) => panels.slice(i + 1).forEach((b) => { if (hits(rect(a), rect(b))) out.push(`${a.className} × ${b.className}`); }));
      labels.forEach((l) => panels.forEach((p) => { if (hits(rect(l), rect(p))) out.push(`label "${l.textContent}" × ${p.className}`); }));
      return out;
    });
    expect(clash, `${w}×${h}: ${clash.join("; ")}`).toEqual([]);
  }
});

test("quality tier steps down when the frame rate stays under 40 fps", async ({ page }) => {
  await open(page);
  await page.waitForFunction(() => ((window as unknown as TwinWindow).__eft?.frames ?? 0) > 500);     // past the warm-up
  expect(await page.locator(".view").getAttribute("data-tier")).toBe("0");
  await twin(page, "t.setState({ fpsOverride: 30 })");
  await expect(page.locator(".view")).toHaveAttribute("data-tier", "1", { timeout: 8000 });
  await expect(page.locator(".view")).toHaveAttribute("data-tier", "2", { timeout: 8000 });
  await twin(page, "t.setState({ fpsOverride: null })");
  await settle(page, 2000);
  await expect(page.locator(".kpi").first()).toContainText("%");                                      // still rendering and usable
  await page.screenshot({ path: `${OUT}/quality_tier_2.png` });
});

test("crash recovery: API drops mid-session, saved results stay, banner clears on reconnect", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Hot day" }).click();
  await idle(page);
  await page.route("http://localhost:8000/**", (r) => r.abort());
  await page.getByRole("button", { name: "Normal", exact: true }).click();        // answered from the saved results
  await expect(page.locator(".banner:not(.demo)")).toContainText("not reachable", { timeout: 10_000 });
  await expect(page.locator(".kpi").first()).toContainText("%");
  await page.unroute("http://localhost:8000/**");
  await expect(page.locator(".banner:not(.demo)")).toHaveCount(0, { timeout: 15_000 });      // health check every 4 s reconnects
});

test("every simulate and plan request carries the forecast spec (stateless API)", async ({ page }) => {
  const bodies: { url: string; body: { forecast?: unknown } }[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/(simulate|agent\/plan)$/.test(r.url())) bodies.push({ url: r.url(), body: r.postDataJSON() }); });
  await open(page);
  await page.getByRole("button", { name: "Hot day" }).click();
  // wait until the hot-day forecast has replaced the old one (a refresh clears any plan in progress)
  await page.waitForFunction(() => (window as unknown as { __twin: { getState: () => { forecast: { weather: string } | null; loading: boolean } } }).__twin.getState().forecast?.weather === "hot"
    && !(window as unknown as { __twin: { getState: () => { loading: boolean } } }).__twin.getState().loading);
  await page.getByRole("tab", { name: /AI plan/ }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await expect(page.locator(".opt")).toHaveCount(3, { timeout: 20_000 });
  expect(bodies.length).toBeGreaterThan(2);
  for (const b of bodies) expect(b.body.forecast, b.url).toBeTruthy();
  expect(bodies.at(-1)!.body.forecast).toMatchObject({ weather: "hot" });
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
  await expect(page.locator(".banner:not(.demo)")).toContainText("not reachable");
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

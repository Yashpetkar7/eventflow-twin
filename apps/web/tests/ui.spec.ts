// Exhibit UI checks + the screenshots required by the F1 acceptance (eval/results/ui/).
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../eval/results/ui");
const API = `http://localhost:${process.env.EFT_API_PORT ?? 8000}`;      // a second checkout runs its own API (playwright.config.ts)
fs.mkdirSync(OUT, { recursive: true });

type TwinState = { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean };
type TwinWindow = Window & { __twin: { getState: () => TwinState; setState: (s: object) => void }; __eft?: { fps: number; frames: number } };

async function open(page: Page, url = "/") {
  // on a public link the first-visit welcome sheet covers the page: only the test that asks for it (?welcome=1) sees it
  await page.addInitScript(() => { try { if (!window.location.search.includes("welcome=1")) sessionStorage.setItem("eft_welcome", "1"); } catch { /* ignore */ } });
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

test("classic kiosk (?kiosk=classic): touch targets ≥ 48 px, no context menu", async ({ page }) => {
  await open(page, "/?kiosk=classic&idle=600");
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
  const before = (await (await request.get(`${API}/decisions?limit=1`)).json()).total;
  await page.getByRole("button", { name: "Guided demo" }).click();
  await expect(page.locator(".tour")).toContainText("GITEX Global 2025");
  await expect(page.locator(".tour")).toContainText("hot day", { timeout: 30_000 });
  await expect(page.locator(".tour")).toContainText("stay in charge", { timeout: 40_000 });
  await expect(page.locator(".kpi").nth(3)).toContainText("1", { timeout: 20_000 });
  await expect(page.locator(".tour")).toHaveCount(0, { timeout: 30_000 });
  const log = await (await request.get(`${API}/decisions?limit=1`)).json();
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
  await page.route(`${API}/**`, (r) => r.abort());
  await page.getByRole("button", { name: "Normal", exact: true }).click();        // answered from the saved results
  await expect(page.locator(".banner:not(.demo)")).toContainText("not reachable", { timeout: 10_000 });
  await expect(page.locator(".kpi").first()).toContainText("%");
  await page.unroute(`${API}/**`);
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

test("break point: the Station tab says at what crowd size the station crosses the line", async ({ page, request }) => {
  await open(page);
  const card = page.getByTestId("break-card");
  await expect(card).toBeVisible();
  // the number on screen is the API's number for the selected station
  const st = await page.evaluate(() => (window as unknown as { __twin: { getState: () => { selected: string; breaks: { stations: { station_id: string; break_attendance: number | null }[] } } } }).__twin.getState());
  const expected = st.breaks.stations.find((s) => s.station_id === st.selected)!.break_attendance!;
  await expect(card).toContainText(expected.toLocaleString("en-GB"));
  await expect(card.locator(".brk-g")).toHaveCount(5);
  await expect(card.locator(".brk-g.def")).toContainText("35%");
  // an unserved station says so instead of showing a number
  await page.locator(".tabpanel").getByRole("button", { name: "Business Bay" }).click();
  await expect(card).toContainText("sends no metro trips");
  await page.locator(".tabpanel").getByRole("button", { name: "World Trade Centre" }).click();
  await settle(page, 1200);
  await page.screenshot({ path: `${OUT}/break_point_card.png` });
  const api = await request.get(`${API}/healthz`);
  const version = fs.readFileSync(path.resolve(__dirname, "../../../contract/VERSION"), "utf8").trim();
  expect((await api.json()).contract).toBe(version);
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

test("phone: map first, events then the panel, no sideways scroll, footer at the end", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  await settle(page, 1500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const view = (await page.locator(".view").boundingBox())!;
  expect(view.y).toBeLessThan(120);
  expect(view.height).toBeGreaterThan(400);
  const events = (await page.locator(".rail > :first-child").boundingBox())!;
  const panel = (await page.locator(".panel").boundingBox())!;
  expect(events.y).toBeGreaterThan(view.y + view.height);
  expect(panel.y).toBeGreaterThan(events.y);
  await expect(page.locator(".kioskbtn")).toBeHidden();
  const ftr = (await page.locator(".ftr").boundingBox())!;
  expect(ftr.y).toBeGreaterThan(panel.y);                       // not pinned over the content
  await page.screenshot({ path: path.join(OUT, "phone_375.png"), fullPage: false });
});

test("My plan: entry metering shows the waiting-time trade-off", async ({ page }) => {
  await open(page);
  await twin(page, "t.getState().selectEvent('downtown_night');");
  await idle(page);
  await page.getByRole("tab", { name: "My plan" }).click();
  await page.getByRole("button", { name: "85%" }).click();
  await expect(page.getByText(/Longest wait/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "until 03:00" }).click();
  await expect(page.getByText(/Riders arriving while the metro is closed/)).toBeVisible({ timeout: 15_000 });
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

test("workspace: the left column opens on the scenario; Settings holds the rarely used controls; a phone shows both", async ({ page }) => {
  await open(page);
  await expect(page.locator("#att")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hot day" })).toBeVisible();
  await expect(page.locator("#thr")).toBeHidden();                              // planning settings and 3D layers are one tap away
  await expect(page.locator(".rail .checks")).toBeHidden();
  const rail = page.locator(".rail");
  expect(await rail.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);    // the column no longer scrolls at 1080p
  await page.getByTestId("rail-settings").click();
  await expect(page.locator("#thr")).toBeVisible();
  await expect(page.locator("#exitSig")).toBeVisible();
  await expect(page.locator(".rail .checks")).toBeVisible();
  await expect(page.locator("#att")).toBeHidden();
  await settle(page, 800);
  await page.screenshot({ path: `${OUT}/workspace_settings_tab.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator("#att")).toBeVisible();
  await expect(page.locator("#thr")).toBeVisible();
  await expect(page.locator(".railtabs")).toBeHidden();
});

test("public link: the welcome sheet offers the visitor story; the Report tab prints a one-page brief", async ({ page }) => {
  await open(page, "/?welcome=1");
  const sheet = page.getByTestId("welcome");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Not an RTA system");
  await page.screenshot({ path: `${OUT}/welcome_sheet.png` });
  await sheet.getByRole("button", { name: "Open the planner workspace" }).click();
  await expect(sheet).toBeHidden();
  await page.locator("#tab-report").click();
  await expect(page.getByTestId("print-brief")).toBeVisible();
  await page.emulateMedia({ media: "print" });                                 // what "Print / save as PDF" puts on paper
  await expect(page.locator(".stage")).toBeHidden();
  await expect(page.locator(".rail")).toBeHidden();
  await expect(page.locator(".tabpanel .score").first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.goto("/?welcome=1");
  await page.getByTestId("welcome-story").click();
  await expect(page.getByTestId("kiosk")).toBeVisible({ timeout: 60_000 });    // the story button opens the visitor kiosk
});

test("API down: saved results keep the twin alive", async ({ page }) => {
  await page.route(`${API}/**`, (r) => r.abort());
  await page.goto("/");
  await page.waitForFunction(() => (window as unknown as TwinWindow).__twin?.getState().ready, null, { timeout: 60_000 });
  await expect(page.locator(".banner:not(.demo)")).toContainText("not reachable");
  await expect(page.locator(".kpi").first()).toContainText("%");
});

test("realism ring (?scene=v2): every chunk streams in offline and the credits list each dataset", async ({ page }) => {
  const external: string[] = [], failed: string[] = [];
  page.on("request", (r) => { const h = new URL(r.url()).hostname; if (!["localhost", "127.0.0.1"].includes(h) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  page.on("response", (r) => { if (/\/(geo\/v2|models|draco)\//.test(r.url()) && !r.ok()) failed.push(r.url()); });
  const shaderErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && /shader|WebGLProgram|GLSL/i.test(m.text())) shaderErrors.push(m.text().slice(0, 300)); });
  await open(page, "/?scene=v2");
  await page.waitForFunction(() => document.documentElement.dataset.sceneV2 === "16/16", null, { timeout: 120_000 });
  expect(await page.evaluate(() => document.documentElement.dataset.sceneV2Builder)).toBe("worker");
  expect(await page.evaluate(() => document.documentElement.dataset.sceneModels)).toBe("13");                // R4: every Blender model decoded (Draco, served locally)    // R3: geometry is built off the main thread
  await expect(page.getByTestId("synthetic-badge")).toBeVisible();
  await expect(page.locator(".labels, .label").first()).toBeAttached();         // station overlays still on top
  await page.getByTestId("credits").locator("summary").click();
  const rows = page.getByTestId("credits").locator("tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(8);
  for (const name of ["Overture Maps", "Sentinel-2", "ESA WorldCover", "Copernicus DEM", "3D-GloBFP", "ESTIMATED"]) await expect(page.getByTestId("credits")).toContainText(name);
  await settle(page, 2500);
  await page.screenshot({ path: `${OUT}/realism_v2_credits.png` });
  await page.getByTestId("credits").locator("summary").click();
  // R2: the sun comes from the scenario date (GITEX day 1, 13 Oct 2025) and the clock — solar noon ≈ 12:05, sunset ≈ 17:50
  // __eft is published about once a second of rendered frames; under load that is slower, so wait for two fresh
  // publishes after the clock change instead of a fixed time (a fixed 2.2 s read the default 15:30 sun in a full run)
  type Eft = { __eft: { frames: number; sun: { elevation: number; azimuth: number } } };
  const sunAt = async (h: number) => {
    await twin(page, `t.setState({ time: ${h}, playing: false })`);
    for (let i = 0; i < 2; i++) {
      const f0 = await page.evaluate(() => (window as unknown as Eft).__eft.frames);
      await page.waitForFunction((f) => (window as unknown as Eft).__eft.frames > f, f0, { timeout: 30_000 });
    }
    return page.evaluate(() => (window as unknown as Eft).__eft.sun);
  };
  const noon = await sunAt(12.09), dusk = await sunAt(17.83), night = await sunAt(21.5);
  expect(Math.abs(noon.elevation - 57.2), JSON.stringify(noon)).toBeLessThan(1.5);
  expect(Math.abs(noon.azimuth - 180), JSON.stringify(noon)).toBeLessThan(6);
  expect(Math.abs(dusk.elevation), JSON.stringify(dusk)).toBeLessThan(2);
  expect(dusk.azimuth).toBeGreaterThan(255); expect(dusk.azimuth).toBeLessThan(268);
  expect(night.elevation).toBeLessThan(-40);
  expect(shaderErrors, shaderErrors.join(" | ")).toEqual([]);                  // haze, ground and water shaders compiled, day and night
  expect(failed).toEqual([]);
  expect(external).toEqual([]);
  await twin(page, "t.setState({ playing: true, speed: 1 })");
  const fps: Record<string, number[]> = {};                                    // same protocol as the performance test below
  for (const cam of ["overview", "close", "top", "fly", "orbit"]) {
    await twin(page, `t.getState().setCam('${cam}')`);
    await page.waitForTimeout(3000);
    fps[cam] = [];
    for (let i = 0; i < 5; i++) { await page.waitForTimeout(1000); fps[cam].push(+(await page.evaluate(() => (window as unknown as TwinWindow).__eft?.fps ?? 0)).toFixed(1)); }
  }
  const all = Object.values(fps).flat();
  fs.writeFileSync(`${OUT}/fps_v2.json`, JSON.stringify({ suite: "ui_fps_v2", timestamp: new Date().toISOString(), viewport: "1920x1080", layers: "all on, clock playing, ?scene=v2", mode: process.env.EFT_MODE ?? "next dev",
    avg_fps: +(all.reduce((a, b) => a + b, 0) / all.length).toFixed(1), min_fps: Math.min(...all), tier_at_end: await page.evaluate(() => (window as unknown as { __eft?: { tier: number } }).__eft?.tier ?? -1), samples: fps }, null, 2));
  expect(Math.min(...all), JSON.stringify(fps)).toBeGreaterThanOrEqual(50);    // the floor of the common rules
});

test("realism R7 (?scene=v2): the shadow map is redrawn only when the sun, the view or a caster changes", async ({ page }) => {
  await open(page, "/?scene=v2");
  await page.waitForFunction(() => document.documentElement.dataset.sceneV2 === "16/16", null, { timeout: 120_000 });
  type Eft = { __eft: { frames: number; fps: number; tier: number; shadow_redraws: number; calls: number; triangles: number } };
  // shadow-map redraws over the next n publishes of __eft (one publish ≈ one second of frames)
  const redraws = async (n: number) => {
    let sum = 0, frames = 0;
    for (let i = 0; i < n; i++) {
      const f0 = await page.evaluate(() => (window as unknown as Eft).__eft.frames);
      await page.waitForFunction((f) => (window as unknown as Eft).__eft.frames > f, f0, { timeout: 30_000 });
      const e = await page.evaluate(() => (window as unknown as Eft).__eft);
      sum += e.shadow_redraws; frames += e.frames - f0;
    }
    return { sum, frames };
  };
  await twin(page, "t.setState({ time: 10, playing: false }); t.getState().setCam('overview')");
  await page.waitForTimeout(7000);                                             // camera tween and crowd columns come to rest
  await redraws(1);
  const still = await redraws(2);
  expect(still.sum, JSON.stringify(still)).toBe(0);                            // nothing changes: the map is kept
  expect(await page.evaluate(() => (window as unknown as Eft).__eft.tier)).toBe(0);
  const wide = await page.evaluate(() => (window as unknown as Eft).__eft.triangles);
  await twin(page, "t.setState({ time: 16.5 })");                              // the sun turns
  expect((await redraws(3)).sum).toBeGreaterThan(0);
  await twin(page, "t.setState({ layers: { ...t.getState().layers, buildings: false } })");      // casters hidden
  expect((await redraws(3)).sum).toBeGreaterThan(0);
  await twin(page, "t.setState({ layers: { ...t.getState().layers, buildings: true } })");
  await redraws(3);
  expect((await redraws(2)).sum).toBe(0);
  await twin(page, "t.getState().setCam('close')");                            // cars and trains cast here: every frame, as before
  await page.waitForTimeout(6000);
  const close = await redraws(2);
  expect(close.sum, JSON.stringify(close)).toBeGreaterThanOrEqual(close.frames - 2);
  expect(wide).toBeLessThan(2_000_000);                                        // 3.9 million before R7 (palms and the shadow pass)
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

test("AI tab: the critic's verdict, the goal badge and every tool call behind the plan", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Hot day" }).click();
  await idle(page);
  await expect(page.locator(".kpi").nth(1)).not.toHaveText(/^0Over/);                         // the hot-day forecast has arrived
  await page.getByRole("tab", { name: /AI plan/ }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await expect(page.locator(".opt").first()).toBeVisible({ timeout: 30_000 });
  const critic = page.getByTestId("critic");
  await expect(critic).toContainText(/Critic \(code\): (a plan on offer clears every station|no plan inside the allowed limits)/);
  await expect(critic).toContainText(/planning round/);
  const calls = page.getByTestId("tool-calls");
  await calls.locator("summary").click();
  const n = await page.evaluate(() => (window as unknown as { __twin: { getState: () => { plan: { trace: unknown[] } } } }).__twin.getState().plan.trace.length);
  expect(n).toBeGreaterThanOrEqual(10);
  await expect(calls.locator("li")).toHaveCount(n);
  await expect(calls).toContainText("verify_numbers");
  await expect(calls).toContainText("check_goal");
  const met = await page.evaluate(() => (window as unknown as { __twin: { getState: () => { plan: { options: { goal_met: boolean }[] } } } }).__twin.getState().plan.options.filter((o) => o.goal_met).length);
  await expect(page.getByTestId("goal-met")).toHaveCount(met);
});

test("realism scene: figures at the stations follow the simulator's riders, and the new shaders compile", async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on("console", (m) => { if (/THREE\.WebGLProgram|Shader Error|shader error/i.test(m.text())) shaderErrors.push(m.text().slice(0, 200)); });
  await open(page, "/?scene=v2");
  await page.waitForFunction(() => document.documentElement.dataset.sceneModels !== undefined, null, { timeout: 60_000 });
  type T = { __twin: { getState: () => { time: number; tier: number; cur: { by: Record<string, { demandH: number[] }> } | null; stations: { id: string }[]; selectEvent: (id: string) => void; setCam: (c: string) => void }; setState: (s: object) => void } };
  await page.evaluate(() => { const t = (window as unknown as T).__twin; t.getState().selectEvent("downtown_night"); });
  await idle(page);
  await page.evaluate(() => { const t = (window as unknown as T).__twin; t.setState({ time: 22.25, playing: false }); t.getState().setCam("close"); });
  await page.waitForTimeout(2500);
  const want = await page.evaluate(() => { const s = (window as unknown as T).__twin.getState(); return s.tier === 0 ? s.stations.reduce((n, st) => n + Math.min(220, Math.round((s.cur?.by[st.id]?.demandH[22] ?? 0) / 40)), 0) : -1; });
  if (want >= 0) {                                              // full quality: one figure for every 40 riders an hour, per station, capped
    expect(want).toBeGreaterThan(50);
    await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.sceneFigures ?? -1))).toBe(want);
  }
  await page.evaluate(() => { (window as unknown as T).__twin.setState({ time: 10 }); });       // day: curtain wall, room interiors and cloud shadows
  await page.waitForTimeout(2500);
  expect(shaderErrors, shaderErrors.join(" | ")).toEqual([]);
});

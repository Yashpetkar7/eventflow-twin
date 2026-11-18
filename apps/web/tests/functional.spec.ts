import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Every control does what it says (the Yash-stream functional pass): one click logs one decision, a destructive
// reset asks first, a plan can be stopped, the event chain survives a tab switch and its approvals reach the twin,
// failing services say so, the tabs work from the keyboard, and the report follows the language on screen.
type S = Record<string, unknown> & { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean; planStatus: string;
  applied: { title: string; chain?: string }[]; chain: { chain_id: string; applied: unknown[]; status: string } | null; plan: { options: unknown[] } | null };
type W = Window & { __twin: { getState: () => S & Record<string, (...a: unknown[]) => unknown> } };
const API = `http://localhost:${process.env.EFT_API_PORT ?? 8000}`;
const st = (page: Page) => page.evaluate(() => (window as unknown as W).__twin.getState() as unknown as S);

async function open(page: Page, lang: "en" | "ar" = "en") {
  await page.addInitScript((l) => { try { sessionStorage.setItem("eft_welcome", "1"); localStorage.setItem("eventflow.locale", l); } catch { /* ignore */ } }, lang);
  await page.goto("/");
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
  await page.evaluate(() => (window as unknown as W).__twin.getState().selectEvent("downtown_night"));
  await page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
  await page.evaluate(() => (window as unknown as W).__twin.getState().patchScenario({ attendance: 60000 }));
  await page.waitForTimeout(800);
  await page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
}
const planReady = (page: Page) => page.waitForFunction(() => (window as unknown as W).__twin.getState().planStatus === "ready", null, { timeout: 120_000 });

test("approve: a double click logs one decision and applies the plan once", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "AI plan" }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await planReady(page);
  let posts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/decisions")) posts++; });
  await page.getByTestId("opt-approve").first().dblclick();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().applied.length > 0);
  await page.waitForTimeout(1500);                                  // room for a second (wrong) request to arrive
  expect(posts).toBe(1);
  expect((await st(page)).applied).toHaveLength(1);
  await expect(page.locator(".kpi").nth(3)).toContainText("1");
});

test("clear approved plans: asks first, can be kept, then clears; disabled when there is nothing to clear", async ({ page }) => {
  await open(page);
  const clear = page.getByTestId("clear-plans");
  await expect(clear).toBeDisabled();
  await page.getByRole("tab", { name: "AI plan" }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await planReady(page);
  await page.getByTestId("opt-approve").first().click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().applied.length === 1);
  await clear.click();
  await expect(page.getByTestId("clear-confirm")).toContainText("Clear 1 approved plan?");
  await page.getByTestId("clear-confirm").getByRole("button", { name: "Keep them" }).click();
  expect((await st(page)).applied).toHaveLength(1);
  await clear.click();
  await page.getByTestId("clear-yes").click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().applied.length === 0);
  await expect(page.getByTestId("clear-plans")).toBeDisabled();
});

test("stop planning: the run stops, nothing it would still send is shown, nothing is logged", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "AI plan" }).click();
  let posts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/decisions")) posts++; });
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await page.getByTestId("plan-cancel").click();
  await expect(page.getByTestId("plan-cancelled")).toBeVisible();
  await page.waitForTimeout(6000);                                  // a run that was not really stopped would land by now
  const s = await st(page);
  expect(s.planStatus).toBe("idle");
  expect(s.plan).toBeNull();
  expect(posts).toBe(0);
  await expect(page.getByRole("button", { name: "Plan with AI agents" })).toBeEnabled();
});

test("event chain: survives a tab switch, and its approval is shown on the twin", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await page.getByRole("tab", { name: "Alerts" }).click();
  const chain = page.getByTestId("chain");
  await chain.getByTestId("chain-askme").uncheck();
  await chain.getByTestId("chain-start").click();
  await expect(chain.getByTestId("chain-inbox")).toBeVisible({ timeout: 90_000 });
  const id = (await st(page)).chain!.chain_id;
  await page.getByRole("tab", { name: "AI team" }).click();
  await page.getByRole("tab", { name: "Alerts" }).click();
  await expect(chain.getByTestId("chain-inbox")).toBeVisible();     // the same chain, not a fresh card
  expect((await st(page)).chain!.chain_id).toBe(id);
  await chain.getByTestId("chain-approve").click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().applied.some((a) => !!a.chain), null, { timeout: 60_000 });
  await expect(chain.getByTestId("chain-synced")).toBeVisible();
  await expect(page.locator(".kpi").nth(3)).toContainText("1");
  const s = await st(page);
  expect(s.applied.find((a) => a.chain)!.title.length).toBeGreaterThan(0);
  // the twin re-simulated with the chain's measures: the KPI over-threshold figure moved off the no-plan baseline
  const [base, cur] = await page.evaluate(() => { const g = (window as unknown as W).__twin.getState() as unknown as { base: { resp: { run_id: string } }; cur: { resp: { run_id: string } } }; return [g.base.resp.run_id, g.cur.resp.run_id]; });
  expect(cur).not.toBe(base);
});

test("ask the twin and the watcher say when the service fails, and retry", async ({ page }) => {
  await open(page);
  await page.route("**/agent/ask", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "test failure" }) }));
  await page.getByRole("tab", { name: "AI team" }).click();
  await page.getByTestId("ask").locator('[data-intent="peak"]').click();
  await expect(page.getByTestId("ask-error")).toContainText("test failure");
  await page.unroute("**/agent/ask");
  await page.getByTestId("ask-retry").click();
  await expect(page.getByTestId("ask-answer")).toBeVisible();
  await expect(page.getByTestId("ask-error")).toHaveCount(0);

  await page.route("**/watch/scan", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "watcher down" }) }));
  await page.getByRole("tab", { name: "Alerts" }).click();
  await expect(page.getByTestId("watch-error")).toContainText("watcher down");
  await page.unroute("**/watch/scan");
  await page.getByTestId("watch-retry").click();
  await expect(page.getByTestId("watch-error")).toHaveCount(0);
  await expect(page.getByTestId("watcher")).toBeVisible();
});

test("panel tabs: arrow keys, Home and End move between tabs; right to left mirrors the arrows", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Station" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "AI plan" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "AI plan" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Report" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Station" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[role=tab][tabindex="0"]')).toHaveCount(1);

  await page.getByRole("button", { name: "عربي" }).click();
  await page.locator("#tab-station").focus();
  await page.keyboard.press("ArrowLeft");                            // right to left: the next tab is to the left
  await expect(page.locator("#tab-ai")).toHaveAttribute("aria-selected", "true");
});

test("report: the snapshot waits for the 3D view, and the brief is written in the language on screen", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as unknown as { __twin: { setState: (p: unknown) => void } }).__twin.setState({ view: "table" }));
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.getByTestId("report-snap")).toBeDisabled();
  await expect(page.getByTestId("report-snap-note")).toBeVisible();
  await page.getByRole("button", { name: "عربي" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "حفظ الموجز (.md)" }).click()]);
  const md = fs.readFileSync((await dl.path())!, "utf8");
  expect(md).toContain("موجز الفعالية");
  expect(md).toContain("بلا خطط");
  expect(md).toMatch(/fc_|run/);                                     // the run ids stay as they are
});

test("AI team: before any run, the team size comes from the roster the API builds", async ({ page, request }) => {
  const roster = await (await request.get(`${API}/agent/roster`)).json();
  await open(page);
  await page.getByRole("tab", { name: "AI team" }).click();
  await expect(page.getByTestId("team-lede")).toContainText(`${roster.counts.agents} agents`);
  await expect(page.getByTestId("team-lede")).toContainText(`${roster.counts.model_capable} of them`);
});

test("landmarks menu closes on Escape and on a click elsewhere", async ({ page }) => {
  test.skip(process.env.EFT_NO_GL === "1", "needs the 3D view");
  await open(page);
  const toggle = page.getByTestId("lm-toggle");
  await toggle.click();
  await expect(page.locator(".lmmenu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lmmenu")).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.locator(".hdr .brand").click();
  await expect(page.locator(".lmmenu")).toHaveCount(0);
});

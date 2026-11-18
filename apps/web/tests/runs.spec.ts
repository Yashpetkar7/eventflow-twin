// Runs of the agent team (contract 1.18.0, decision #152): the run bar, auto-run, cancel, superseded runs, the run
// history with "compare with now" and "restore this scenario", and the Compare card on the AI plan tab.
// What is checked: a status on screen is what really happened; an automatic run starts by itself for the LATEST
// scenario only; an answer for an old scenario or a cancelled run never reaches the screen; restoring a run's scenario
// changes the real controls. Runs with WebGL off on CI (EFT_NO_GL=1): nothing here needs the 3D scene.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../eval/results/ui/runs");
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

type S = { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean; planStatus: string; threshold: number;
  scenario: { attendance: number | null }; forecast: { run_id: string; attendance_used: number } | null;
  plan: { plan_id: string; forecast_run_id: string; options: unknown[] } | null; mission: { mission_id: string } | null; patchScenario: (p: object) => void };
type W = Window & { __twin: { getState: () => S } };

async function open(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); localStorage.clear(); } catch { /* ignore */ } });
  await page.goto("/?scene=v1");
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
  await set(page, { weather: "hot" });                                                       // World Trade Centre over the line
  await page.getByRole("tab", { name: "AI plan", exact: true }).click();
  await expect(page.getByTestId("runbar")).toBeVisible();
}
const twin = <T,>(page: Page, fn: (s: S) => T) => page.evaluate(`(${fn.toString()})(window.__twin.getState())`) as Promise<T>;
const idle = (page: Page) => page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
async function set(page: Page, p: object) {
  await page.evaluate((x) => (window as unknown as W).__twin.getState().patchScenario(x), p);
  await page.waitForTimeout(350);                                                            // the store's own debounce, then its refresh
  await idle(page);
}
const status = (page: Page, s: string) => page.waitForFunction((x) => (window as unknown as W).__twin.getState().planStatus === x, s, { timeout: 60_000 });
const rows = (page: Page) => page.getByTestId("run-row");
const plan = (page: Page) => page.getByRole("button", { name: "Plan with AI agents" });

test("AI plan: a run is recorded with what it found, the plans compare on seven objectives, and Run again repeats it", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("run-status")).toContainText("No analysis has run");
  await plan(page).click();
  await expect(page.getByTestId("run-status")).toContainText("Running");
  await expect(page.getByTestId("run-cancel")).toBeVisible();
  await status(page, "ready");
  await expect(page.getByTestId("run-status")).toContainText("Completed");
  const first = rows(page).first();
  await expect(first).toHaveAttribute("data-status", "completed");
  await expect(first).toHaveAttribute("data-trigger", "manual");
  await expect(first).toContainText("Recommended:");
  const mission = await twin(page, (s) => s.mission!.mission_id);
  await expect(first).toContainText(mission);                                                // the run on the list is the run on screen

  await page.getByTestId("compare-open").click();
  const table = page.getByTestId("compare-card").getByTestId("as-table");
  await expect(table.getByTestId("as-plan")).toHaveCount(3);
  await expect(table).toContainText("Team's recommendation");
  await expect(table).toContainText("not measured");                                          // emissions
  await table.locator('[data-lens="cost"]').click();
  await expect(table).toHaveAttribute("data-lens", "cost");
  await shot(page, "1_run_and_compare");

  await page.getByTestId("run-again").click();
  await status(page, "running");
  await status(page, "ready");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute("data-trigger", "rerun");
  await expect(rows(page).first()).toContainText(mission);                                    // deterministic: the same scenario gives the same run
});

test("auto-run: the team runs by itself for the latest scenario, and quick changes are one run", async ({ page }) => {
  await open(page);
  await page.getByTestId("auto-run").locator("input").check();                                // no run yet for this scenario: one is queued now
  await status(page, "running");
  await status(page, "ready");
  await expect(rows(page).first()).toHaveAttribute("data-trigger", "auto");
  await expect(rows(page).first()).toHaveAttribute("data-status", "completed");

  await page.evaluate(() => { const t = (window as unknown as W).__twin.getState(); t.patchScenario({ attendance: 50000 }); t.patchScenario({ attendance: 60000 }); });
  await expect(page.getByTestId("run-status")).toContainText("Queued");
  await status(page, "running");
  await status(page, "ready");
  await expect(rows(page)).toHaveCount(2);                                                    // two changes, one run
  const v = Number(await page.getByTestId("runbar").getAttribute("data-version"));
  await expect(rows(page).first()).toHaveAttribute("data-version", String(v));
  const s = await twin(page, (x) => ({ att: x.forecast!.attendance_used, fc: x.forecast!.run_id, planFor: x.plan!.forecast_run_id }));
  expect(s.att).toBe(60000);
  expect(s.planFor).toBe(s.fc);                                                               // the plan on screen is for the scenario on screen
  await expect(page.getByTestId("run-stale")).toHaveCount(0);
  await shot(page, "2_auto_run");

  await page.getByTestId("auto-run").locator("input").uncheck();
  await set(page, { attendance: 45000 });
  await page.waitForTimeout(1500);
  await expect(rows(page)).toHaveCount(2);                                                    // off: nothing runs by itself
  await expect(page.getByTestId("run-stale")).toContainText("The scenario changed after the last analysis");
});

test("a scenario change during a run supersedes it, and Cancel drops the answer", async ({ page }) => {
  await open(page);
  await plan(page).click();
  await status(page, "running");
  await set(page, { attendance: 55000 });                                                     // the scenario moves while the team is working
  await expect(rows(page).first()).toHaveAttribute("data-status", "superseded");
  expect(await twin(page, (s) => [s.planStatus, s.plan])).toEqual(["idle", null]);

  await plan(page).click();
  await status(page, "running");
  await page.getByTestId("run-cancel").click();
  await expect(rows(page).first()).toHaveAttribute("data-status", "cancelled");
  await page.waitForTimeout(4000);                                                            // the API's answer arrives after the cancel…
  expect(await twin(page, (s) => [s.planStatus, s.plan])).toEqual(["idle", null]);            // …and is not shown
  await expect(rows(page)).toHaveCount(2);
  await shot(page, "3_superseded_and_cancelled");

  await page.getByTestId("run-again").click();                                                // and the planner can simply run it again
  await status(page, "ready");
  await expect(rows(page).first()).toHaveAttribute("data-status", "completed");
});

test("run history: compare a past run with now, then restore its scenario", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const before = await twin(page, (s) => ({ att: s.forecast!.attendance_used, run: s.forecast!.run_id }));
  await plan(page).click();
  await status(page, "ready");
  const v1 = Number(await page.getByTestId("runbar").getAttribute("data-version"));
  await set(page, { attendance: 60000 });
  await expect(page.getByTestId("run-stale")).toBeVisible();

  const row = rows(page).first();
  await row.getByTestId("run-compare").click();
  const diff = row.getByTestId("run-diff");
  await expect(diff.locator('[data-field="attendance"]')).toContainText("40,000 → 60,000", { timeout: 30_000 });
  await expect(diff).toContainText("With no plan: peak load");
  await expect(diff).toContainText(/The recommendation (changed|is the same)/);
  await expect(diff).toContainText("sim_");
  await shot(page, "4_compare_with_now");

  await row.getByTestId("run-restore").click();
  await page.waitForFunction((r) => { const t = (window as unknown as W).__twin.getState(); return !t.loading && t.forecast?.run_id === r; }, before.run);
  expect(await twin(page, (s) => s.forecast!.attendance_used)).toBe(before.att);
  await expect(page.locator("#att")).toHaveValue(String(before.att));                         // the control moved back
  await expect(page.getByTestId("runbar")).toHaveAttribute("data-version", String(v1 + 2));   // changed by hand, then restored: two versions on
});

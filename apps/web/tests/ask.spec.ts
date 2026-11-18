// "Ask me during planning" as the product ships it (contract 1.18.0, decision #154): ON by default, in the workspace
// and on the kiosk. These tests open the page WITHOUT ?ask=0, unlike the other suites.
// Checked: with nothing over the line the team no longer ends in silence (it tests the scenario harder by itself and
// asks); the visitor's or planner's tap changes the REAL scenario and the team plans for it; the kiosk asks with big
// touch targets; a guided demo never waits for a tap. Runs with WebGL off on CI (EFT_NO_GL=1).
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../eval/results/ui/ask");
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

type S = { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean; planStatus: string; askMe: boolean; threshold: number;
  forecast: { run_id: string; attendance_used: number; weather: string } | null; plan: { options: unknown[]; forecast_run_id: string } | null;
  pause: { checkpoint: string } | null; tourStep: number | null };
type W = Window & { __twin: { getState: () => S } };

async function open(page: Page, url: string) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); localStorage.clear(); } catch { /* ignore */ } });
  await page.goto(url);
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
}
const twin = <T,>(page: Page, fn: (s: S) => T) => page.evaluate(`(${fn.toString()})(window.__twin.getState())`) as Promise<T>;
const status = (page: Page, s: string) => page.waitForFunction((x) => (window as unknown as W).__twin.getState().planStatus === x, s, { timeout: 60_000 });

test("workspace: nothing over the line, so the team tests harder by itself and asks; your choice becomes the scenario", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "/?scene=v1");                                                            // GITEX on a normal day: no station over 85 %
  expect(await twin(page, (s) => s.askMe)).toBe(true);
  await page.getByRole("tab", { name: "AI plan", exact: true }).click();
  await expect(page.getByTestId("ask-me").locator("input")).toBeChecked();
  const before = await twin(page, (s) => ({ run: s.forecast!.run_id, att: s.forecast!.attendance_used }));
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await status(page, "paused");
  const card = page.getByTestId("checkpoint");
  await expect(card).toHaveAttribute("data-checkpoint", "calm");
  await expect(card).toContainText("No station crosses the 85% comfort line");
  await expect(card).toContainText("I tested it harder myself");
  const probes = card.getByTestId("cp-probes").locator("li");
  await expect(probes).toHaveCount(3);                                                        // bigger crowd, hot day, stricter line
  await expect(probes.first()).toContainText("stress_");                                      // each with its own run
  await expect(page.getByTestId("run-status")).toContainText("Waiting for your answer");
  await shot(page, "1_calm_question");

  await card.locator('[data-testid="cp-try"][data-probe="crowd"]').click();                   // "Plan for 45,000 visitors"
  await page.waitForFunction((r) => { const t = (window as unknown as W).__twin.getState(); return t.forecast?.run_id !== r && !t.loading; }, before.run);
  const att = await twin(page, (s) => s.forecast!.attendance_used);
  expect(att).toBeGreaterThan(before.att);
  await expect(page.locator("#att")).toHaveValue(String(att));                                // the real control moved
  await status(page, "paused");                                                               // now a station IS over the line: the team asks which to plan for
  await expect(page.getByTestId("checkpoint")).toHaveAttribute("data-checkpoint", "hotspot");
  await page.getByTestId("cp-confirm").click();
  await status(page, "ready");
  const s = await twin(page, (x) => ({ n: x.plan!.options.length, planFor: x.plan!.forecast_run_id, fc: x.forecast!.run_id }));
  expect(s.n).toBeGreaterThan(0);
  expect(s.planFor).toBe(s.fc);
  await shot(page, "2_planned_for_the_harder_scenario");
});

test("workspace: 'Leave it' ends as before, and ?ask=0 never asks", async ({ page }) => {
  await open(page, "/?scene=v1");
  await page.getByRole("tab", { name: "AI plan", exact: true }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await status(page, "paused");
  const run = await twin(page, (s) => s.forecast!.run_id);
  await page.getByTestId("cp-calm-accept").click();
  await status(page, "ready");
  expect(await twin(page, (s) => [s.plan!.options.length, s.forecast!.run_id])).toEqual([0, run]);   // no plan needed, scenario untouched
  await open(page, "/?scene=v1&ask=0");
  await page.getByRole("tab", { name: "AI plan", exact: true }).click();
  await expect(page.getByTestId("ask-me").locator("input")).not.toBeChecked();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await status(page, "ready");
  await expect(page.getByTestId("checkpoint")).toHaveCount(0);
});

test("workspace: the guided demo never waits for a tap", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "/?scene=v1");
  await page.getByRole("button", { name: "Guided demo" }).click();
  await page.waitForFunction(() => { const t = (window as unknown as W).__twin.getState(); return t.planStatus === "ready" || t.planStatus === "paused"; }, null, { timeout: 120_000 });
  expect(await twin(page, (s) => [s.planStatus, s.pause])).toEqual(["ready", null]);
});

test("kiosk: the team asks the visitor, with big touch targets, before it plans", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.goto("/?kiosk=1&idle=600");                                                      // the default: asking is on
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-planner").click();
  await page.locator(".kseg").getByRole("button", { name: "Hot day" }).click();
  await page.waitForFunction(() => { const t = (window as unknown as W).__twin.getState(); return t.forecast?.weather === "hot" && !t.loading; });
  await page.getByRole("button", { name: /See the crowd/ }).click();
  await page.locator(".kquiz button").first().click();
  await expect(page.locator(".kverdict")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Ask the AI for a plan/ }).click();
  await page.getByRole("button", { name: "Not sure. Ask the AI" }).click();
  const card = page.getByTestId("kiosk-checkpoint");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toHaveAttribute("data-checkpoint", "hotspot");
  await expect(card).toContainText("World Trade Centre");
  for (const b of await card.locator("button").all()) {
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(box.y + box.height).toBeLessThanOrEqual(1080 - 60);
  }
  await page.waitForTimeout(500);
  await shot(page, "3_kiosk_question");
  await card.getByTestId("cp-confirm").click();
  await expect(page.locator(".kopt").first()).toBeVisible({ timeout: 30_000 });               // the plans come after the visitor's answer
  expect(await twin(page, (s) => s.planStatus)).toBe("ready");
});

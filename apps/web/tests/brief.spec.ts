import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// The planner's brief (decision #144): plain words → "here is what I understood" → the planner removes a field →
// "Confirm and plan" sets the scenario and the constraints → the team's first message is the planner's brief.
const OUT = "../../eval/results/ui/brief";
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
type TwinWindow = Window & { __twin: { getState: () => Record<string, unknown> & { ready: boolean; sceneReady: boolean; glFailed: boolean } } };

async function open(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); } catch { /* ignore */ } });
  await page.goto("/?ask=0");   // ask=0: "Ask me during planning" is on by default (1.18.0); these tests plan in one tap unless they test the questions
  await page.waitForFunction(() => { const s = (window as unknown as TwinWindow).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
  await page.getByRole("tab", { name: "AI plan" }).click();
}

test("brief: read, remove a field, confirm; the scenario, constraints and the team's first message follow it", async ({ page }) => {
  await open(page);
  await page.getByTestId("brief-text").fill("Basketball final near Business Bay on Saturday, 8pm to 11pm, 18,000 fans. "
    + "No buses please, keep Burj Khalifa station calm and keep stations under 80%.");
  await page.getByTestId("brief-read").click();
  const prop = page.getByTestId("brief-proposal");
  await expect(prop).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("brief-source")).toContainText(/word rules|AI model/);
  await expect(page.getByTestId("brief-station")).toHaveValue("BBY");
  await expect(prop.locator('[data-field="forbid"]')).toContainText("No buses");                    // each field quotes the brief
  await expect(page.getByTestId("brief-summary")).toContainText("20:00–23:00");
  await shot(page, "1_understood");
  await prop.locator('[data-field="protect"]').getByRole("button", { name: /Remove/ }).click();       // the planner removes one field
  await expect(prop.locator('[data-field="protect"]')).toHaveCount(0);
  await page.getByTestId("brief-confirm").click();
  await expect(page.getByTestId("brief-inuse")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => (window as unknown as TwinWindow).__twin.getState().planStatus === "ready", null, { timeout: 120_000 });
  const s = await page.evaluate(() => {
    const g = (window as unknown as TwinWindow).__twin.getState() as unknown as {
      scenario: { eventId: string; attendance: number; custom: Record<string, unknown> }; threshold: number;
      constraints: { forbid_types: string[]; protect_stations: string[] }; mission: { events: { key: string; params: Record<string, unknown> }[] } | null };
    return { ev: g.scenario.eventId, att: g.scenario.attendance, custom: g.scenario.custom, thr: g.threshold, cons: g.constraints,
      first: g.mission?.events[0] };
  });
  expect(s.ev).toBe("custom");
  expect(s.custom).toEqual({ near: "BBY", start: "20:00", end: "23:00", weekend: true });
  expect(s.att).toBe(18000);
  expect(s.thr).toBe(0.8);
  expect(s.cons.forbid_types).toEqual(["shuttle_bus"]);
  expect(s.cons.protect_stations).toEqual([]);                                                        // removed by the planner: not applied
  expect(s.first?.key).toBe("human.brief");
  expect(s.first?.params.removed).toEqual(["protect"]);
  await shot(page, "2_planned");
  await page.getByRole("tab", { name: "AI team" }).click();
  await expect(page.getByTestId("team-feed").locator("li").first()).toContainText("Your brief:");
  await expect(page.getByTestId("team-feed").locator("li").first()).toContainText("you changed 1 field");
  await shot(page, "3_team_feed");
});

test("brief on a phone, in Arabic: a station not in the brief must be chosen before confirming", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("brief-text").fill("حفل كبير يوم السبت من ٧ إلى ١٠ مساءً، ١٥ ألف شخص، بدون حافلات");
  await page.getByTestId("brief-read").click();
  await expect(page.getByTestId("brief-proposal")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("brief-confirm")).toBeDisabled();                                    // no station in the brief
  await page.getByTestId("brief-station").selectOption("WTC");
  await expect(page.getByTestId("brief-confirm")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await shot(page, "4_phone_ar");
});

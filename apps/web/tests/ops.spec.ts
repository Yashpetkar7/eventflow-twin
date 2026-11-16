import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Duty inbox and rider page (decision #140): register an event → it lands in the inbox → approve on a phone →
// publish the rider notice → the rider page shows the advice with the approved measures and the notice.
const OUT = "../../eval/results/ui/ops";
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

test.use({ viewport: { width: 390, height: 844 } });

test("duty inbox on a phone: register, approve, publish; the rider page shows the notice and the approved plan", async ({ page }) => {
  const name = `UI test concert ${Date.now() % 100000}`;
  await page.goto("/inbox");
  await expect(page.getByTestId("ops")).toBeVisible({ timeout: 30_000 });
  await page.locator("#ev-name").fill(name);
  await page.locator("#ev-station").selectOption("BBY");
  await page.locator("#ev-date").fill("2026-12-04");
  await page.locator("#ev-start").fill("19:00");
  await page.locator("#ev-end").fill("22:30");
  await page.locator("#ev-att").fill("17000");
  await page.getByTestId("ops-register-btn").click();
  await expect(page.getByTestId("ops-msg")).toContainText(name, { timeout: 30_000 });
  const item = page.getByTestId("ops-item").filter({ hasText: name });
  await expect(item).toContainText("crosses the comfort line");
  await shot(page, "1_inbox_phone");
  await item.getByTestId("ops-approve").click();
  await page.getByTestId("ops-publish").first().click();
  const notice = page.getByTestId("ops-notice").first();
  await expect(notice).toContainText(name, { timeout: 30_000 });                         // the Messenger names the registered event
  await shot(page, "2_published");
  await notice.getByRole("link").click();
  await expect(page.getByTestId("travel-answer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("travel-notice").first()).toContainText(name);
  await expect(page.getByTestId("travel-with-plan")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await shot(page, "3_rider_page");
  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("travel-status")).toBeVisible();
  await shot(page, "4_rider_page_ar");
});

test("rider page: a demo event without any notice still answers from the simulator", async ({ page }) => {
  await page.goto("/travel?event=downtown_night&station=BKD&hour=22");
  await expect(page.getByTestId("travel-answer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("travel-status")).toHaveText(/Easy|Busy|Crowded|No trains/);
  await expect(page.getByTestId("travel-answer")).toContainText("From the simulator (run sim_");
});

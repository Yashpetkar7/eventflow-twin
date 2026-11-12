// Visitor kiosk (?kiosk=1) at the booth resolution: the full story, the timeout, accessibility and touch targets.
// Screenshots of every screen → eval/results/ui/kiosk/.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, `../../../eval/results/ui/kiosk${process.env.EFT_SCENE ? `_${process.env.EFT_SCENE}` : ""}`);
fs.mkdirSync(OUT, { recursive: true });
type W = Window & { __twin: { getState: () => { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean; forecast: { weather?: string } | null } } };

async function openKiosk(page: Page, q = "") {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  // The kiosk shows the realism scene by default (decision #101); EFT_SCENE=v1 runs the same checks on the corridor scene.
  const scene = process.env.EFT_SCENE ? `&scene=${process.env.EFT_SCENE}` : "";
  await page.goto(`/?kiosk=1${q}${scene}`);
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
}
const idle = (page: Page) => page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

test("kiosk: attract → event → quiz → AI plan → approve → before/after, with the stepper highlighting each step", async ({ page }) => {
  await openKiosk(page, "&idle=600");
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "attract");
  await expect(page.getByText("Will the metro cope?")).toBeVisible();
  await page.waitForTimeout(2500);
  await shot(page, "1_attract");

  await page.getByTestId("kiosk-start").click();
  await expect(page.getByRole("heading", { name: "Pick an event" })).toBeVisible();
  await expect(page.locator(".ksteps li.on")).toContainText("Event");
  await expect(page.locator(".kevent").first().locator("em")).toHaveCount(0);   // GITEX is a real event, not "hypothetical"
  await expect(page.locator(".kevent").last().locator("em")).toHaveText("Hypothetical");
  await page.locator(".kevent").first().click();
  await page.locator(".kseg").getByRole("button", { name: "Hot day" }).click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().forecast?.weather === "hot");
  await idle(page);
  await page.waitForTimeout(1200);
  await shot(page, "2_event");

  await page.getByRole("button", { name: /See the crowd/ }).click();
  await expect(page.locator(".ksteps li.on")).toContainText("Crowd");
  await expect(page.locator(".kquiz button")).toHaveCount(6);
  await page.waitForTimeout(1200);
  await shot(page, "3_quiz");
  await page.locator(".kquiz").getByRole("button", { name: "World Trade Centre" }).click();
  await expect(page.locator(".kverdict")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".kverdict")).toHaveText("Correct!");          // hot day: World Trade Centre is the busiest
  await expect(page.locator(".kbig-stat b")).toContainText("%");
  await page.waitForTimeout(2500);
  await shot(page, "4_reveal");

  await page.getByRole("button", { name: /Ask the AI for a plan/ }).click();
  await expect(page.locator(".ksteps li.on")).toContainText("AI plan");
  await expect(page.locator(".kopt")).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator(".kopt .kcheck").first()).toBeVisible();
  for (const b of await page.locator(".kopt .kgo").all()) {                  // all three options fit: no scrolling
    const box = (await b.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(1080 - 76);
  }
  await shot(page, "5_plan");

  await page.locator(".kopt").first().getByRole("button", { name: "Approve this plan" }).click();
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "decide", { timeout: 15_000 });
  await expect(page.locator(".ksteps li.on")).toContainText("Your decision");
  await expect(page.locator(".ksteps li.done")).toHaveCount(3);
  await expect(page.locator(".kba b").first()).toContainText("%");
  await expect(page.locator(".kqr")).toContainText("Link coming soon");
  await expect(page.locator(".kcred")).toContainText("OpenStreetMap");      // map licence credit always on screen
  await page.waitForTimeout(2500);
  await shot(page, "6_result");

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "attract");
});

test("kiosk: every control is a big touch target, primary buttons sit in the lower half, no scrolling", async ({ page }) => {
  await openKiosk(page, "&idle=600");
  await page.getByTestId("kiosk-start").click();
  for (const b of await page.locator(".ktop button, .kcard button").all()) {
    if (!(await b.isVisible())) continue;
    const box = (await b.boundingBox())!;
    expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(56);
  }
  const go = (await page.locator(".kcard .kgo").boundingBox())!;
  expect(go.y).toBeGreaterThan(540);
  expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([1920, 1080]);
});

test("kiosk: no touch for a while → 'Still there?' countdown → back to the attract screen", async ({ page }) => {
  await openKiosk(page, "&idle=5");
  await page.getByTestId("kiosk-start").click();
  await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("alertdialog")).toContainText("Still there?");
  await shot(page, "7_still_there");
  await page.getByRole("button", { name: "I'm still here" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "attract", { timeout: 15_000 });
});

test("kiosk: Arabic right to left, larger text, and the hidden expert exit", async ({ page }) => {
  await openKiosk(page, "&idle=600");
  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("هل يتحمّل المترو؟")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "8_arabic_attract");
  await page.getByTestId("kiosk-start").click();
  await page.locator(".ktools .kpill").first().click();                       // larger text
  await expect(page.locator(".kiosk-root")).toHaveClass(/kbig/);
  await page.waitForTimeout(800);
  await shot(page, "9_arabic_large_text");
  const brand = page.locator(".kbrand");
  const box = (await brand.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  await expect(page.getByTestId("kiosk")).toHaveCount(0);                     // the full workspace for the team
  await expect(page.locator(".app")).toBeVisible();
});

test("kiosk: the realism scene is its default, held at quality tier 1; ?scene=v1 brings back the corridor scene", async ({ page }) => {
  type T = Window & { __twin: { getState: () => { tier: number } } };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?kiosk=1&idle=600");
  await page.waitForFunction(() => document.documentElement.dataset.sceneV2 === "16/16", null, { timeout: 120_000 });
  expect(await page.evaluate(() => (window as unknown as T).__twin.getState().tier)).toBe(1);   // decision #101
  await expect(page.locator(".kcred")).toContainText("Overture");             // the realism datasets are credited
  await page.goto("/?kiosk=1&idle=600&scene=v1");
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.documentElement.dataset.sceneV2 ?? "off")).toBe("off");
  expect(await page.evaluate(() => (window as unknown as T).__twin.getState().tier)).toBe(0);
  await expect(page.locator(".kcred")).not.toContainText("Overture");
});

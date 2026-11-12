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
  // The kiosk shows the realism scene by default (decision #102); EFT_SCENE=v1 runs the same checks on the corridor scene.
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
  await expect(page.getByRole("heading", { name: "What brings you here?" })).toBeVisible();
  await shot(page, "1b_two_ways_in");
  await page.getByTestId("kiosk-planner").click();
  await expect(page.getByRole("heading", { name: "Pick an event" })).toBeVisible();
  await expect(page.locator(".ksteps li.on")).toContainText("Event");
  await expect(page.locator(".kevent").first().locator("em")).toHaveCount(0);   // GITEX is a real event, not "hypothetical"
  await expect(page.locator(".kevent:not(.kown)").last().locator("em")).toHaveText("Hypothetical");
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
  await expect(page.getByRole("heading", { name: "Your idea first" })).toBeVisible();      // the visitor commits to an idea before the AI answers
  await shot(page, "5a_your_idea");
  await page.locator('.kideas button[data-idea="stagger"]').click();
  await expect(page.locator(".kopt")).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator(".kyou")).toContainText("Your idea");
  await expect(page.locator(".kyou")).toContainText("%");                                  // the idea was simulated too
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
  await expect(page.getByTestId("kiosk-vs")).toBeVisible();                                // you vs the AI, in words
  for (const b of await page.locator(".kcard button").all()) {                             // the result screen still fits: no scrolling
    const box = (await b.boundingBox())!;
    expect(box.y + box.height, await b.innerText()).toBeLessThanOrEqual(1080 - 72);
  }
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
  for (const b of await page.locator(".kcard button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await page.getByTestId("kiosk-planner").click();
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
  await page.getByTestId("kiosk-planner").click();
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
  await expect(page.getByRole("heading", { name: "ما الذي أتى بك؟" })).toBeVisible();
  await page.getByTestId("kiosk-rider").click();                             // the rider tip in Arabic, right to left
  await expect(page.getByTestId("kiosk-advice").locator(".tip b")).toBeVisible({ timeout: 20_000 });
  for (const b of await page.locator(".kcard button").all()) { const box = (await b.boundingBox())!; expect(box.y + box.height).toBeLessThanOrEqual(1080 - 72); }
  await page.waitForTimeout(1200);
  await shot(page, "8b_arabic_rider_advice");
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
  expect(await page.evaluate(() => (window as unknown as T).__twin.getState().tier)).toBe(1);   // decision #102
  await expect(page.locator(".kcred")).toContainText("Overture");             // the realism datasets are credited
  await page.goto("/?kiosk=1&idle=600&scene=v1");
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.documentElement.dataset.sceneV2 ?? "off")).toBe("off");
  expect(await page.evaluate(() => (window as unknown as T).__twin.getState().tier)).toBe(0);
  await expect(page.locator(".kcred")).not.toContainText("Overture");
});

// ---------------------------------------------------------------------------------------------------------------
// Kiosk plus (decision #103): two ways in, rider advice, stress test, how the AI decided, undo, the 60-second show,
// the reported New Year's Eve measures, an own event, high contrast, booth statistics.
type S = Window & { __twin: { getState: () => { loading: boolean; error: string | null; applied: unknown[]; planStatus: string;
  forecast: { attendance_used: number; metro_share_used: number; event: { id: string } | null } | null; cur: { resp: { summary: { peak_lf: number } } } | null } } };
const twin = <T,>(page: Page, fn: (s: ReturnType<S["__twin"]["getState"]>) => T) => page.evaluate(`(${fn.toString()})(window.__twin.getState())`) as Promise<T>;
const settled = (page: Page) => page.waitForFunction(() => { const s = (window as unknown as S).__twin.getState(); return !s.loading; });
async function toReveal(page: Page, weather = "Hot day") {
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-planner").click();
  await page.locator(".kseg").getByRole("button", { name: weather }).click();
  await page.waitForTimeout(500); await settled(page);
  await page.getByRole("button", { name: /See the crowd/ }).click();
  await page.locator(".kquiz button").first().click();
  await expect(page.locator(".kverdict")).toBeVisible({ timeout: 15_000 });
}

test("kiosk: 'I'm travelling to the event' gives a tip from the simulator, fastest or quieter", async ({ page }) => {
  await openKiosk(page, "&idle=600");
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-rider").click();
  await expect(page.getByRole("heading", { name: "When should I leave?" })).toBeVisible();
  const advice = page.getByTestId("kiosk-advice");
  await expect(advice.locator(".tip b")).toContainText(" at ");
  await expect(advice.locator(".worst > span")).toContainText("% full");
  const fast = await advice.locator(".tip").innerText();
  await page.getByTestId("kiosk-mode").getByRole("button", { name: "Quieter" }).click();
  await expect(advice.locator(".tip > span")).toContainText("% full");
  const quiet = await advice.locator(".tip").innerText();
  const pct = (t: string) => Number(/(\d+)% full/.exec(t)![1]);
  expect(pct(quiet)).toBeLessThanOrEqual(60);                                               // "quieter" = trains under 60 % full
  expect(pct(quiet)).toBeLessThanOrEqual(pct(fast));
  await page.waitForTimeout(1500);
  await shot(page, "10_rider_advice");
  await expect(page.locator(".ksteps")).toHaveCount(0);                                     // the planner's stepper is not shown here
});

test("kiosk: stress test - more visitors, more of them by metro, a closed station - then the AI plans on top", async ({ page }) => {
  await openKiosk(page, "&idle=600");
  await toReveal(page, "Normal");
  const before = await twin(page, (s) => s.cur!.resp.summary.peak_lf);
  await page.getByTestId("kiosk-lab").click();
  await expect(page.getByRole("heading", { name: "Stress test" })).toBeVisible();
  // crowd size: drag to the maximum
  await page.getByTestId("kiosk-crowd").evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, el.max); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForFunction(() => ((window as unknown as S).__twin.getState().forecast?.attendance_used ?? 0) >= 100000);
  await settled(page);
  expect(await twin(page, (s) => s.cur!.resp.summary.peak_lf)).toBeGreaterThan(before);
  await expect(page.getByTestId("kiosk-live").locator("b")).toHaveClass(/risk/);
  // more visitors by metro (pricing nudge what-if)
  await page.getByTestId("kiosk-metro").getByRole("button", { name: "65%" }).click();
  await page.waitForFunction(() => Math.abs(((window as unknown as S).__twin.getState().forecast?.metro_share_used ?? 0) - 0.65) < 1e-6);
  await expect(page.getByTestId("kiosk-metro").getByRole("button", { name: "65%" })).toHaveAttribute("aria-pressed", "true");
  // a station has to close
  await page.getByTestId("kiosk-close").getByRole("button", { name: "Emirates Towers" }).click();
  await page.waitForFunction(() => { const s = (window as unknown as S).__twin.getState(); return s.applied.length === 1 && !s.loading; });
  expect(await twin(page, (s) => s.error)).toBeNull();
  await expect(page.locator(".kcard")).toContainText("guided on foot");
  await page.waitForTimeout(1200);
  await shot(page, "11_stress_test");
  for (const b of await page.locator(".kcard button, .kcard input").all()) {               // fits without scrolling
    const box = (await b.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(1080 - 72);
  }
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Ask the AI for a plan/ }).click();
  await page.getByRole("button", { name: /Not sure/ }).click();
  await expect(page.locator(".kopt").first()).toBeVisible({ timeout: 30_000 });             // the agents plan on top of the closed station
  expect(await twin(page, (s) => s.applied.length)).toBe(1);
});

test("kiosk: how the AI decided, undo an approval, and RTA's reported New Year's Eve measures", async ({ page }) => {
  await openKiosk(page, "&idle=600");
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-planner").click();
  await page.locator(".kevent:not(.kown)").last().click();                                 // Downtown celebration night
  await page.waitForFunction(() => (window as unknown as S).__twin.getState().forecast?.event?.id === "downtown_night");
  await settled(page);
  await page.getByRole("button", { name: /See the crowd/ }).click();
  await page.locator(".kquiz button").first().click();
  await expect(page.locator(".kverdict")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Ask the AI for a plan/ }).click();
  await page.locator('.kideas button[data-idea="trains"]').click();
  await expect(page.locator(".kopt")).toHaveCount(3, { timeout: 30_000 });
  await page.getByTestId("kiosk-how").click();
  const trace = page.getByTestId("kiosk-trace");
  await expect(trace.locator("li")).toHaveCount(8);                                        // the agent's eight steps, from the API answer
  await expect(page.getByRole("dialog")).toContainText("figures on the plan cards were checked against the simulator: all match");
  await expect(page.getByRole("dialog")).toContainText("Target: Burj Khalifa");
  await shot(page, "12_how_the_ai_decided");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.locator(".kopt").nth(1).getByRole("button", { name: "Approve this plan" }).click();
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "decide", { timeout: 15_000 });
  await expect(page.locator(".kba > div")).toHaveCount(4);                                  // long waits in this scenario: all four measures
  await expect(page.locator(".kba")).toContainText("min");
  await page.getByTestId("kiosk-pb").click();
  const table = page.getByTestId("kiosk-pb-table");
  await expect(table.locator("tbody tr")).toHaveCount(3, { timeout: 20_000 });
  await expect(table).toContainText("%");
  await expect(page.getByRole("dialog")).toContainText("as reported by Gulf News and WAM");
  await expect(page.getByRole("dialog")).toContainText("not an RTA system");
  await shot(page, "13_reported_nye_measures");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByTestId("kiosk-undo").click();                                            // approval undone: back to the options
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "plan");
  await expect(page.locator(".kopt")).toHaveCount(3, { timeout: 30_000 });
  expect(await twin(page, (s) => s.applied.length)).toBe(0);
});

test("kiosk: 'Show me in 60 seconds' plays the planner story with captions; a touch takes over", async ({ page }) => {
  test.setTimeout(150_000);
  await openKiosk(page, "&idle=600");
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-show").click();
  const cap = page.getByTestId("kiosk-caption");
  await expect(cap).toContainText("GITEX");
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "crowd", { timeout: 30_000 });
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "plan", { timeout: 30_000 });
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "decide", { timeout: 40_000 });
  await expect(cap).toContainText("Before and after");
  await shot(page, "14_sixty_second_show");
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "attract", { timeout: 30_000 });   // ends by itself
  // again, and take over with a touch on the map
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-show").click();
  await expect(cap).toBeVisible();
  await page.waitForTimeout(2500);
  await page.mouse.click(500, 500);
  await expect(cap).toHaveCount(0);
  await expect(page.getByTestId("kiosk")).not.toHaveAttribute("data-phase", "attract");
  await page.waitForTimeout(4000);
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "event");          // it stays where the visitor took over
});

test("kiosk: your own event, high contrast, and the team's booth statistics", async ({ page }) => {
  await openKiosk(page, "&idle=600");
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-planner").click();
  await page.getByTestId("kiosk-own").click();
  await expect(page.getByRole("heading", { name: "Your own event" })).toBeVisible();
  await page.waitForFunction(() => (window as unknown as S).__twin.getState().forecast?.event?.id === "custom");
  await page.locator(".kchips").getByRole("button", { name: "Business Bay" }).click();
  await page.getByRole("button", { name: "Late night" }).click();
  await page.waitForTimeout(600); await settled(page);
  await shot(page, "15_own_event");
  await page.getByRole("button", { name: /See the crowd/ }).click();
  await expect(page.locator(".kquiz button")).toHaveCount(6);
  await page.getByTestId("kiosk-contrast").click();
  await expect(page.locator(".kiosk-root")).toHaveClass(/khc/);
  await page.waitForTimeout(600);
  await shot(page, "16_high_contrast");
  const foot = (await page.locator(".kdisc").boundingBox())!;                              // hold the footer for 3 s
  await page.mouse.move(foot.x + 200, foot.y + foot.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(3300);
  await page.mouse.up();
  const stats = page.getByTestId("kiosk-stats");
  await expect(stats).toContainText("Touched the screen");
  await expect(stats).toContainText("Built an own event");
});

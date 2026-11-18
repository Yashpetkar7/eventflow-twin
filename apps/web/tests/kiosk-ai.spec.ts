// The kiosk's AI sheet, plan editor and extra filters (contract 1.18.0, decision #155), at the booth resolution.
// Checked: the AI offers scenarios it has already tested and the figure on each button is the figure the twin then
// shows; a visitor can type on the built-in keyboard (English and Arabic layouts) and the scenario changes; an event
// described in words is shown back and applied only on confirmation; an AI option can be edited, is re-simulated, and
// the edited version is what gets approved and logged; the stress test's rules; a rider's preferences change the
// answer and are said. Screenshots → eval/results/ui/kiosk_ai/. Runs with WebGL off on CI (EFT_NO_GL=1).
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../eval/results/ui/kiosk_ai");
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

type S = { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean; planStatus: string; threshold: number; priority: string;
  scenario: { eventId: string; weather: string; exitSigma: number | null; custom: { near: string } };
  forecast: { run_id: string; attendance_used: number; weather: string } | null; plan: { options: unknown[] } | null;
  cur: { resp: { summary: { peak_lf: number; excess_pax: number } } } | null; applied: { title: string; ivs: unknown[] }[]; log: { kind: string; title?: string }[];
  pause: { checkpoint: string } | null };
type W = Window & { __twin: { getState: () => S } };

async function openKiosk(page: Page, q = "&ask=0") {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.goto(`/?kiosk=1&idle=600${q}`);
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
}
const twin = <T,>(page: Page, fn: (s: S) => T) => page.evaluate(`(${fn.toString()})(window.__twin.getState())`) as Promise<T>;
const idle = (page: Page) => page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
const sheet = (page: Page, status: string) => expect(page.getByTestId("kai")).toHaveAttribute("data-status", status, { timeout: 30_000 });
const asPlanner = async (page: Page) => { await page.getByTestId("kiosk-start").click(); await page.getByTestId("kiosk-planner").click(); await idle(page); };
const tap = async (page: Page, word: string) => { for (const ch of word) await (ch === " " ? page.locator(".kai-row button.space") : page.locator(`.kai-row button[data-k="${ch}"]`)).click(); };

test("kiosk AI: tested suggestions, one tap makes one the scenario, typing on the built-in keyboard, undo", async ({ page }) => {
  await openKiosk(page);
  await asPlanner(page);
  const before = await twin(page, (s) => ({ att: s.forecast!.attendance_used, peak: s.cur!.resp.summary.peak_lf }));
  expect(before.peak).toBeLessThan(0.85);                                                    // GITEX on a normal day: nothing over the line
  await page.getByTestId("kai-open").click();
  await sheet(page, "answered");                                                             // the sheet opens with suggestions, not an empty box
  await expect(page.getByTestId("kai")).toHaveAttribute("data-intent", "suggest");
  const crowd = page.locator('[data-testid="kai-options"] button[data-label="chat.opt.tryCrowd"]');
  await expect(crowd).toBeVisible();
  expect(await page.locator('[data-testid="kai-options"] button').count()).toBeGreaterThanOrEqual(2);
  const promised = Number(/(\d+)%/.exec(await crowd.innerText())![1]);
  expect(promised).toBeGreaterThan(85);                                                      // the suggested crowd is one that crosses the line
  await shot(page, "1_suggestions");

  await crowd.click();                                                                       // human in the loop: nothing changed until this tap
  await sheet(page, "applied");
  await page.waitForFunction((a) => (window as unknown as W).__twin.getState().forecast?.attendance_used !== a, before.att);
  await idle(page);
  expect(await twin(page, (s) => Math.round(s.cur!.resp.summary.peak_lf * 100))).toBe(promised);   // the button's figure is the twin's figure
  await expect(page.getByTestId("kai-undo")).toBeVisible();

  // type on the built-in keyboard; every key is a touch target and the page does not scroll
  await page.getByTestId("kai-type").click();
  await expect(page.getByTestId("kai-keys")).toHaveAttribute("data-layout", "en");
  await expect(page.getByTestId("kai-phrases").locator("button")).toHaveCount(5);
  await tap(page, "make it hox");
  await page.getByTestId("kai-del").click();                                                 // a typo, deleted
  await tap(page, "t");
  await expect(page.getByTestId("kai-input")).toHaveValue("make it hot");
  const sizes = await page.locator(".kai button").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
  expect(sizes.length).toBeGreaterThan(40);
  for (const [w, h] of sizes) { expect(h).toBeGreaterThanOrEqual(56); expect(w).toBeGreaterThanOrEqual(56); }
  const box = await page.getByTestId("kai").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(84);                                                 // under the top bar, inside the screen
  expect(box!.y + box!.height).toBeLessThanOrEqual(1080);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await shot(page, "2_keyboard");
  await page.getByTestId("kai-send").click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().forecast?.weather === "hot", null, { timeout: 30_000 });
  await sheet(page, "applied");

  await page.getByTestId("kai-type").click();                                                // the Arabic layout
  await page.getByTestId("kai-lang").click();
  await expect(page.getByTestId("kai-keys")).toHaveAttribute("data-layout", "ar");
  await expect(page.locator('.kai-row button[data-k="ض"]')).toBeVisible();
  await page.getByTestId("kai-type").click();

  await page.getByTestId("kai-undo").click();                                                // the last change is taken back
  await sheet(page, "applied");
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().forecast?.weather === "normal");
  await page.getByTestId("kai-close").click();
  await expect(page.getByTestId("kai")).toHaveCount(0);
});

test("kiosk AI: describe an event in words, confirm it, the team plans; edit the AI's plan and approve your own version", async ({ page }) => {
  test.setTimeout(240_000);
  await openKiosk(page);
  await asPlanner(page);
  await page.getByTestId("kai-open").click();
  await sheet(page, "answered");
  await page.getByTestId("kai-describe").click();
  await page.getByTestId("kai-input").fill("A concert for 60000 people near Burj Khalifa ending at 23:00 on a hot day");
  await page.getByTestId("kai-send").click();
  await sheet(page, "brief");
  const brief = page.getByTestId("kai-brief");
  await expect(brief).toContainText("60,000");
  await expect(brief).toContainText(/hot day/i);
  expect(await twin(page, (s) => s.scenario.eventId)).not.toBe("custom");                    // shown back first: nothing applied yet
  if (await page.getByTestId("kai-near").count()) await page.getByTestId("kai-near").locator("button").first().click();
  await shot(page, "3_brief_to_confirm");
  await page.getByTestId("kai-brief-use").click();
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "plan");
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().planStatus === "ready", null, { timeout: 120_000 });
  const sc = await twin(page, (s) => ({ ev: s.scenario.eventId, att: s.forecast!.attendance_used, w: s.forecast!.weather, n: s.plan!.options.length }));
  expect(sc).toMatchObject({ ev: "custom", att: 60000, w: "hot" });
  expect(sc.n).toBeGreaterThan(0);

  await page.getByTestId("kiosk-edit").first().click();                                      // edit the AI's first option
  const ed = page.getByTestId("kiosk-editor");
  await expect(ed).toHaveAttribute("data-state", "same");
  await expect(page.getByTestId("kedit-approve")).toBeDisabled();                            // nothing to approve until a version has been tested
  const more = page.getByTestId("kedit-more"), drop = page.getByTestId("kedit-drop");
  if (await more.count()) await more.first().click(); else await drop.first().click();
  await expect(ed).toHaveAttribute("data-state", /tested|empty|refused/, { timeout: 30_000 });
  if ((await ed.getAttribute("data-state")) !== "tested") { await (await more.count() ? page.getByTestId("kedit-less").first() : drop.first()).click(); await page.getByTestId("kedit-less").first().click(); }
  await expect(ed).toHaveAttribute("data-state", "tested", { timeout: 30_000 });
  await expect(page.getByTestId("kedit-peak")).toHaveText(/\d+%/);
  await expect(page.getByTestId("kedit-verdict")).toHaveText(/AI's plan/);
  const mine = Number((await page.getByTestId("kedit-over").innerText()).replace(/[^\d]/g, ""));
  await shot(page, "4_plan_editor");
  await page.getByTestId("kedit-approve").click();
  await expect(page.getByTestId("kiosk")).toHaveAttribute("data-phase", "decide", { timeout: 30_000 });
  await idle(page);
  const done = await twin(page, (s) => ({ title: s.applied[0]?.title ?? "", n: s.applied.length, log: s.log[0], over: Math.round(s.cur!.resp.summary.excess_pax) }));
  expect(done.n).toBe(1);
  expect(done.title).toMatch(/^My version of: /);
  expect(done.log).toMatchObject({ kind: "approve", title: done.title });                    // the visitor's approval of their own version is logged
  expect(done.over).toBe(mine);                                                              // the twin shows what the editor tested
  await shot(page, "5_my_version_approved");
});

test("kiosk stress test: the rules tab sets the comfort line, the exit window and what the team favours; Home resets them", async ({ page }) => {
  await openKiosk(page);
  await asPlanner(page);
  await page.getByRole("button", { name: /See the crowd/ }).click();
  await page.locator(".kquiz button").first().click();
  await expect(page.locator(".kresult")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("kiosk-lab").click();
  await page.getByTestId("kiosk-lab-rules").click();
  await page.getByTestId("kiosk-line").getByRole("button", { name: "75%" }).click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().threshold === 0.75);
  await page.getByTestId("kiosk-exit").getByRole("button", { name: "Slowly" }).click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().scenario.exitSigma === 60);
  await idle(page);
  await page.getByTestId("kiosk-priority").getByRole("button", { name: "lowest cost" }).click();
  expect(await twin(page, (s) => s.priority)).toBe("cost");
  await page.getByTestId("kiosk-weather").getByRole("button", { name: "Rain" }).click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().forecast?.weather === "rain");
  const heights = await page.locator(".kcard button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(56);
  await shot(page, "6_rules");
  await page.locator(".khome").click();                                                      // the next visitor starts from the defaults
  await idle(page);
  expect(await twin(page, (s) => ({ t: s.threshold, p: s.priority, w: s.scenario.weather, x: s.scenario.exitSigma }))).toEqual({ t: 0.85, p: "balanced", w: "normal", x: null });
});

test("kiosk rider: what matters to this visitor changes the answer and is said; a typed question is answered", async ({ page }) => {
  await openKiosk(page);
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-rider").click();
  await idle(page);
  await page.getByTestId("kai-open").click();
  await expect(page.getByTestId("kai")).toHaveAttribute("data-mode", "ride");
  await page.locator('.kai-chips button[data-intent="which_station"]').click();
  await sheet(page, "answered");
  const plain = await page.getByTestId("kai-answer").innerText();
  await page.locator('[data-testid="kai-prefs"] button[data-pref="quiet"]').click();         // asked again, for this visitor
  await expect(page.locator('[data-testid="kai-answer"] [data-key="kiosk.pref.quiet"]')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByTestId("kai-answer").innerText()).not.toBe(plain);
  await page.locator('[data-testid="kai-prefs"] button[data-pref="step_free"]').click();
  await expect(page.locator('[data-testid="kai-answer"] [data-key="kiosk.accessNote"]')).toBeVisible({ timeout: 30_000 });
  await shot(page, "7_rider_preferences");
  await page.getByTestId("kai-type").click();
  await page.getByTestId("kai-input").fill("when should I leave");
  await page.getByTestId("kai-send").click();
  await expect(page.getByTestId("kai")).toHaveAttribute("data-intent", "when_leave", { timeout: 30_000 });
  await page.getByTestId("kai-type").click();
  await page.getByTestId("kai-input").fill("make it 60000 people");                          // a travelling visitor cannot change the scenario
  const att = await twin(page, (s) => s.forecast!.attendance_used);
  await page.getByTestId("kai-send").click();
  await expect(page.getByTestId("kai")).not.toHaveAttribute("data-status", "applied");
  await expect(page.getByTestId("kai")).not.toHaveAttribute("data-status", "busy", { timeout: 30_000 });
  expect(await twin(page, (s) => s.forecast!.attendance_used)).toBe(att);
});

test("kiosk, asking on (the default): a calm day → 'Ask the AI team anyway' → the team tests harder and asks the visitor", async ({ page }) => {
  test.setTimeout(180_000);
  await openKiosk(page, "");                                                                 // no ?ask=0: as the booth runs it
  await asPlanner(page);
  await page.getByRole("button", { name: /See the crowd/ }).click();
  await page.locator(".kquiz button").first().click();
  await expect(page.locator(".kresult")).toBeVisible({ timeout: 30_000 });
  const att = await twin(page, (s) => s.forecast!.attendance_used);
  await page.getByTestId("kiosk-team-anyway").click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().planStatus === "paused", null, { timeout: 60_000 });
  expect(await twin(page, (s) => s.pause!.checkpoint)).toBe("calm");
  const card = page.getByTestId("kiosk-checkpoint");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("cp-try").first()).toBeVisible();
  for (const h of await card.locator("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(56);
  await shot(page, "8_calm_question_on_the_kiosk");
  await card.locator('[data-testid="cp-try"][data-probe="crowd"]').click();                  // the visitor's choice becomes the scenario
  await page.waitForFunction((a) => { const s = (window as unknown as W).__twin.getState(); return (s.forecast?.attendance_used ?? a) > a && (s.planStatus === "paused" || s.planStatus === "ready"); }, att, { timeout: 90_000 });
});

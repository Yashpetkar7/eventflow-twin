import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// The agentic loop with the human in it (decision #144): the team stops and asks, the human answers, a rejection's
// reason makes the team replan, and in the event chain changed conditions make the Watcher re-check the approved plan.
const OUT = "../../eval/results/ui/loop";
fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
type S = Record<string, unknown> & { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean; planStatus: string };
type W = Window & { __twin: { getState: () => S & Record<string, (...a: unknown[]) => unknown> } };
const API = `http://localhost:${process.env.EFT_API_PORT ?? 8000}`;

async function open(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); localStorage.setItem("eventflow.locale", "en"); } catch { /* ignore */ } });
  await page.goto("/");
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
  await page.evaluate(() => { const t = (window as unknown as W).__twin.getState(); t.selectEvent("downtown_night"); });
  await page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
  await page.evaluate(() => { (window as unknown as W).__twin.getState().patchScenario({ attendance: 60000 }); });
  await page.waitForTimeout(800);
  await page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
}
const settled = (page: Page) => page.waitForFunction(() => !["running", "idle"].includes((window as unknown as W).__twin.getState().planStatus), null, { timeout: 120_000 });

test("AI plan: the team asks, the planner answers, rejects with a reason, and the team replans with it", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "AI plan" }).click();
  await page.getByTestId("ask-me").locator("input").check();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await settled(page);
  const ask = page.getByTestId("checkpoint");
  await expect(ask).toBeVisible();
  await expect(ask).toHaveAttribute("data-checkpoint", "hotspot");
  await expect(ask).toContainText("Burj Khalifa/Dubai Mall");
  await expect(ask).toBeInViewport();                                                          // the waiting question is brought into view
  await shot(page, "1_team_asks");
  await ask.locator('[data-testid="cp-focus"][data-station="BBY"]').click();                  // plan for Business Bay instead
  await settled(page);
  await expect(page.locator("article.opt").first()).toBeVisible();
  const s1 = await page.evaluate(() => { const g = (window as unknown as W).__twin.getState() as unknown as { answers: unknown[]; mission: { events: { key: string; params: Record<string, unknown> }[] } };
    return { answers: g.answers, focus: g.mission.events.find((e) => e.key === "diagnosis.focus")?.params.worst }; });
  expect(s1.answers).toEqual([{ checkpoint: "hotspot", action: "focus", station: "BBY" }]);
  expect(s1.focus).toBe("BBY");
  await shot(page, "2_after_answer");

  const top = page.locator("article.opt").first();
  const firstMeasure = await page.evaluate(() => ((window as unknown as W).__twin.getState() as unknown as { plan: { options: { interventions: { type: string }[] }[] } }).plan.options[0].interventions[0].type);
  await top.getByTestId("opt-reject").click();
  const form = top.getByTestId("reason-form");
  await form.locator('[data-reason="too_costly"]').click();
  await form.locator(`[data-avoid="${firstMeasure}"]`).click();
  await shot(page, "3_why_not");
  await form.getByTestId("reason-replan").click();
  await page.waitForTimeout(500);
  await settled(page);
  const banner = page.getByTestId("feedback-banner");
  await expect(banner).toContainText("Round 2");
  await banner.scrollIntoViewIfNeeded();
  const s2 = await page.evaluate(() => { const g = (window as unknown as W).__twin.getState() as unknown as { constraints: { forbid_types: string[]; cost_cap: number | null }; priority: string; answers: { checkpoint: string }[]; planStatus: string; plan: { options: { interventions: { type: string }[] }[] } | null };
    return { forbid: g.constraints.forbid_types, cap: g.constraints.cost_cap, prio: g.priority, answers: g.answers, status: g.planStatus,
      types: (g.plan?.options ?? []).flatMap((o) => o.interventions.map((i) => i.type)) }; });
  expect(s2.forbid).toContain(firstMeasure);
  expect(s2.prio).toBe("cost");
  expect(s2.cap).not.toBeNull();
  expect(s2.answers.every((a) => a.checkpoint === "hotspot")).toBe(true);                       // the hotspot answer is kept
  expect(s2.types).not.toContain(firstMeasure);                                                  // the replan respects the reason
  const log = await (await page.request.get(`${API}/decisions?limit=5`)).json() as { items: { decision: string; reason_codes?: string[] }[] };
  expect(log.items[0].decision).toBe("reject");
  expect(log.items[0].reason_codes).toEqual(expect.arrayContaining(["too_costly", `avoid:${firstMeasure}`]));
  await shot(page, "4_replanned");
  await page.getByRole("tab", { name: "AI team" }).click();
  const feed = page.getByTestId("team-feed");
  await expect(feed).toContainText("Your answer: plan for Business Bay instead");
});

test("event chain: question, answer, reject with a reason, replan, approve, then rain makes the Watcher re-check", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await page.getByRole("tab", { name: "Alerts" }).click();
  const chain = page.getByTestId("chain");
  await expect(chain.getByTestId("chain-askme")).toBeChecked();
  await chain.getByTestId("chain-start").click();
  const cp = chain.getByTestId("chain-checkpoint");
  await expect(cp).toBeVisible({ timeout: 60_000 });
  await cp.getByTestId("cp-confirm").click();
  // a partial checkpoint may follow; then the plan reaches the inbox
  for (let i = 0; i < 3; i++) {
    if (await chain.getByTestId("chain-inbox").isVisible()) break;
    if (await cp.getByTestId("cp-accept").isVisible().catch(() => false)) await cp.getByTestId("cp-accept").click();
    await page.waitForTimeout(1500);
  }
  await expect(chain.getByTestId("chain-inbox")).toBeVisible({ timeout: 60_000 });
  await chain.getByTestId("chain-reject").click();
  await chain.getByTestId("reason-form").locator('[data-protect="BBY"]').click();
  await chain.getByTestId("reason-form").getByTestId("reason-words").fill("no robotaxis tonight");
  await chain.getByTestId("reason-replan").click();
  await expect(chain.locator('[data-topic="feedback.read"]')).toBeVisible({ timeout: 60_000 });
  await expect(chain.getByTestId("chain-inforce")).toContainText("keeps Business Bay calm");
  await shot(page, "5_chain_feedback");
  for (let i = 0; i < 8; i++) {                                                                   // answer and approve until the day ends
    if (await chain.getByTestId("chain-ended").isVisible()) break;
    const q = chain.getByTestId("chain-checkpoint");
    if (await q.isVisible()) {
      const acc = q.getByTestId("cp-accept");
      await ((await acc.isVisible()) ? acc : q.getByTestId("cp-confirm")).click();
    } else if (await chain.getByTestId("chain-approve").isVisible()) {
      await chain.getByTestId("chain-approve").click();
    }
    await page.waitForTimeout(2000);
  }
  await expect(chain.getByTestId("chain-change")).toBeVisible({ timeout: 60_000 });
  await chain.getByTestId("chain-change").locator('[data-change="rain"]').click();
  await expect(chain.locator('[data-topic="plan.checked"]')).toBeVisible({ timeout: 60_000 });
  await expect(chain.getByTestId("chain-loop")).toContainText("1 changes");
  await shot(page, "6_chain_rain_recheck");
});

test("duty inbox on a phone: the team's question waits there and is answered with one tap", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const label = `Loop test night ${Date.now() % 100000}`;
  const r = await request.post(`${API}/chain/start`, { data: { forecast: { event_id: "downtown_night", attendance: 60000 }, checkpoints: ["hotspot"], label } });
  expect(r.ok()).toBe(true);
  const st = await r.json() as { chain_id: string };
  await page.addInitScript(() => { try { localStorage.setItem("eventflow.locale", "en"); } catch { /* ignore */ } });
  await page.goto("/inbox");
  const q = page.getByTestId("ops-questions");
  await expect(q).toBeVisible({ timeout: 30_000 });
  const mine = q.locator("div").filter({ hasText: label }).filter({ has: page.getByTestId("ops-question") }).last();
  await expect(mine).toBeVisible();
  await shot(page, "7_inbox_question_phone");
  await mine.getByTestId("cp-confirm").click();
  await expect(page.getByTestId("ops-item").filter({ hasText: label })).toBeVisible({ timeout: 60_000 });
  const after = await (await request.get(`${API}/chain/${st.chain_id}`)).json() as { status: string; inbox: unknown };
  expect(after.status).toBe("awaiting_human");
  expect(after.inbox).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

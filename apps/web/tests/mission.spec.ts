// The agent team on screen (contract 1.11.0, docs/15): the workspace "AI team" tab, typed constraints, Arabic,
// the offline snapshot when the API is down, and the kiosk's "watch the AI team work" step with its Skip button.
import { expect, test, type Page } from "@playwright/test";

// The planning-service banner only: with WebGL off a second banner ("3D needs WebGL") is also on screen.
const apiBanner = (page: Page) => page.locator(".banner:not(.demo)").filter({ hasText: "planning service" });
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../eval/results/ui/team");
const API = `http://localhost:${process.env.EFT_API_PORT ?? 8000}`;
fs.mkdirSync(OUT, { recursive: true });

type M = { engine: string; events: { agent: string; key: string; params: Record<string, unknown> }[]; plan: { options: { interventions: { type: string }[] }[] };
  rejected: { reason: string }[]; assessments: { checks: { id: string }[]; total: number }[]; recording: { mode: string } };
type S = { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean; planStatus: string; missionShown: number; mission: M | null;
  patchScenario: (p: object) => void; runAgents: (l: string) => Promise<void>; kiosk: boolean };
type W = Window & { __twin: { getState: () => S; setState: (s: object) => void } };

async function open(page: Page, url = "/?scene=v1") {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); localStorage.clear(); } catch { /* ignore */ } });
  await page.goto(`${url}${url.includes("?") ? "&" : "?"}ask=0`);   // ask=0: "Ask me during planning" is on by default (1.18.0); these tests plan in one tap unless they test the questions
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
}
const idle = (page: Page) => page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
const hot = async (page: Page) => { await page.evaluate(() => (window as unknown as W).__twin.getState().patchScenario({ weather: "hot" })); await page.waitForTimeout(300); await idle(page); };
const ready = (page: Page) => page.waitForFunction(() => (window as unknown as W).__twin.getState().planStatus === "ready", null, { timeout: 60_000 });
const mission = (page: Page) => page.evaluate(() => (window as unknown as W).__twin.getState().mission!);

test("AI team tab: every layer acts, the feed names the simulator's runs, the critic's checks and the stress test are shown", async ({ page }) => {
  await open(page);
  await hot(page);
  await page.getByRole("tab", { name: /AI team/ }).click();
  await expect(page.getByTestId("team-graph").locator("[data-agent]")).toHaveCount(16);
  await page.getByTestId("team-run").click();
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().missionShown >= 8);
  await expect(page.getByTestId("team-graph").locator(".team-chip.on")).toHaveCount(1);       // one agent at work at a time
  await ready(page);
  const m = await mission(page);
  expect(m.engine).toBe("graph");
  await expect(page.getByTestId("team-engine")).toContainText("LangGraph");
  await expect(page.getByTestId("team-feed").locator("li")).toHaveCount(m.events.length);
  for (const a of ["supervisor", "intake", "diagnosis", "rail", "station_crowd", "composer", "simulation", "critic", "stress", "ranker", "explainer", "verifier", "human"])
    await expect(page.getByTestId("team-graph").locator(`[data-agent="${a}"]`)).toHaveClass(/done/);
  await expect(page.getByTestId("team-feed").locator('li[data-key="simulation.result"]').first()).toContainText("sim_");
  await expect(page.getByTestId("team-feed").locator('li[data-key="verifier.checked"]')).toContainText("all match the simulator");
  await expect(page.getByTestId("team-checks").locator("tbody tr")).toHaveCount(7);
  await expect(page.getByTestId("team-checks")).toContainText("Holds under stress");
  await expect(page.getByTestId("team-rejected")).toBeVisible();
  await expect(page.getByTestId("team-budget")).toContainText("Simulations");
  await expect(page.getByTestId("team-scorecard")).toContainText("Critic recall");
  await page.screenshot({ path: `${OUT}/team_tab_done.png` });
  await page.getByRole("tab", { name: /AI plan/ }).click();
  await expect(page.getByTestId("stress-badge").first()).toContainText("stress tests");
});

test("constraints: a measure the planner forbids is never simulated or offered; text in the goal never becomes a constraint", async ({ page }) => {
  await open(page);
  await hot(page);
  await page.getByRole("tab", { name: /AI team/ }).click();
  await page.locator('[data-forbid="extra_trains"]').click();
  await page.locator('[data-forbid="staggered_exit"]').click();
  await page.getByTestId("team-run").click();
  await ready(page);
  const m = await mission(page);
  const offered = m.plan.options.flatMap((o) => o.interventions.map((i) => i.type));
  expect(offered).not.toContain("extra_trains");
  expect(offered).not.toContain("staggered_exit");
  expect(m.rejected.some((r) => r.reason === "forbidden")).toBe(true);
  const sims = m.events.filter((e) => e.key === "simulation.result").flatMap((e) => (e.params?.types as string[]) ?? []);
  expect(sims).not.toContain("extra_trains");
  await expect(page.getByTestId("team-feed")).toContainText("your constraint");
});

test("Arabic: the team's work is written in Arabic, right to left", async ({ page }) => {
  await open(page, "/?scene=v1&lang=ar");
  await hot(page);
  await page.locator("#tab-team").click();
  await page.getByTestId("team-run").click();
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const text = await page.getByTestId("team-feed").innerText();
  expect(text).toMatch(/[؀-ۿ]/);
  expect(text).toContain("مطابقة");                                                             // "all match the simulator"
  await page.screenshot({ path: `${OUT}/team_tab_ar.png` });
});

test("API down: a mission recorded in the offline snapshot still plays", async ({ page }) => {
  await open(page);
  await page.route(`${API}/**`, (r) => r.abort());
  await page.evaluate(() => { void (window as unknown as W).__twin.getState().runAgents("en"); });
  await ready(page);
  const m = await mission(page);
  expect(m.events.length).toBeGreaterThan(5);                                                // a normal day: no station over the line
  expect(m.events.at(-1)!.key).toBe("supervisor.no_action");
  await expect(apiBanner(page)).toContainText("not reachable");
});

test("kiosk: the visitor watches the AI team work, and can skip it", async ({ page }) => {
  await open(page, "/?kiosk=1&scene=v1&idle=600");
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-planner").click();
  await page.locator(".kevent").first().click();
  await page.locator(".kseg").getByRole("button", { name: "Hot day" }).click();
  await idle(page);
  await page.getByRole("button", { name: /See the crowd/ }).click();
  await page.locator(".kquiz").getByRole("button", { name: "World Trade Centre" }).click();
  await expect(page.locator(".kverdict")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Ask the AI for a plan/ }).click();
  await page.locator('.kideas button[data-idea="stagger"]').click();
  await expect(page.getByTestId("kiosk-team")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("kiosk-team").locator(".team-chip.on")).toHaveCount(1);
  await expect(page.locator(".kteam-now")).not.toBeEmpty();
  const skip = await page.getByTestId("kiosk-team-skip").boundingBox();
  expect(skip!.height).toBeGreaterThanOrEqual(48);                                           // touch target
  await page.screenshot({ path: `${OUT}/kiosk_team_working.png` });
  await page.getByTestId("kiosk-team-skip").click();
  await expect(page.locator(".kopt")).toHaveCount(3, { timeout: 10_000 });
});

// ---- standing agents (contract 1.12.0)
test("watcher: the Alerts tab raises World Trade Centre's alert hours ahead and hands over to the AI team", async ({ page }) => {
  await open(page);
  await hot(page);
  await page.evaluate(() => (window as unknown as W).__twin.setState({ time: 14.25 }));
  await page.locator("#tab-alerts").click();
  await expect(page.getByTestId("watcher")).toBeVisible();
  await expect(page.getByTestId("watch-alert").first()).toContainText("World Trade Centre crosses the line at 15:00");
  await expect(page.getByTestId("watch-alert").first()).toContainText("in 1 hour");
  await page.screenshot({ path: `${OUT}/watcher_alerts.png` });
  await page.getByTestId("watch-run").click();
  await expect(page.getByTestId("team-graph")).toBeVisible();
  await ready(page);
});

test("ask the twin: chips answer from tools with their run id; an off-topic question is refused", async ({ page }) => {
  await open(page);
  await hot(page);
  await page.locator("#tab-team").click();
  await page.locator('[data-intent="break_point"]').click();
  await expect(page.getByTestId("ask-answer")).toContainText("crosses the line at about");
  await expect(page.getByTestId("ask-answer")).toContainText("brk_");
  await page.locator('[data-intent="if_rain"]').click();
  await expect(page.getByTestId("ask-answer")).toContainText("If it rains");
  await page.getByTestId("ask-input").fill("Write me a poem about cats");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("ask-answer")).toContainText("I only answer questions about crowding");
  await page.getByTestId("ask").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/ask_twin.png` });
});

test("messenger: approving an option drafts the passenger notice and signage, marked as a draft", async ({ page }) => {
  await open(page);
  await hot(page);
  await page.getByRole("tab", { name: /AI plan/ }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await ready(page);
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("response", (r) => { if (r.url().includes("/agent/message")) errs.push(`message ${r.status()}`); });
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await page.waitForFunction(() => !!(window as unknown as { __twin: { getState: () => { drafts: unknown } } }).__twin.getState().drafts, null, { timeout: 15_000 })
    .catch(() => { throw new Error(`no drafts: ${errs.join(" | ")}`); });
  await page.locator("#tab-team").click();
  await expect(page.getByTestId("messenger")).toContainText("DRAFT");
  await expect(page.getByTestId("messenger")).toContainText("expected to be very busy");
  await expect(page.getByTestId("messenger")).toContainText("all match the simulator");
  await page.getByTestId("messenger").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/messenger_drafts.png` });
});

// ---- incidents, the duty shift, the debate and the operations brief (contract 1.13.0, decision #128)
type Shift = { status: string; items: { hour: number; decision: string; title: string | null; overBefore: number; overAfter: number | null }[]; step: { reason: string; done: boolean; recommended_rank: number | null; residual: { overcap_station_hours: number } } | null };
const shiftOf = (page: Page) => page.evaluate(() => (window as unknown as { __twin: { getState: () => { shift: Shift } } }).__twin.getState().shift);

test("duty shift: a train fault is injected, the shift stops for a decision, an approval is logged and the day ends clear", async ({ page, request }) => {
  await open(page);
  const before = (await (await request.get(`${API}/decisions?limit=1`)).json()).total as number;
  await page.getByRole("tab", { name: /Alerts/ }).click();
  await expect(page.getByTestId("duty")).toBeVisible();
  await page.locator('[data-incident="train_fault"]').click();
  await expect(page.getByTestId("incident-info")).toContainText("Red Line runs 50% of its trains from 16:00 to 18:00");   // the server's figures (config/incidents.yaml)
  await expect(page.getByTestId("incident-info")).toContainText("not an RTA figure");
  await idle(page);
  await page.getByTestId("duty-start").click();
  const item = page.getByTestId("duty-item");
  await expect(item).toBeVisible({ timeout: 60_000 });
  await expect(item).toContainText("16:00 · your decision");
  await expect(item).toContainText("World Trade Centre crosses the line at 16:00");
  await expect(item).toContainText("Clears every station");
  expect((await (await request.get(`${API}/decisions?limit=1`)).json()).total).toBe(before);     // nothing is decided by the shift itself
  await page.screenshot({ path: `${OUT}/duty_inbox.png` });
  // the team's work behind the proposal, with the debate between the specialists and the critic
  await page.getByTestId("duty-team").click();
  const debate = page.getByTestId("team-debate");
  await expect(debate).toBeVisible();
  await expect(debate.locator("li.kept").first()).toContainText("Offered as option 1");
  await expect(debate.locator("li").first()).toContainText(/sim_[0-9a-f]{12}/);                  // every case cites its simulation
  await debate.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/debate.png` });
  await page.getByRole("tab", { name: /Alerts/ }).click();
  await page.getByTestId("duty-approve").click();
  await expect(page.getByTestId("duty-done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("duty-done")).toContainText("No station is over the line for the rest of the day");
  const sh = await shiftOf(page);
  expect(sh.status).toBe("done");
  expect(sh.step!.reason).toBe("clear");
  expect(sh.items).toHaveLength(1);
  expect(sh.items[0].decision).toBe("approve");
  expect(sh.items[0].overAfter).toBe(0);
  expect((await (await request.get(`${API}/decisions?limit=1`)).json()).total).toBe(before + 1);  // the human's approval, and only that
  // the operations brief: a draft, with the incident, the decision, the effect and the messenger's drafts in both languages
  await page.getByTestId("duty-brief").click();
  const brief = page.getByTestId("brief");
  await expect(brief).toContainText("DRAFT");
  await expect(brief).toContainText("not an RTA document");
  await expect(page.getByTestId("brief-incident")).toContainText("Train fault");
  await expect(brief).toContainText("Station-hours over the line");
  await expect(brief.locator('.brief-msg[lang="ar"]')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${OUT}/operations_brief.png` });
  await page.getByTestId("brief-close").click();
  await expect(brief).toBeHidden();
});

test("duty shift: a rejected proposal is not asked again, and what is left is reported, not hidden", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as unknown as { __twin: { getState: () => { selectEvent: (id: string) => void } } }).__twin.getState().selectEvent("downtown_night"));
  await page.waitForTimeout(400);
  await idle(page);
  await page.getByRole("tab", { name: /Alerts/ }).click();
  await page.getByTestId("duty-start").click();
  for (let i = 0; i < 6; i++) {
    await page.waitForFunction(() => ["awaiting", "done"].includes((window as unknown as { __twin: { getState: () => { shift: { status: string } } } }).__twin.getState().shift.status), null, { timeout: 60_000 });
    const now = await shiftOf(page);
    if (now.status === "done") break;
    await page.getByTestId("duty-reject").click();
    await page.waitForFunction((n) => (window as unknown as { __twin: { getState: () => { shift: { items: unknown[] } } } }).__twin.getState().shift.items.length > n, now.items.length, { timeout: 30_000 });
  }
  const sh = await shiftOf(page);
  expect(sh.status).toBe("done");
  expect(sh.step!.reason).toBe("residual");
  expect(sh.items.length).toBeGreaterThanOrEqual(1);
  expect(sh.items.every((i) => i.decision === "reject")).toBe(true);
  expect(sh.step!.residual.overcap_station_hours).toBeGreaterThan(0);
  await expect(page.getByTestId("duty-done")).toContainText("goes to the duty manager");
  await page.screenshot({ path: `${OUT}/duty_residual.png` });
});

test("duty shift in Arabic: the inbox reads right to left with the same figures", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "عربي" }).click();
  await page.locator("#tab-alerts").click();
  await page.locator('[data-incident="crowd_surge"]').click();
  await expect(page.getByTestId("incident-info")).toContainText("52,000");                      // 40,000 × 1.3, resolved by the server
  await idle(page);
  await page.getByTestId("duty-start").click();
  await expect(page.getByTestId("duty-item")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("duty-item")).toContainText("قرارك");
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await page.screenshot({ path: `${OUT}/duty_inbox_ar.png` });
});

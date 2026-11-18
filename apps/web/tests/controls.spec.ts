// The scene's controls, operated the way a visitor does: by clicking them (decision #146). The other suites set the
// store directly, which would pass even if a checkbox or the slider were disconnected. With WebGL on, the buildings
// toggle is also checked against the renderer's own triangle count.
import { expect, test, type Page } from "@playwright/test";

type Layers = Record<"buildings" | "landmarks" | "trains" | "traffic" | "flows" | "labels", boolean>;
type S = { ready: boolean; sceneReady: boolean; glFailed: boolean; layers: Layers; time: number; playing: boolean; speed: number; selected: string; cam: string };
type W = Window & { __twin: { getState: () => S }; __eft?: { triangles: number } };
const state = <T,>(page: Page, fn: (s: S) => T) => page.evaluate(`(${fn.toString()})(window.__twin.getState())`) as Promise<T>;
const LAYERS: [keyof Layers, string][] = [["buildings", "Buildings"], ["landmarks", "Landmarks"], ["trains", "Metro trains"],
  ["traffic", "Road traffic"], ["flows", "Crowd flows"], ["labels", "Labels"]];

async function open(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => { try { sessionStorage.setItem("eft_welcome", "1"); } catch { /* ignore */ } });
  await page.goto("/");
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
}

test("layers: each checkbox switches its own layer off and on again, and only its own", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  for (const [key, label] of LAYERS) {
    const box = page.getByLabel(label, { exact: true });
    await expect(box).toBeChecked();
    await box.click();
    await expect(box).not.toBeChecked();
    const off = await state(page, (s) => s.layers);
    expect(Object.entries(off).filter(([, on]) => !on).map(([k]) => k)).toEqual([key]);
    if (key === "labels") await expect(page.locator(".tag:visible")).toHaveCount(0);       // the station and landmark name tags
    await box.click();
    expect(await state(page, (s) => Object.values(s.layers).every(Boolean))).toBe(true);
  }
  await expect(page.locator(".tag:visible").first()).toBeVisible();
});

test("layers: switching the buildings off removes their triangles from the frame", async ({ page }) => {
  test.skip(process.env.EFT_NO_GL === "1", "needs WebGL: the CI runner has no GPU, so the ui job runs with it off (EFT_NO_GL=1)");
  await open(page);
  await page.waitForFunction(() => ((window as unknown as W).__eft?.triangles ?? 0) > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const tris = () => page.evaluate(() => (window as unknown as W).__eft!.triangles);
  const before = await tris();
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Buildings", { exact: true }).click();
  await page.waitForTimeout(2500);
  const without = await tris();
  expect(without).toBeLessThan(before * 0.8);
  await page.getByLabel("Buildings", { exact: true }).click();
  await page.waitForTimeout(2500);
  expect(await tris()).toBeGreaterThan(without);
});

test("timeline: play runs the clock, speed changes its pace, pause holds it, the slider sets it", async ({ page }) => {
  await open(page);
  const slider = page.getByLabel("Time of day");
  await slider.fill("10");                                               // a visitor's drag ends in the same change event
  expect(await state(page, (s) => s.time)).toBeCloseTo(10, 1);
  await expect(slider).toHaveAttribute("aria-valuetext", "10:00");

  const advance = async (ms: number) => { const t0 = await state(page, (s) => s.time); await page.waitForTimeout(ms); return (await state(page, (s) => s.time)) - t0; };
  await page.getByRole("button", { name: "Play" }).click();
  expect(await state(page, (s) => s.playing)).toBe(true);
  const slow = await advance(2000);
  expect(slow).toBeGreaterThan(0.3);
  await page.getByLabel("Playback speed").selectOption("4");
  expect(await state(page, (s) => s.speed)).toBe(4);
  const fast = await advance(2000);
  expect(fast).toBeGreaterThan(slow * 2);                                 // four times the pace, with room for a slow frame
  await page.getByRole("button", { name: "Pause" }).click();
  expect(await state(page, (s) => s.playing)).toBe(false);
  expect(Math.abs(await advance(1000))).toBeLessThan(0.001);
});

test("camera and station: each view button sets its camera; a station chip selects that station", async ({ page }) => {
  await open(page);
  for (const [name, cam] of [["Station close-up", "close"], ["Top-down", "top"], ["Fly-through", "fly"], ["Auto-orbit", "orbit"], ["Overview", "overview"]]) {
    await page.getByRole("button", { name, exact: true }).click();
    expect(await state(page, (s) => s.cam)).toBe(cam);
  }
  await page.locator("button.pill[aria-pressed]", { hasText: /^Emirates Towers$/ }).click();          // the station chip under the panel
  expect(await state(page, (s) => s.selected)).toBe("EMT");
  await expect(page.getByText("Selected station").locator("..")).toContainText("Emirates Towers");
});

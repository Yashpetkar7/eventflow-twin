// Continue on a phone (a real QR code) and voice input on the kiosk keyboard (decision #156).
// Checked: the code is drawn in the page and holds the public rider-page link for the event, station and hour on
// screen, with nothing about the visitor in it; that link opens the rider page on that event and station; where the
// browser can read QR codes (Chrome on macOS) the drawn code is decoded and must equal the link. Voice: spoken words
// land in the field and are sent only by the visitor; on-device recognition is preferred, the online service is named
// on screen, and with neither (or ?voice=0, or offline) there is no microphone. The browser's speech engine is
// replaced by a fake here: the test covers our wiring, not the engine's accuracy.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../../../eval/results/ui/kiosk_ai");
fs.mkdirSync(OUT, { recursive: true });
type S = { ready: boolean; sceneReady: boolean; glFailed: boolean; loading: boolean; scenario: { eventId: string }; forecast: { attendance_used: number } | null };
type W = Window & { __twin: { getState: () => S }; __rec?: { lang: string; processLocally?: boolean }; __onDevice?: boolean };

async function openKiosk(page: Page, q = "") {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.goto(`/?kiosk=1&idle=600&ask=0${q}`);
  await page.waitForFunction(() => { const s = (window as unknown as W).__twin?.getState(); return s?.ready && (s.sceneReady || s.glFailed); }, null, { timeout: 90_000 });
}
const idle = (page: Page) => page.waitForFunction(() => !(window as unknown as W).__twin.getState().loading);
const fakeSpeech = (page: Page, onDevice: boolean) => page.addInitScript((dev) => {
  const w = window as unknown as Record<string, unknown>;
  class FakeRec {
    lang = ""; processLocally?: boolean; onresult: ((e: unknown) => void) | null = null; onend: (() => void) | null = null; onerror: unknown = null;
    static available = async () => (dev ? "available" : "unavailable");
    start() { w.__rec = this; setTimeout(() => { this.onresult?.({ results: [[{ transcript: "make it 60000 people" }]] }); this.onend?.(); }, 200); }
    stop() { this.onend?.(); }
    abort() { /* nothing to release */ }
  }
  w.SpeechRecognition = FakeRec; w.webkitSpeechRecognition = FakeRec;
}, onDevice);

test("kiosk: 'Continue on my phone' shows a QR code of the rider page for this event, station and hour; the link works", async ({ page }) => {
  await openKiosk(page);
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-rider").click();
  await expect(page.getByTestId("kiosk-advice").locator(".tip b")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("kiosk-qr-open").click();
  const code = page.getByTestId("kiosk-qr");
  await expect(code).toBeVisible();
  const url = (await code.getAttribute("data-url"))!;
  const u = new URL(url);
  expect(u.origin).toBe("https://eventflow-twin-roan.vercel.app");                            // the booth runs on localhost: a phone needs the public site
  expect(u.pathname).toBe("/travel");
  expect([...u.searchParams.keys()].sort()).toEqual(["event", "hour", "station"]);            // nothing about the visitor
  expect(u.searchParams.get("event")).toBe(await page.evaluate(() => (window as unknown as W).__twin.getState().scenario.eventId));
  expect(Number(await code.getAttribute("data-modules"))).toBeGreaterThanOrEqual(25);
  const box = (await code.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(360);                        // large enough to scan from arm's length

  // where this browser can read QR codes, the drawn code must decode to exactly that link
  const decoded = await page.evaluate(async () => {
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (c: HTMLCanvasElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) return null;
    const svg = document.querySelector('[data-testid="kiosk-qr"]')!;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const c = document.createElement("canvas"); c.width = c.height = 760;
    c.getContext("2d")!.drawImage(img, 0, 0, 760, 760);
    try { return (await new BD({ formats: ["qr_code"] }).detect(c))[0]?.rawValue ?? "unreadable"; } catch { return null; }
  });
  test.info().annotations.push({ type: "qr-decoded", description: decoded === null ? "no BarcodeDetector in this browser: not decoded here" : "decoded by the browser" });
  if (decoded !== null) expect(decoded).toBe(url);
  await page.screenshot({ path: path.join(OUT, "9_continue_on_my_phone.png") });

  await page.goto(`${u.pathname}${u.search}`);                                               // the same link on this server: the rider page takes it
  await expect(page.getByTestId("travel-answer")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#tr-event")).toHaveValue(u.searchParams.get("event")!);
  await expect(page.locator("#tr-station")).toHaveValue(u.searchParams.get("station")!);
});

test("kiosk voice: spoken words land in the field and are sent only by the visitor; the screen says where speech is processed", async ({ page }) => {
  await fakeSpeech(page, false);
  await openKiosk(page);
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-planner").click();
  await idle(page);
  await page.getByTestId("kai-open").click();
  await expect(page.getByTestId("kai")).toHaveAttribute("data-status", "answered", { timeout: 30_000 });
  await page.getByTestId("kai-type").click();
  await expect(page.getByTestId("kai-keys")).toHaveAttribute("data-voice", "online");
  await expect(page.getByTestId("kai-voice-note")).toContainText("online speech service");     // said before the visitor speaks
  const before = await page.evaluate(() => (window as unknown as W).__twin.getState().forecast!.attendance_used);
  await page.getByTestId("kai-mic").click();
  await expect(page.getByTestId("kai-input")).toHaveValue("make it 60000 people");
  expect(await page.evaluate(() => { const r = (window as unknown as W).__rec!; return [r.lang, r.processLocally ?? null]; })).toEqual(["en-GB", null]);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as W).__twin.getState().forecast!.attendance_used)).toBe(before);   // heard, not acted on
  await page.screenshot({ path: path.join(OUT, "10_voice_heard_not_sent.png") });
  await page.getByTestId("kai-send").click();                                                 // the visitor sends it
  await page.waitForFunction(() => (window as unknown as W).__twin.getState().forecast?.attendance_used === 60000, null, { timeout: 30_000 });

  await page.getByTestId("kai-type").click();                                                 // Arabic layout → Arabic recognition
  await page.getByTestId("kai-lang").click();
  await page.getByTestId("kai-mic").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__rec!.lang)).toBe("ar-AE");
});

test("kiosk voice: on-device recognition is used when the browser has it; ?voice=0 and no speech engine mean no microphone", async ({ page, browser }) => {
  await fakeSpeech(page, true);
  await openKiosk(page);
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("kiosk-planner").click();
  await idle(page);
  await page.getByTestId("kai-open").click();
  await page.getByTestId("kai-type").click();
  await expect(page.getByTestId("kai-keys")).toHaveAttribute("data-voice", "device");
  await expect(page.getByTestId("kai-voice-note")).toContainText("on this device");
  await page.getByTestId("kai-mic").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__rec?.processLocally ?? null)).toBe(true);

  for (const how of ["param", "none"] as const) {
    const p = await (await browser.newContext()).newPage();
    if (how === "param") await fakeSpeech(p, true);
    else await p.addInitScript(() => { const w = window as unknown as Record<string, unknown>; delete w.SpeechRecognition; delete w.webkitSpeechRecognition; Object.defineProperty(window, "SpeechRecognition", { value: undefined }); Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined }); });
    await openKiosk(p, how === "param" ? "&voice=0" : "");
    await p.getByTestId("kiosk-start").click();
    await p.getByTestId("kiosk-planner").click();
    await p.getByTestId("kai-open").click();
    await p.getByTestId("kai-type").click();
    await expect(p.getByTestId("kai-keys")).toHaveAttribute("data-voice", "off");
    await expect(p.getByTestId("kai-mic")).toHaveCount(0);
    await expect(p.getByTestId("kai-input")).toBeVisible();                                    // the keyboard is always there
    await p.context().close();
  }
});

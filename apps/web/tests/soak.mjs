// Booth soak test: the guided demo in a loop (kiosk mode), with scenario changes in between, for N minutes.
// After every loop the JS heap is measured after a forced garbage collection, together with the renderer's
// geometry / texture / shader-program counts, the frame rate and any request that left localhost.
//   node tests/soak.mjs <minutes> [base url] [scene]   → eval/results/ui/soak.json, or soak_<scene>.json (run against the production build)
//   realism scene: node tests/soak.mjs 30 http://localhost:3100 v2
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const minutes = Number(process.argv[2] ?? 120), base = process.argv[3] ?? "http://localhost:3000", scene = process.argv[4] ?? "";
const OUT = path.resolve(import.meta.dirname, `../../../eval/results/ui/soak${scene ? "_" + scene : ""}.json`);
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--js-flags=--expose-gc", "--enable-precise-memory-info"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const external = [], errors = [];
page.on("request", (r) => { const u = r.url(); if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
await page.goto(`${base}/?kiosk=classic&idle=600${scene ? "&scene=" + scene : ""}`);
await page.waitForFunction(() => window.__twin?.getState().sceneReady && window.__twin.getState().ready, null, { timeout: 90000 });

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const sample = async (loop, t0) => {
  const s = await page.evaluate(() => { window.gc?.(); window.gc?.(); return { heap: performance.memory.usedJSHeapSize, eft: window.__eft, nodes: document.getElementsByTagName("*").length }; });
  return { min: +((Date.now() - t0) / 60000).toFixed(2), loop, heap_mb: +(s.heap / 1048576).toFixed(2), geometries: s.eft?.geometries, textures: s.eft?.textures,
    programs: s.eft?.programs, fps: +(s.eft?.fps ?? 0).toFixed(1), tier: s.eft?.tier, dom_nodes: s.nodes };
};
const write = (samples, done) => {
  const warm = samples.slice(1, 5).map((s) => s.heap_mb), tail = samples.slice(-4).map((s) => s.heap_mb);
  const b = warm.length ? median(warm) : samples[0]?.heap_mb, f = tail.length ? median(tail) : b;
  fs.writeFileSync(OUT, JSON.stringify({ suite: "ui_soak", timestamp: new Date().toISOString(), finished: done, target: base, planned_minutes: minutes,
    minutes: samples.at(-1)?.min ?? 0, loops: samples.at(-1)?.loop ?? 0, baseline_heap_mb: b, final_heap_mb: f,
    heap_growth_pct: b ? +(((f - b) / b) * 100).toFixed(1) : null, max_heap_mb: Math.max(...samples.map((s) => s.heap_mb)),
    geometries: [samples[1]?.geometries, samples.at(-1)?.geometries], textures: [samples[1]?.textures, samples.at(-1)?.textures],
    programs: [samples[1]?.programs, samples.at(-1)?.programs], dom_nodes: [samples[1]?.dom_nodes, samples.at(-1)?.dom_nodes],
    min_fps: Math.min(...samples.slice(1).map((s) => s.fps)), tier_final: samples.at(-1)?.tier, external_requests: external.length,
    page_errors: [...new Set(errors)].slice(0, 10), samples: samples.filter((_, i) => i < 6 || i % Math.max(1, Math.floor(samples.length / 60)) === 0 || i > samples.length - 4) }, null, 1));
};

const t0 = Date.now(), samples = [await sample(0, Date.now())];
const events = await page.evaluate(() => window.__twin.getState().events.map((e) => e.id));
let loop = 0;
while ((Date.now() - t0) / 60000 < minutes) {
  loop++;
  await page.getByRole("button", { name: "Guided demo" }).click();
  await page.waitForFunction(() => window.__twin.getState().tourStep !== null, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => window.__twin.getState().tourStep === null, null, { timeout: 120000 });
  // a visitor's turn: another scenario, play the day, a landmark, Arabic and back, clear the plans
  const ev = [...events, "custom"][loop % (events.length + 1)];
  await page.evaluate((id) => { const s = window.__twin.getState(); s.selectEvent(id); s.setTime(8); s.setPlaying(true); }, ev);
  await page.waitForTimeout(2500);
  await page.evaluate((k) => { const s = window.__twin.getState(); s.setPlaying(false); s.focusLandmark(k); }, ["burj", "mof", "et", "dwtc", "frame", "mall", "difc", "canal"][loop % 8]);
  await page.waitForTimeout(1500);
  if (loop % 3 === 0) { await page.getByRole("button", { name: /عربي|English/ }).click(); await page.waitForTimeout(800); await page.getByRole("button", { name: /عربي|English/ }).click(); }
  await page.evaluate(() => { const s = window.__twin.getState(); s.clearPlans(); s.setCam(["overview", "top", "orbit", "fly", "close"][Math.floor(Math.random() * 5)]); });
  await page.waitForTimeout(1500);
  samples.push(await sample(loop, t0));
  write(samples, false);
  if (loop % 10 === 0) console.log(`loop ${loop} · ${samples.at(-1).min} min · heap ${samples.at(-1).heap_mb} MB · fps ${samples.at(-1).fps}`);
}
write(samples, true);
const r = JSON.parse(fs.readFileSync(OUT, "utf8"));
console.log(`soak: ${r.minutes} min, ${r.loops} loops, heap ${r.baseline_heap_mb} → ${r.final_heap_mb} MB (${r.heap_growth_pct}%), min fps ${r.min_fps}, external requests ${r.external_requests}, errors ${r.page_errors.length}`);
await browser.close();

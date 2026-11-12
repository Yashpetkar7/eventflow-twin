// Offline snapshot for the API-down fallback: records the real API's answers for the preset scenarios into
// public/cache/ (index.json maps a request key → file). The app reads it only when the API cannot be reached and
// says so in a banner. Request bodies come from src/lib/requests.ts — the same builders the app uses.
//   npm run snapshot        (the API must be running: python tasks.py api)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { forecastBody, planBody, requestKey, simulateBody } from "../src/lib/requests.ts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const OUT = new URL("../public/cache/", import.meta.url).pathname;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const index = {};
let n = 0;

async function record(path, body) {
  const res = await fetch(API + path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const file = `${String(++n).padStart(3, "0")}.json`;
  writeFileSync(OUT + file, JSON.stringify(data));
  index[requestKey(path, body)] = file;
  return data;
}

const events = await record("/events");
await record("/stations");
await record("/evidence");
const custom = { near: "FIC", start: "19:00", end: "22:00", weekend: false };
const THR = 0.85;
for (const [i, ev] of [...events, { id: "custom" }].entries()) {
  for (const weather of i === 0 ? ["normal", "hot", "rain"] : ["normal"]) {
    const fc = await record("/forecast", forecastBody({ eventId: ev.id, attendance: null, exitSigma: null, weather, custom }));
    await record("/simulate", simulateBody(fc.run_id, [], THR));
    for (const locale of ["en", "ar"]) {
      const plan = await record("/agent/plan", planBody(fc.run_id, [], THR, "balanced", locale));
      // the re-simulation after approving the top option (the guided demo's path)
      if (locale === "en" && plan.options[0]) await record("/simulate", simulateBody(fc.run_id, plan.options[0].interventions, THR));
    }
  }
}
writeFileSync(OUT + "index.json", JSON.stringify(index, null, 1));
console.log(`snapshot: ${n} responses → public/cache/`);

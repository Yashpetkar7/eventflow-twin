// Pitch deck for the RTA R&D and Innovation Zone → exhibit/pitch/EventFlow_Twin_RTA_Pitch.pptx
//   NODE_PATH=<folder with pptxgenjs>/node_modules node exhibit/pitch/build/build_deck.cjs
// Every figure comes from exhibit/pitch/build/facts.json (collected from the running API and eval/results/*.json).
// No RTA logo, no live link (it stays unshared until Dr. Rachit replies), "designed for", never "used by".
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");

const ROOT = path.resolve(__dirname, "../../..");
const SKILL = process.env.PPTX_SKILL;
const F = JSON.parse(fs.readFileSync(path.join(__dirname, "facts.json"), "utf8"));
const img = (p) => path.join(ROOT, p);
const pct = (x) => `${Math.round(x * 100)}%`;
const int = (x) => Math.round(x).toLocaleString("en-US");
const ev = F.eval, sc = F.scenarios;

const THEME = { name: "EventFlow Twin", headFontFace: "Arial", bodyFontFace: "Calibri",
  colors: { dk1: "151B28", lt1: "FFFFFF", dk2: "0B1B4D", lt2: "F2F4F8", accent1: "0F2F8F", accent2: "0E9F6E", accent3: "B0124F",
    accent4: "E39A00", accent5: "5B6B8C", accent6: "D9B25A", hlink: "0F2F8F", folHlink: "5B6B8C" } };
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";                         // 13.33 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "EventFlow Twin: pitch for the RTA R&D and Innovation Zone";
pres.author = "Krishna Mathur, Atharva Soundankar, Yash Petkar";
pres.company = "SP Jain School of Global Management, Dubai";
const C = pres.SchemeColor;
const W = 13.33, FOOT = "EventFlow Twin  ·  research prototype  ·  demand is synthetic  ·  designed for RTA's priorities, not an RTA system";

pres.defineSlideMaster({ title: "DARK", background: { color: HEX.dk2 }, objects: [
  { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 2.3, w: 7.4, h: 1.5, fontSize: 44, bold: true, color: C.background1, align: "left", valign: "top", margin: 0 }, text: "" } },
  { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 3.95, w: 7.2, h: 1.5, fontSize: 20, color: C.background2, align: "left", valign: "top", margin: 0 }, text: "" } },
] });
pres.defineSlideMaster({ title: "CONTENT", background: { color: HEX.lt1 }, margin: [0.6, 0.6, 0.7, 0.6], objects: [
  { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 1.05, fontSize: 30, bold: true, color: C.text2, align: "left", valign: "top", margin: 0 }, text: "" } },
  { text: { text: FOOT, options: { x: 0.6, y: 7.02, w: 10.8, h: 0.3, fontSize: 10, color: C.accent5, margin: 0 } } },
], slideNumber: { x: 12.2, y: 7.02, w: 0.55, h: 0.3, fontSize: 10, color: HEX.accent5, align: "right" } });

const shadow = () => ({ type: "outer", color: "000000", opacity: 0.18, blur: 10, offset: 3, angle: 90 });
const T = (s, text, o) => s.addText(text, { isTextBox: true, margin: 0, valign: "top", ...o });
/** numbered navy circle: the deck's motif */
function num(s, n, x, y, d = 0.5, fill = C.accent1) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill }, objectName: `step ${n}` });
  s.addText(String(n), { isTextBox: true, x, y, w: d, h: d, align: "center", valign: "middle", margin: 0, fontSize: 16, bold: true, color: C.background1 });
}
function card(s, x, y, w, h, fill = C.background2) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: fill } });
}
function picture(s, file, x, y, w, h, alt) {
  s.addImage({ path: img(file), x, y, w, h, sizing: { type: "cover", w, h }, altText: alt, shadow: shadow() });
}
function stat(s, x, y, w, big, label, color = C.accent1, size = 40) {
  T(s, big, { x, y, w, h: 0.75, fontSize: size, bold: true, color, fontFace: THEME.headFontFace });
  T(s, label, { x, y: y + 0.78, w, h: 0.95, fontSize: 14, color: C.text1 });
}

// ------------------------------------------------------------------ 1 title
pres.addSection({ title: "Opening" });
let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Opening" });
s.addImage({ path: img("exhibit/pitch/build/img/eval_results_ui_realism_r10_after_burj_2130.jpg"), x: 0, y: 0, w: W, h: 7.5, altText: "The 3D twin of Downtown Dubai at night" });
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 8.6, h: 7.5, fill: { color: HEX.dk2, transparency: 12 }, line: { color: HEX.dk2, transparency: 100 } });
T(s, "RTA R&D AND INNOVATION ZONE  ·  NOVEMBER 2026", { x: 0.7, y: 1.55, w: 7.4, h: 0.35, fontSize: 13, bold: true, color: C.accent6, charSpacing: 2 });
s.addText("EventFlow Twin", { placeholder: "title" });
s.addText("Will the metro cope? An AI planning twin for event crowds on the Sheikh Zayed Road corridor", { placeholder: "body" });
T(s, "SP Jain School of Global Management, Dubai  ·  Master of AI in Business\nKrishna Mathur  ·  Atharva Soundankar  ·  Yash Petkar", { x: 0.7, y: 5.75, w: 7.4, h: 0.7, fontSize: 14, color: C.background2 });
T(s, "Research prototype. Demand is synthetic. Designed for RTA's AI priorities; not an RTA system.", { x: 0.7, y: 6.75, w: 7.4, h: 0.3, fontSize: 11, italic: true, color: C.background2 });
s.addNotes("Open with the question on the screen: when thousands leave an event at once, will the metro cope, and what would you do? We are three MAIB students from SP Jain. This is a research prototype. The demand in it is synthetic and labelled. We designed it for RTA's published AI priorities; it is not an RTA system.");

// ------------------------------------------------------------------ 2 problem
pres.addSection({ title: "Why" });
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Why" });
s.addText("A big event sends thousands of riders to a few stations in a few hours", { placeholder: "title" });
picture(s, "exhibit/pitch/build/img/submission_images_final_1_overview_golden_hour.jpg", 6.35, 1.75, 6.38, 3.59, "The corridor in the 3D twin with the six station gauges");
stat(s, 0.6, 1.8, 2.6, "200,000+", "visitors expected at GITEX Global over five days, as reported by the organiser");
stat(s, 3.35, 1.8, 2.6, "6", "metro stations carry the corridor, from Max to Business Bay");
stat(s, 0.6, 3.75, 2.6, pct(sc.normal.peak), `of comfortable capacity at World Trade Centre at the peak of day 1, with ${int(sc.normal.attendance)} visitors assumed`, C.accent2);
stat(s, 3.35, 3.75, 2.6, int(F.break.attendance), "visitors is where that station first crosses the comfort line of 85%", C.accent3);
card(s, 0.6, 5.7, 12.13, 1.05);
T(s, "The planner's question: where and when will a station go over, and which response fixes it without moving the crowd to the next station?", { x: 0.85, y: 5.85, w: 11.6, h: 0.8, fontSize: 17, bold: true, color: C.text2, valign: "middle" });
s.addNotes("Events concentrate trips. In our GITEX day 1 scenario the busiest station sits at 78 percent of comfortable capacity, and it tips over the 85 percent line at about 44,400 visitors. The attendance figure is an assumption and is labelled on screen. The question we answer is the one an event planner has the week before.");

// ------------------------------------------------------------------ 3 RTA direction
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Why" });
s.addText("RTA's updated AI Strategy asks for tools that predict and support decisions", { placeholder: "title" });
[["3–5%", "less traffic congestion is a stated target of the strategy launched on 1 November 2026", C.accent1],
 ["50%", "of operations and services are to move to an agentic AI ecosystem within two and a half years", C.accent1],
 ["~20", "AI agents work in the strategy's own bus network planner: agents that analyse, simulate and propose", C.accent1]].forEach(([big, label, col], i) => {
  card(s, 0.6 + i * 4.11, 1.8, 3.9, 2.55);
  stat(s, 0.85 + i * 4.11, 2.0, 3.4, big, label, col, 44);
});
T(s, "How EventFlow Twin lines up", { x: 0.6, y: 4.7, w: 6, h: 0.4, fontSize: 18, bold: true, color: C.text2 });
[["Congestion", "It measures the over-capacity station-hours each plan removes, and the cars a plan adds or saves."],
 ["Agentic AI", "Agents propose and compare whole plans; a critic sends them back when the goal is not met."],
 ["Human in charge", "Nothing is applied until a planner approves it. Every approval is logged."]].forEach(([h, b], i) => {
  num(s, i + 1, 0.6 + i * 4.11, 5.25);
  T(s, h, { x: 1.25 + i * 4.11, y: 5.22, w: 3.2, h: 0.35, fontSize: 16, bold: true, color: C.text1 });
  T(s, b, { x: 1.25 + i * 4.11, y: 5.6, w: 3.2, h: 1.1, fontSize: 14, color: C.text1 });
});
T(s, "Sources: WAM, Gulf News and Khaleej Times reports on the strategy launch, November 2026. Designed for these priorities; no RTA endorsement is claimed.", { x: 0.6, y: 6.68, w: 12.1, h: 0.3, fontSize: 10, color: C.accent5 });
s.addNotes("RTA's updated AI strategy was launched on 1 November. It targets a three to five percent cut in congestion and half of operations and services on agentic AI in two and a half years. It already includes an agentic planner for the bus network. We built the same idea for event crowds on the metro. We say designed for, never used by.");

// ------------------------------------------------------------------ 4 what it is
pres.addSection({ title: "What" });
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "What" });
s.addText("A digital twin that forecasts the crowd, plans the response and waits for a human yes", { placeholder: "title" });
picture(s, "exhibit/pitch/build/img/submission_images_final_2_station_closeup_ai_options.jpg", 0.6, 1.8, 7.1, 3.99, "Station close-up with the planner's options");
[["Forecast", "Station loads in 15-minute steps, from RTA's official timetable and a labelled demand model."],
 ["Plan", "Agents choose from a fixed menu: extra trains, wayfinding, feeder shuttles, robotaxis, staggered exits, entry metering."],
 ["Approve", "A person approves or rejects. The twin then shows before and after, and keeps the record."]].forEach(([h, b], i) => {
  num(s, i + 1, 8.1, 1.85 + i * 1.5);
  T(s, h, { x: 8.8, y: 1.82 + i * 1.5, w: 3.9, h: 0.4, fontSize: 18, bold: true, color: C.text2 });
  T(s, b, { x: 8.8, y: 2.25 + i * 1.5, w: 3.9, h: 1.0, fontSize: 14, color: C.text1 });
});
card(s, 0.6, 6.05, 12.13, 0.75, C.accent1);
T(s, "Runs fully offline on one laptop. English and Arabic. Visitors operate it themselves on a touch screen.", { x: 0.85, y: 6.05, w: 11.6, h: 0.75, fontSize: 16, bold: true, color: C.background1, valign: "middle" });
s.addNotes("Three things in one screen. It forecasts each station's load every fifteen minutes. Agents propose plans from a fixed menu of measures that RTA already uses. And a human approves. It needs no internet at the booth.");

// ------------------------------------------------------------------ 5 how it works
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "What" });
s.addText("The AI proposes, the simulator measures, a critic checks, a human decides", { placeholder: "title" });
const steps = ["Forecast the day", "Find the hotspot", "Propose plans", "Simulate each plan", "Critic: goal met?", "Human approves"];
steps.forEach((label, i) => {
  const x = 0.6 + i * 2.05, crit = i === 4, last = i === 5;
  card(s, x, 1.85, 1.85, 1.25, crit ? C.accent3 : last ? C.accent2 : C.accent1);
  T(s, label, { x: x + 0.1, y: 1.85, w: 1.65, h: 1.25, fontSize: 15, bold: true, color: C.background1, align: "center", valign: "middle" });
  if (i < 5) T(s, "→", { x: x + 1.85, y: 2.2, w: 0.2, h: 0.5, fontSize: 18, bold: true, color: C.accent5, align: "center" });
});
T(s, "If no plan clears every station, the planner tries again with stronger settings and combined measures, at most twice.", { x: 6.75, y: 3.2, w: 5.98, h: 0.6, fontSize: 13, italic: true, color: C.accent3 });
card(s, 0.6, 4.0, 5.9, 1.3);
T(s, "Numbers never come from the AI", { x: 0.85, y: 4.12, w: 5.4, h: 0.35, fontSize: 17, bold: true, color: C.text2 });
T(s, `${ev.agents.metrics.options_checked} of ${ev.agents.metrics.options_checked} plan options were re-simulated and every figure in their text traced back to the simulator.`, { x: 0.85, y: 4.5, w: 5.4, h: 0.75, fontSize: 14, color: C.text1 });
card(s, 0.6, 5.5, 5.9, 1.3);
T(s, "Every step is on screen", { x: 0.85, y: 5.62, w: 5.4, h: 0.35, fontSize: 17, bold: true, color: C.text2 });
T(s, `"How did the AI decide?" lists every tool call with its run id. Example: twice the crowd on the downtown night took ${F.replan.rounds} rounds and ${F.replan.sims} simulations.`, { x: 0.85, y: 6.0, w: 5.4, h: 0.75, fontSize: 14, color: C.text1 });
picture(s, "exhibit/pitch/build/img/eval_results_ui_kiosk_18_tool_calls.jpg", 6.75, 4.0, 5.98, 2.8, "The kiosk's list of tool calls behind a plan");
s.addNotes("This is the part an AI expert will ask about. The planner is a loop. It proposes, the simulator measures each plan, and a critic checks the goal. If nothing clears every station it replans, at most twice. The critic is code on purpose: a model can be talked round, a check cannot. Be honest here: the planner at the booth is rule-based. A language model can take the proposer and explainer steps, and that path is tested with a stand-in model, but we have not run a real model through it yet.");

// ------------------------------------------------------------------ 6 demo story
pres.addSection({ title: "Demo" });
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Demo" });
s.addText("What a visitor does at the booth in two minutes", { placeholder: "title" });
[["exhibit/pitch/build/img/eval_results_ui_kiosk_1_attract.jpg", "Start", "One question on the screen. One touch to begin."],
 ["exhibit/pitch/build/img/eval_results_ui_kiosk_19_stress_road_real_totals.jpg", "Stress it", "More visitors, more of them by metro, a closed station. The cars on the road update too."],
 ["exhibit/pitch/build/img/eval_results_ui_kiosk_17_replanned_options.jpg", "Ask the AI", "Three plans with before and after. A green badge marks plans that clear every station."],
 ["exhibit/pitch/build/img/eval_results_ui_kiosk_21_landmark_burj.jpg", "Explore", "Touch a landmark and the camera turns all the way round it."]].forEach(([file, h, b], i) => {
  const x = 0.6 + i * 3.08;
  picture(s, file, x, 1.8, 2.88, 1.62, h);
  num(s, i + 1, x, 3.65, 0.45);
  T(s, h, { x: x + 0.58, y: 3.65, w: 2.3, h: 0.45, fontSize: 17, bold: true, color: C.text2, valign: "middle" });
  T(s, b, { x, y: 4.25, w: 2.88, h: 1.3, fontSize: 14, color: C.text1 });
});
card(s, 0.6, 5.75, 12.13, 1.0);
T(s, "Also on the kiosk: a rider's view (when and where to board), a 60-second guided show, your own event, and RTA's reported New Year's Eve measures as a labelled comparison.", { x: 0.85, y: 5.75, w: 11.6, h: 1.0, fontSize: 15, color: C.text1, valign: "middle" });
s.addNotes("Let the visitor touch. Start, pick an event, guess the busiest station, stress it, ask the AI, approve. If they have one minute, press 'Show me in 60 seconds'. If they want to explore, touch the Burj Khalifa.");

// ------------------------------------------------------------------ 7 scenario in numbers
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Demo" });
s.addText("GITEX day 1: comfortable on a normal day, over the line when more visitors take the metro", { placeholder: "title" });
s.addChart(pres.charts.BAR, [
  { name: "No plan", labels: ["Hot day", "Rain"], values: [Math.round(sc.hot.peak * 100), Math.round(sc.rain.peak * 100)] },
  { name: "With the top plan", labels: ["Hot day", "Rain"], values: [Math.round(sc.hot.top.peak * 100), Math.round(sc.rain.top.peak * 100)] },
], { x: 0.6, y: 1.75, w: 6.6, h: 4.3, barDir: "col", barGapWidthPct: 60, chartColors: [HEX.accent3, HEX.accent2],
  showTitle: true, title: "Peak load at World Trade Centre, % of comfortable capacity (comfort line: 85%)", titleFontSize: 12, titleColor: HEX.dk1, titleFontFace: "+mn-lt",
  showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 13, dataLabelColor: HEX.dk1, dataLabelFontFace: "+mn-lt", dataLabelFormatCode: "0\"%\"",
  catAxisLabelColor: HEX.dk1, valAxisLabelColor: HEX.accent5, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFontSize: 13, valAxisLabelFontSize: 11,
  valAxisMinVal: 0, valAxisMaxVal: 120, valGridLine: { color: "E3E7EE", size: 0.75 }, catGridLine: { style: "none" },
  showLegend: true, legendPos: "b", legendFontSize: 12, legendColor: HEX.dk1, legendFontFace: "+mn-lt" });
stat(s, 7.6, 1.8, 2.4, pct(sc.normal.peak), `normal day, ${int(sc.normal.attendance)} visitors: no plan needed`, C.accent2);
stat(s, 10.3, 1.8, 2.4, int(F.break.attendance), "visitors is where it first crosses the line", C.accent3);
card(s, 7.6, 3.75, 5.13, 2.3);
T(s, "The top plan on a hot day", { x: 7.85, y: 3.9, w: 4.6, h: 0.35, fontSize: 17, bold: true, color: C.text2 });
T(s, `${sc.hot.top.what} Peak load ${pct(sc.hot.peak)} → ${pct(sc.hot.top.peak)}; riders over the line ${int(sc.hot.excess)} → ${int(sc.hot.top.excess)}. The planner tested ${sc.hot.sims} simulations and checked ${sc.hot.checked} figures before showing it.`, { x: 7.85, y: 4.3, w: 4.6, h: 1.7, fontSize: 14, color: C.text1 });
T(s, `Simulated on synthetic demand. Weather changes the share of visitors who take the metro (assumption: ${pct(sc.normal.metro_share)} normal, ${pct(sc.hot.metro_share)} hot, ${pct(sc.rain.metro_share)} rain). Forecast runs ${sc.hot.run_id} and ${sc.rain.run_id}.`, { x: 0.6, y: 6.3, w: 12.1, h: 0.55, fontSize: 11, color: C.accent5 });
s.addNotes("One scenario in numbers. On a normal day the station is comfortable. On a hot day more visitors take the metro and it goes over the line. The cheapest plan that works is signs: guide 35 percent of riders on foot to Emirates Towers. Every number here is from the simulator, on synthetic demand.");

// ------------------------------------------------------------------ 8 evidence
pres.addSection({ title: "Proof" });
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Proof" });
s.addText("Every claim on screen is backed by a test or a result file", { placeholder: "title" });
const E = [
  [`${ev.agents.metrics.options_checked} / ${ev.agents.metrics.options_checked}`, `plan options with every number traced to the simulator, over ${ev.agents.n} scenarios in English and Arabic`, C.accent2],
  [`0 / ${ev.redteam.n}`, `attack cases succeeded, across all ${ev.redteam.metrics.owasp_categories_covered} categories of the OWASP list for agentic applications`, C.accent2],
  [`${ev.simulator.n} / ${ev.simulator.n}`, "simulator property checks pass: riders are conserved, more trains never make it worse", C.accent2],
  [`${ev.forecast.metrics.lgbm_mase.toFixed(2)} vs ${ev.forecast.metrics.naive_mase.toFixed(2)}`, `forecast error against the seasonal baseline (lower is better; ${int(ev.forecast.n)} test rows, synthetic data)`, C.accent1],
  [`${ev.latency.metrics.p95_seconds.toFixed(1)} s`, `slowest plan wait at the 95th percentile: ${ev.latency.metrics.requests} requests from ${ev.latency.metrics.clients} clients, ${ev.latency.metrics.errors} errors`, C.accent1],
  ["216", "automated tests run on every change: 177 for the engine, 39 in the browser", C.accent1],
];
E.forEach(([big, label, col], i) => {
  const x = 0.6 + (i % 3) * 4.11, y = 1.8 + Math.floor(i / 3) * 2.45;
  card(s, x, y, 3.9, 2.2);
  stat(s, x + 0.25, y + 0.2, 3.4, big, label, col, 36);
});
T(s, "Source: eval/results/*.json in the project repository, runs of 12 and 13 November 2026. A quality gate fails the build if any of these falls below its limit.", { x: 0.6, y: 6.68, w: 12.1, h: 0.3, fontSize: 10, color: C.accent5 });
s.addNotes("We do not ask you to trust a demo. Every plan option is re-simulated by an independent checker. Fifty-three attack cases, in English, Arabic and mixed text, none succeeds. The forecast number is on synthetic data and we say so.");

// ------------------------------------------------------------------ 9 built for the public
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Proof" });
s.addText("Open data, two languages, and a city people recognise", { placeholder: "title" });
picture(s, "exhibit/pitch/build/img/eval_results_ui_realism_r10_after_towers_1000.jpg", 0.6, 1.8, 6.3, 3.54, "Emirates Towers in the 3D twin");
picture(s, "exhibit/pitch/build/img/submission_images_final_5_arabic_view.jpg", 0.6, 5.5, 3.05, 1.3, "The workspace in Arabic");
picture(s, "exhibit/pitch/build/img/eval_results_ui_kiosk_20_reach_mode.jpg", 3.85, 5.5, 3.05, 1.3, "Reach mode: every control in the lower half");
[["Open data", "RTA's official metro timetable, building footprints from Overture and OpenStreetMap, satellite ground from Copernicus Sentinel-2."],
 ["Arabic and English", "Right to left throughout. The Arabic is a draft until a native speaker has reviewed it."],
 ["For every visitor", "Reach mode puts all controls in the lower half. Larger text and high contrast are one touch away."],
 ["Offline", "No internet at the booth: the map, the model and the planner are on the laptop."]].forEach(([h, b], i) => {
  num(s, i + 1, 7.3, 1.85 + i * 1.25, 0.45);
  T(s, h, { x: 7.95, y: 1.83 + i * 1.25, w: 4.75, h: 0.35, fontSize: 17, bold: true, color: C.text2 });
  T(s, b, { x: 7.95, y: 2.2 + i * 1.25, w: 4.75, h: 0.85, fontSize: 14, color: C.text1 });
});
s.addNotes("The city is built from open data, not a scan. Landmarks are approximations from public dimensions. It runs in Arabic and English, and a seated visitor can bring every control down to reach.");

// ------------------------------------------------------------------ 10 honest limits
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Proof" });
s.addText("What is real, what is assumed, and what is not done yet", { placeholder: "title" });
const R = F.real_ratio, lo = Math.min(...Object.values(R).filter((v) => v > 1)), hi = Math.max(...Object.values(R));
[["Real", C.accent2, ["Train frequency per station and direction, from RTA's open timetable", "Station positions and names, in both languages", "Building footprints and most heights, from open map data", `A check against real weekday entries: five of six stations are ${lo.toFixed(2)} to ${hi.toFixed(2)} times busier than our demand model`]],
 ["Assumed, and labelled", C.accent4, ["The hourly pattern of demand (synthetic)", "Event attendance and the share of visitors who take the metro", "The road figure: no traffic counts are used", "Landmark shapes: approximations, not survey models"]],
 ["Not done yet", C.accent3, ["No real language model has run through the planner; the booth planner is rule-based", "No calibration on real hourly ridership", "No trial with an RTA planner", "It is not an RTA system and has no RTA endorsement"]]].forEach(([h, col, items], i) => {
  const x = 0.6 + i * 4.11;
  card(s, x, 1.8, 3.9, 3.85);
  s.addShape(pres.shapes.OVAL, { x: x + 0.25, y: 2.03, w: 0.3, h: 0.3, fill: { color: col }, line: { color: col } });
  T(s, h, { x: x + 0.7, y: 1.98, w: 3.0, h: 0.4, fontSize: 18, bold: true, color: C.text2, valign: "middle" });
  s.addText(items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })), { isTextBox: true, x: x + 0.25, y: 2.6, w: 3.4, h: 4.0, fontSize: 14, color: C.text1, valign: "top", margin: 0, paraSpaceAfter: 8 });
});
card(s, 0.6, 5.9, 12.13, 0.9, C.accent1);
T(s, "The stress test has a switch for real station totals, so anyone can see what the real level does to the answer.", { x: 0.85, y: 5.9, w: 11.6, h: 0.9, fontSize: 16, bold: true, color: C.background1, valign: "middle" });
s.addNotes("Say this slide plainly; it earns trust. The timetable is real. The demand pattern is synthetic. When we checked real station totals, five of six stations were busier than our model, so the stress test has a switch for real totals. And no real language model has been run through the planner yet.");

// ------------------------------------------------------------------ 11 the ask
pres.addSection({ title: "Next" });
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next" });
s.addText("With three things from RTA, this becomes a tested playbook for real events", { placeholder: "title" });
T(s, "What we would need", { x: 0.6, y: 1.8, w: 5.8, h: 0.4, fontSize: 20, bold: true, color: C.text2 });
[["Hourly station entries", "for past events such as GITEX and New Year's Eve, at station level only."],
 ["Train loading", "on the Red Line through the corridor, so capacity is measured instead of assumed."],
 ["Half a day with an event planner", "to review the plans and tell us what the menu is missing."]].forEach(([h, b], i) => {
  num(s, i + 1, 0.6, 2.4 + i * 1.2);
  T(s, h, { x: 1.3, y: 2.38 + i * 1.2, w: 5.1, h: 0.35, fontSize: 16, bold: true, color: C.text1 });
  T(s, b, { x: 1.3, y: 2.75 + i * 1.2, w: 5.1, h: 0.7, fontSize: 14, color: C.text1 });
});
card(s, 6.9, 1.8, 5.83, 3.95, C.accent1);
T(s, "What RTA would get", { x: 7.2, y: 2.0, w: 5.2, h: 0.4, fontSize: 20, bold: true, color: C.background1 });
s.addText([["The crowd size at which each station tips over, per event"], ["Plans tested before the day, with their side effects on the next station and on the road"], ["A record of who approved what, and on which evidence"], ["A bilingual public view for visitors and residents"]].map(([t], k, a) => ({ text: t, options: { bullet: true, breakLine: k < a.length - 1 } })),
  { isTextBox: true, x: 7.2, y: 2.55, w: 5.25, h: 3.0, fontSize: 15, color: C.background1, valign: "top", margin: 0, paraSpaceAfter: 10 });
["Calibrate on real ridership", "Shadow one real event", "Planner's view for the duty manager"].forEach((t, i) => {
  card(s, 0.6 + i * 4.11, 6.0, 3.9, 0.8);
  T(s, `${i + 1}   ${t}`, { x: 0.85 + i * 4.11, y: 6.0, w: 3.5, h: 0.8, fontSize: 15, bold: true, color: C.text2, valign: "middle" });
});
s.addNotes("The ask is small. Station-level data only, no personal data. In return RTA would get break points per station and plans tested before the day. The order is calibrate, shadow one event, then build the duty manager's view.");

// ------------------------------------------------------------------ 12 close
s = pres.addSlide({ masterName: "DARK", sectionTitle: "Next" });
s.addImage({ path: img("exhibit/pitch/build/img/eval_results_ui_realism_r10_after_burj_1730.jpg"), x: 0, y: 0, w: W, h: 7.5, altText: "Downtown Dubai in the 3D twin at golden hour" });
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 8.6, h: 7.5, fill: { color: HEX.dk2, transparency: 10 }, line: { color: HEX.dk2, transparency: 100 } });
T(s, "TRY IT", { x: 0.7, y: 1.55, w: 7.4, h: 0.35, fontSize: 13, bold: true, color: C.accent6, charSpacing: 2 });
s.addText("Touch the screen and ask: will the metro cope?", { placeholder: "title" });
s.addText("18–21 November, Emirates Towers\n23–25 November, RTA Head Office", { placeholder: "body" });
T(s, "Krishna Mathur  ·  lead: data, AI agents, build\nAtharva Soundankar  ·  evaluation and 3D realism\nYash Petkar  ·  web app and kiosk\nSupervisor: Dr. Rachit Garg, SP Jain School of Global Management, Dubai", { x: 0.7, y: 5.45, w: 7.4, h: 1.25, fontSize: 14, color: C.background2 });
T(s, "Research prototype. Demand is synthetic. Not an RTA system.", { x: 0.7, y: 6.85, w: 7.4, h: 0.3, fontSize: 11, italic: true, color: C.background2 });
s.addNotes("Close by handing over the screen. Offer the one-page handout. Thank them for their time.");

(async () => {
  const out = path.join(ROOT, "exhibit/pitch/EventFlow_Twin_RTA_Pitch.pptx");
  await pres.writeFile({ fileName: out });
  if (SKILL) { const { applyTheme } = require(path.join(SKILL, "scripts/apply_theme.js")); await applyTheme(out, THEME); }
  console.log("deck:", out);
})();

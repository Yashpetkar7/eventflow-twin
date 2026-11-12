"use client";
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
import { N, useFmt } from "@/lib/i18n";
import { CUSTOM_DEFAULT_ATTENDANCE } from "@/lib/requests";
import { useTwin, type LayerKey, type Priority, type Weather } from "@/lib/store";

const TIMES = Array.from({ length: 36 }, (_, i) => { const m = 360 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });
const PRIOS: Priority[] = ["cost", "balanced", "impact"];
const LAYERS: LayerKey[] = ["buildings", "landmarks", "trains", "traffic", "flows", "labels"];

export function Rail() {
  const t = useTranslations();
  const f = useFmt();
  // only the fields the rail shows: the playback clock must not re-render it 60 times a second
  const s = useTwin(useShallow((x) => ({
    events: x.events, stations: x.stations, scenario: x.scenario, forecast: x.forecast, threshold: x.threshold, priority: x.priority,
    layers: x.layers, view: x.view, selectEvent: x.selectEvent, patchScenario: x.patchScenario, patchCustom: x.patchCustom,
    setThreshold: x.setThreshold, setPriority: x.setPriority, clearPlans: x.clearPlans,
  })));
  const sc = s.scenario, custom = sc.eventId === "custom";
  const attendance = sc.attendance ?? s.forecast?.attendance_used ?? (custom ? CUSTOM_DEFAULT_ATTENDANCE : s.events.find((e) => e.id === sc.eventId)?.attendance ?? 0);
  const exitSigma = sc.exitSigma ?? s.forecast?.exit_sigma_used ?? 30;
  const share = s.forecast?.metro_share_used;
  return (
    <aside className="rail">
      <section>
        <h2>{t("event")}</h2>
        <div className="scen">
          {s.events.map((e) => (
            <button key={e.id} type="button" aria-pressed={sc.eventId === e.id} onClick={() => s.selectEvent(e.id)}>
              <b>{f.event(e)}</b>
              <span>{f.venue(e)}{e.is_synthetic ? <> · <span className="badge sm">{t("hypothetical")}</span></> : null}</span>
            </button>
          ))}
          <button type="button" aria-pressed={custom} onClick={() => s.selectEvent("custom")}>
            <b>{t("custom")}</b><span>{t("customSub")}</span>
          </button>
        </div>
        {custom && (
          <div className="custom" style={{ marginTop: 8 }}>
            <label htmlFor="cVenue"><span>{t("cVenue")}</span></label>
            <select id="cVenue" value={sc.custom.near} onChange={(e) => s.patchCustom({ near: e.target.value })}>
              {s.stations.map((st) => <option key={st.id} value={st.id}>{f.station(st)}</option>)}
            </select>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label htmlFor="cStart"><span>{t("cStart")}</span></label>
                <select id="cStart" value={sc.custom.start} onChange={(e) => s.patchCustom({ start: e.target.value, end: e.target.value >= sc.custom.end ? TIMES[Math.min(TIMES.length - 1, TIMES.indexOf(e.target.value) + 1)] : sc.custom.end })}>
                  {TIMES.slice(0, -1).map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="cEnd"><span>{t("cEnd")}</span></label>
                <select id="cEnd" value={sc.custom.end} onChange={(e) => s.patchCustom({ end: e.target.value })}>
                  {TIMES.filter((x) => x > sc.custom.start).map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
            </div>
            <div className="seg">
              <button type="button" aria-pressed={!sc.custom.weekend} onClick={() => s.patchCustom({ weekend: false })}>{t("weekday")}</button>
              <button type="button" aria-pressed={sc.custom.weekend} onClick={() => s.patchCustom({ weekend: true })}>{t("weekend")}</button>
            </div>
          </div>
        )}
      </section>
      <section className="field">
        <label htmlFor="att"><span>{t("attendance")}</span><b><N>{f.int(attendance)}</N></b></label>
        <input id="att" type="range" min={5000} max={80000} step={1000} value={attendance} onChange={(e) => s.patchScenario({ attendance: +e.target.value })} />
        <label htmlFor="exitSig"><span>{t("exitWin")}</span><b><N>{t("exitVal", { n: f.int(exitSigma) })}</N></b></label>
        <input id="exitSig" type="range" min={15} max={90} step={5} value={exitSigma} onChange={(e) => s.patchScenario({ exitSigma: +e.target.value })} />
        <div className="note">{t("assumptionNote")}</div>
      </section>
      <section>
        <h2>{t("weather")}</h2>
        <div className="seg">
          {(["normal", "hot", "rain"] as Weather[]).map((w) => (
            <button key={w} type="button" aria-pressed={sc.weather === w} onClick={() => s.patchScenario({ weather: w })}>{t(w === "normal" ? "wNormal" : w === "hot" ? "wHot" : "wRain")}</button>
          ))}
        </div>
        {share != null && <div className="note" style={{ marginTop: 6 }}>{t(`weatherNote.${s.forecast?.weather ?? "normal"}`, { pct: f.pct(share) })}</div>}
      </section>
      <section className="field adv">
        <h2>{t("planning")}</h2>
        <label htmlFor="thr"><span>{t("thr")}</span><b><N>{f.pct(s.threshold)}</N></b></label>
        <input id="thr" type="range" min={70} max={95} step={5} value={Math.round(s.threshold * 100)} onChange={(e) => s.setThreshold(+e.target.value / 100)} />
        <label htmlFor="prio"><span>{t("prio")}</span><b>{t(`prioL.${s.priority}`)}</b></label>
        <input id="prio" type="range" min={0} max={2} step={1} value={PRIOS.indexOf(s.priority)} onChange={(e) => s.setPriority(PRIOS[+e.target.value])} aria-valuetext={t(`prioL.${s.priority}`)} />
      </section>
      <section className="adv">
        <h2>{t("layers")}</h2>
        <div className="checks">
          {LAYERS.map((k) => (
            <label key={k}><input type="checkbox" checked={s.layers[k]} onChange={(e) => useTwin.setState({ layers: { ...s.layers, [k]: e.target.checked } })} />{t(`layerL.${k}`)}</label>
          ))}
        </div>
        <div className="note" style={{ marginTop: 6 }}>{t("trafficNote")}</div>
      </section>
      <section>
        <h2>{t("view")}</h2>
        <div className="seg">
          <button type="button" aria-pressed={s.view === "3d"} onClick={() => useTwin.setState({ view: "3d" })}>{t("v3d")}</button>
          <button type="button" aria-pressed={s.view === "table"} onClick={() => useTwin.setState({ view: "table" })}>{t("vTable")}</button>
        </div>
      </section>
      <button type="button" className="btn ghost" onClick={s.clearPlans}>{t("reset")}</button>
    </aside>
  );
}

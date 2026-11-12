"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { hhmm, N, useFmt, useLocale } from "@/lib/i18n";
import { HOURS, hourOf, lfAt, T_MAX, T_MIN, useTwin, type CamMode } from "@/lib/store";
import { LabelLayer } from "./twin/Labels";
import { nightFactor } from "./twin/Sky";

// The canvas (three.js and the scene code) is a separate chunk, loaded after the page shell and the poster.
const TwinCanvas = dynamic(() => import("./twin/TwinCanvas"), { ssr: false });
const CAMS: Exclude<CamMode, "free">[] = ["overview", "close", "top", "fly", "orbit"];

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

function Hud() {
  const t = useTranslations();
  const f = useFmt();
  const { locale } = useLocale();
  const time = useTwin((s) => s.time);
  const ev = useTwin((s) => s.forecast?.event);
  const custom = useTwin((s) => s.scenario.custom);
  const stations = useTwin((s) => s.stations);
  const sub = useMemo(() => {
    if (!ev) return "";
    if (ev.id === "custom") return `${t("near", { station: f.station(stations.find((x) => x.id === custom.near)) })} · ${custom.weekend ? t("weekend") : t("weekday")}`;
    const d = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${ev.date}T00:00:00Z`));
    return `${f.venue(ev)} · ${d}`;
  }, [ev, custom, stations, locale, f, t]);
  return (
    <div className={`hud${nightFactor(time) > 0.5 ? " night" : ""}`}>
      <div className="clock"><N>{hhmm(time)}</N></div>
      {ev && <div className="sub"><b>{ev.id === "custom" ? t("custom") : f.event(ev)}</b><br />{sub}, <N>{ev.start}–{ev.end}</N></div>}
    </div>
  );
}

function Kpis() {
  const t = useTranslations();
  const f = useFmt();
  const time = useTwin((s) => s.time);
  const cur = useTwin((s) => s.cur);
  const stations = useTwin((s) => s.stations);
  const selected = useTwin((s) => s.selected);
  const plans = useTwin((s) => s.applied.length);
  if (!cur) return null;
  let pk = 0;
  for (const s of stations) pk = Math.max(pk, lfAt(cur, s.id, time));
  const over = cur.resp.summary.overcap_station_hours;
  return (
    <div className="kpis">
      <div className={`kpi${pk > cur.thr ? " bad" : ""}`}><b><N>{f.pct(pk)}</N></b><span>{t("kpi.peak")}</span></div>
      <div className={`kpi${over > 0 ? " bad" : ""}`}><b><N>{f.num(over)}</N></b><span>{t("kpi.over")}</span></div>
      <div className="kpi"><b><N>{f.int(cur.by[selected]?.tph[hourOf(time)] ?? 0)}</N></b><span>{t("kpi.trains")}</span></div>
      <div className="kpi"><b><N>{f.int(plans)}</N></b><span>{t("kpi.plans")}</span></div>
    </div>
  );
}

function TableView() {
  const t = useTranslations();
  const f = useFmt();
  const time = useTwin((s) => s.time);
  const cur = useTwin((s) => s.cur);
  const stations = useTwin((s) => s.stations);
  const h = hourOf(time);
  return (
    <div className="tableview">
      <table className="data">
        <caption className="note" style={{ textAlign: "start", padding: "0 0 8px" }}><N>{hhmm(time)}</N></caption>
        <thead><tr><th>{t("tableH.station")}</th><th>{t("tableH.demand")}</th><th>{t("tableH.cap")}</th><th>{t("tableH.trains")}</th><th>{t("tableH.load")}</th><th>{t("tableH.peak")}</th></tr></thead>
        <tbody>
          {stations.map((s) => {
            const v = cur?.by[s.id], lf = lfAt(cur, s.id, time), over = !!cur && lf > cur.thr;
            return (
              <tr key={s.id}>
                <td>{f.station(s)}</td>
                <td><N>{f.int(v?.demandH[h] ?? 0)}</N></td><td><N>{f.int(v?.capH[h] ?? 0)}</N></td><td><N>{f.int(v?.tph[h] ?? 0)}</N></td>
                <td className={over ? "bad" : ""}><N>{f.pct(lf)}{over ? " ▲" : ""}</N></td>
                <td><N>{f.pct(Math.max(0, ...(v?.peakH ?? [0])))}</N></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TimeBar() {
  const t = useTranslations();
  const time = useTwin((s) => s.time);
  const playing = useTwin((s) => s.playing);
  const speed = useTwin((s) => s.speed);
  return (
    <div className="timebar">
      <button type="button" className="play" aria-label={playing ? t("pause") : t("play")} onClick={() => useTwin.getState().setPlaying(!playing)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d={playing ? "M4 2h3v12H4zM9 2h3v12H9z" : "M4 2l10 6-10 6z"} fill="currentColor" /></svg>
      </button>
      <input type="range" min={T_MIN} max={T_MAX} step={0.05} value={time} aria-label={t("timeOfDay")} aria-valuetext={hhmm(time)} onChange={(e) => useTwin.getState().setTime(+e.target.value)} />
      <select className="speed" aria-label={t("speed")} value={speed} onChange={(e) => useTwin.setState({ speed: +e.target.value })}>
        {[0.5, 1, 2, 4].map((v) => <option key={v} value={v}>{v}×</option>)}
      </select>
    </div>
  );
}

function HeatStrip() {
  const f = useFmt();
  const cur = useTwin((s) => s.cur);
  const stations = useTwin((s) => s.stations);
  const now = useTwin((s) => hourOf(s.time));
  if (!cur) return <div className="heat" />;
  return (
    <div className="heat">
      <div className="heatgrid">
        <div />
        {HOURS.map((h) => <div key={h} className="hh num">{h}</div>)}
        {stations.map((s) => (
          <div key={s.id} style={{ display: "contents" }}>
            <div className="lab">{f.station(s)}</div>
            {HOURS.map((h) => {
              const lf = cur.by[s.id]?.peakH[h] ?? 0, over = (cur.by[s.id]?.overH[h] ?? 0) > 0;
              const color = over ? "var(--risk)" : lf > cur.thr * 0.72 ? "var(--warn)" : "var(--ok)";
              return (
                <button key={h} type="button" className={`cell${h === now ? " now" : ""}${over ? " over" : ""}`}
                  style={{ background: color, opacity: 0.3 + Math.min(lf, 1.4) * 0.5 }}
                  aria-label={`${f.station(s)} ${h}:00 ${f.pct(lf)}${over ? " ▲" : ""}`}
                  onClick={() => useTwin.setState({ selected: s.id, time: h + 0.5 })} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Stage() {
  const t = useTranslations();
  const view = useTwin((s) => s.view);
  const cam = useTwin((s) => s.cam);
  const ready = useTwin((s) => s.sceneReady);
  const glFailed = useTwin((s) => s.glFailed);
  useEffect(() => { if (!webglAvailable()) useTwin.setState({ glFailed: true, view: "table" }); }, []);
  const show3d = !glFailed;
  return (
    <section className="stage">
      <div className="view" data-testid="view">
        {show3d && <TwinCanvas label={t("canvasAria")} />}
        {show3d && <div className={`poster${ready ? " hide" : ""}`} style={{ backgroundImage: "url(/poster.jpg)" }} aria-hidden="true" />}
        {show3d && <LabelLayer />}
        <Hud />
        <Kpis />
        <div className="legend">
          <span><i style={{ background: "var(--ok)" }} />{t("lgOk")}</span>
          <span><i style={{ background: "var(--warn)" }} />{t("lgWarn")}</span>
          <span><i style={{ background: "var(--risk)" }} />{t("lgRisk")} ▲</span>
          <span><i style={{ background: "transparent", border: "2px solid #fff", outline: "1px solid #888" }} />{t("lgRing")}</span>
        </div>
        {show3d && (
          <div className="camtools">
            {CAMS.map((k) => <button key={k} type="button" aria-pressed={cam === k} onClick={() => { useTwin.setState({ view: "3d" }); useTwin.getState().setCam(k); }}>{t(`cam.${k}`)}</button>)}
          </div>
        )}
        {show3d && <div className="attrib">© OpenStreetMap contributors · RTA open data (GTFS)</div>}
        {(view === "table" || glFailed) && <TableView />}
        {glFailed && <div className="banner" style={{ position: "absolute", insetInline: 0, bottom: 0, zIndex: 6 }} role="status">{t("glfail")}</div>}
      </div>
      <TimeBar />
      <HeatStrip />
    </section>
  );
}

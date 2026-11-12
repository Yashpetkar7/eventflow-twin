"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { hhmm, N, useFmt, useLocale } from "@/lib/i18n";
import { nightFactor } from "@/lib/daylight";
import { LANDMARK_KEYS, LANDMARK_STATION, type LandmarkKey } from "@/lib/landmarks";
import { loadManifest, type Manifest } from "@/lib/manifest";
import { HOURS, hourOf, lfAt, T_MAX, T_MIN, useTwin } from "@/lib/store";
import { LabelLayer } from "./LabelLayer";

// The canvas (three.js and the scene code) is a separate chunk, loaded after the page shell and the poster.
const TwinCanvas = dynamic(() => import("./twin/TwinCanvas"), { ssr: false });
const CAMS = ["overview", "close", "top", "fly", "orbit"] as const;

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
    <div className={`hud${nightFactor(time) > 0.5 ? " night" : ""}`} data-overlay>
      <div className="clock"><N>{hhmm(time)}</N></div>
      {ev && <div className="sub"><b>{ev.id === "custom" ? t("custom") : f.event(ev)}</b><br />{sub}, <N>{ev.start}–{ev.end}</N></div>}
    </div>
  );
}

/** Shown while the camera frames a landmark: what it is, the station that serves it, and a way back. */
function FocusChip() {
  const t = useTranslations();
  const f = useFmt();
  const focus = useTwin((s) => s.focus) as LandmarkKey | null;
  const stations = useTwin((s) => s.stations);
  if (!focus) return null;
  const st = stations.find((x) => x.id === LANDMARK_STATION[focus]);
  return (
    <div className="focuschip" data-overlay role="status">
      <span><b>{t(`lmName.${focus}`)}</b><br /><span className="note">{t("nearest", { station: f.station(st) })}</span></span>
      <button type="button" aria-label={t("backToOverview")} onClick={() => useTwin.getState().setCam("overview")}>✕</button>
    </div>
  );
}

/** Recentre, zoom and full-width map: big targets on the edge of the 3D view. */
function MapControls() {
  const t = useTranslations();
  const cam = useTwin((s) => s.cam);
  const expanded = useTwin((s) => s.expanded);
  const zoom = (f: number) => void import("./twin/sceneData").then((m) => m.camBus.zoom(f));
  return (
    <div className="mapctl" data-overlay>
      <button type="button" className={cam === "free" ? "moved" : ""} aria-label={t("recentre")} title={t("recentreHint")} onClick={() => useTwin.getState().recentre()}>
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /><path d="M8 0.8v2.6M8 12.6v2.6M0.8 8h2.6M12.6 8h2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <button type="button" aria-label={t("zoomIn")} title={t("zoomIn")} onClick={() => zoom(0.72)}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
      <button type="button" aria-label={t("zoomOut")} title={t("zoomOut")} onClick={() => zoom(1.38)}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
      <button type="button" aria-pressed={expanded} aria-label={expanded ? t("collapseMap") : t("expandMap")} title={expanded ? t("collapseMap") : t("expandMap")} onClick={() => useTwin.setState({ expanded: !expanded })}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d={expanded ? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

/** Camera presets plus a menu of landmarks to fly to. */
function CameraBar() {
  const t = useTranslations();
  const cam = useTwin((s) => s.cam);
  const focus = useTwin((s) => s.focus);
  const [open, setOpen] = useState(false);
  return (
    <div className="camtools" data-overlay>
      {CAMS.map((k) => <button key={k} type="button" aria-pressed={cam === k} onClick={() => { setOpen(false); useTwin.setState({ view: "3d" }); useTwin.getState().setCam(k); }}>{t(`cam.${k}`)}</button>)}
      <div className="lmwrap">
        <button type="button" aria-expanded={open} aria-pressed={cam === "landmark"} onClick={() => setOpen(!open)}>{t("landmarks")} ▾</button>
        {open && (
          <div className="lmmenu">
            {LANDMARK_KEYS.map((k) => (
              <button key={k} type="button" aria-pressed={focus === k} onClick={() => { setOpen(false); useTwin.getState().focusLandmark(k); }}>{t(`lmName.${k}`)}</button>
            ))}
          </div>
        )}
      </div>
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
    <div className="kpis" data-overlay>
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

/** Map attribution; with the realism ring (?scene=v2) it opens the data credits: one row per dataset, from the bake's manifest. */
function Credits() {
  const t = useTranslations();
  const [m, setM] = useState<Manifest | null>(null);
  useEffect(() => { loadManifest().then(setM); }, []);
  if (!m) return <div className="attrib">© OpenStreetMap contributors · RTA open data (GTFS)</div>;
  return (
    <details className="attrib credits" data-testid="credits">
      <summary>© OpenStreetMap contributors · Overture Maps · Copernicus Sentinel-2 · ESA WorldCover · RTA GTFS · <u>{t("credits")}</u></summary>
      <div className="credits-panel" dir="ltr">
        <p>{t("creditsNote", { n: m.counts.buildings, e: m.counts.estimated })}</p>
        <table>
          <tbody>
            {m.provenance.map((p) => <tr key={p.dataset}><th>{p.dataset}</th><td>{p.source}</td><td>{p.licence}</td><td>{p.date}</td><td>{p.count}</td></tr>)}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function Stage() {
  const t = useTranslations();
  const view = useTwin((s) => s.view);
  const ready = useTwin((s) => s.sceneReady);
  const glFailed = useTwin((s) => s.glFailed);
  const tier = useTwin((s) => s.tier);
  useEffect(() => { if (!webglAvailable()) useTwin.setState({ glFailed: true, view: "table" }); }, []);
  useEffect(() => {                                   // Home recentres the 3D view; Escape leaves the full-width map
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, select, textarea")) return;
      if (e.key === "Home") { e.preventDefault(); useTwin.getState().recentre(); }
      if (e.key === "Escape" && useTwin.getState().expanded) useTwin.setState({ expanded: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const show3d = !glFailed;
  return (
    <section className="stage">
      <div className="view" data-testid="view" data-tier={tier}>
        {show3d && <TwinCanvas label={t("canvasAria")} />}
        {show3d && <div className={`poster${ready ? " hide" : ""}`} style={{ backgroundImage: "url(/poster.jpg)" }} aria-hidden="true" />}
        {show3d && <LabelLayer />}
        <div className="viewtop">
          <div className="hudcol"><Hud />{show3d && <FocusChip />}</div>
          <Kpis />
        </div>
        {show3d && view === "3d" && <MapControls />}
        <div className="viewbottom">
          <div className="viewrow">
            <div className="legend" data-overlay>
              <span><i style={{ background: "var(--ok)" }} />{t("lgOk")}</span>
              <span><i style={{ background: "var(--warn)" }} />{t("lgWarn")}</span>
              <span><i style={{ background: "var(--risk)" }} />{t("lgRisk")} ▲</span>
              <span><i style={{ background: "transparent", border: "2px solid #fff", outline: "1px solid #888" }} />{t("lgRing")}</span>
            </div>
            {show3d && <CameraBar />}
          </div>
          {show3d && <Credits />}
        </div>
        {(view === "table" || glFailed) && <TableView />}
        {glFailed && <div className="banner" style={{ position: "absolute", insetInline: 0, bottom: 0, zIndex: 6 }} role="status">{t("glfail")}</div>}
      </div>
      <TimeBar />
      <HeatStrip />
    </section>
  );
}

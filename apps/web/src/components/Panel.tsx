"use client";
import { useTranslations } from "next-intl";
import { hhmm, N, useFmt } from "@/lib/i18n";
import { alertsOf, hourOf, lfAt, T_MIN, useTwin, type SimView, type Tab } from "@/lib/store";
import { AiTab, BuildTab } from "./PlanTabs";
import { ReportTab } from "./ReportTab";

const TABS: Tab[] = ["station", "ai", "build", "alerts", "report"];

/** Load through the day for one station: 15-minute load factors straight from the simulator. */
function LoadChart({ id, cur, base, showBase, label }: { id: string; cur: SimView; base: SimView | null; showBase: boolean; label: string }) {
  const t = useTranslations();
  const f = useFmt();
  const time = useTwin((s) => s.time);
  const W = 360, H = 150, padL = 30, padB = 18, bph = cur.bph, b0 = T_MIN * bph, n = 24 * bph;
  const lf = cur.by[id]?.lf, lfBase = base?.by[id]?.lf;
  if (!lf) return null;
  let top = Math.max(1, cur.thr);
  for (let i = b0; i < n; i++) top = Math.max(top, lf[i], showBase && lfBase ? lfBase[i] : 0);
  top *= 1.08;
  const X = (hour: number) => padL + ((hour - T_MIN) / (24 - T_MIN)) * (W - padL - 6);
  const Y = (v: number) => H - padB - (v / top) * (H - padB - 8);
  const path = (a: Float32Array) => { let d = ""; for (let i = b0; i < n; i++) d += `${i === b0 ? "M" : "L"}${X((i + 0.5) / bph).toFixed(1)} ${Y(a[i]).toFixed(1)} `; return d; };
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ direction: "ltr" }}>
        <path d={`${path(lf)}L${X(24 - 0.5 / bph).toFixed(1)} ${Y(0)} L${X(T_MIN + 0.5 / bph).toFixed(1)} ${Y(0)} Z`} fill="var(--navy)" opacity=".1" />
        <line x1={padL} x2={W - 6} y1={Y(cur.thr)} y2={Y(cur.thr)} stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="5 4" />
        {showBase && lfBase && <path d={path(lfBase)} fill="none" stroke="var(--risk)" strokeWidth="2" strokeDasharray="3 3" />}
        <path d={path(lf)} fill="none" stroke="var(--navy)" strokeWidth="2.6" strokeLinejoin="round" />
        <line x1={X(time)} x2={X(time)} y1="6" y2={H - padB} stroke="var(--brand)" strokeWidth="1.5" />
        {[6, 9, 12, 15, 18, 21].map((h) => <text key={h} x={X(h)} y={H - 3} fontSize="10" textAnchor="middle" fill="var(--ink-3)">{h}:00</text>)}
        <text x={padL - 4} y={Y(cur.thr) + 3} fontSize="10" textAnchor="end" fill="var(--ink-3)">{f.pct(cur.thr)}</text>
        <text x={padL - 4} y={Y(0) + 3} fontSize="10" textAnchor="end" fill="var(--ink-3)">0</text>
      </svg>
      <div className="note" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--navy)" }}>━ {t("chartNow")}</span>
        <span>┅ {t("chartCap", { pct: f.pct(cur.thr) })}</span>
        {showBase && <span style={{ color: "var(--risk)" }}>┅ {t("chartBase")}</span>}
      </div>
    </>
  );
}

function StationTab() {
  const t = useTranslations();
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const selected = useTwin((s) => s.selected);
  const cur = useTwin((s) => s.cur);
  const base = useTwin((s) => s.base);
  const hasPlans = useTwin((s) => s.applied.length > 0);
  const time = useTwin((s) => s.time);
  const st = stations.find((s) => s.id === selected), v = cur?.by[selected];
  if (!cur || !st || !v) return <div className="empty">…</div>;
  const lf = lfAt(cur, selected, time), over = lf > cur.thr, h = hourOf(time);
  const color = over ? "var(--risk)" : lf > cur.thr * 0.72 ? "var(--warn)" : "var(--ok)";
  return (
    <>
      <div className="card">
        <div className="note">{t("selected")}</div>
        <h3 style={{ margin: "2px 0 8px", fontSize: 18, fontWeight: 600 }}>{f.station(st)}</h3>
        <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
          <span className="big" style={{ color }}><N>{f.pct(lf)}</N>{over ? <span style={{ fontSize: 22 }}> ▲</span> : null}</span>
          <span className="note"><bdi>{t("load", { time: hhmm(time) })}</bdi></span>
        </div>
        <div className="kv">
          <div><b><N>{f.int(v.demandH[h])}</N></b><span>{t("riders")}</span></div>
          <div><b><N>{f.pct(Math.max(...v.peakH))}</N></b><span>{t("peakToday")}</span></div>
          <div><b><N>{f.num(v.overH.reduce((a, b) => a + b, 0) / cur.bph)}</N></b><span>{t("overHours")}</span></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <LoadChart id={selected} cur={cur} base={base} showBase={hasPlans} label={t("chartAria", { station: f.station(st) })} />
        </div>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {stations.map((s) => <button key={s.id} type="button" className="pill" aria-pressed={s.id === selected} onClick={() => useTwin.getState().select(s.id, { fly: true })}>{f.station(s)}</button>)}
      </div>
    </>
  );
}

function AlertsTab() {
  const t = useTranslations();
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const cur = useTwin((s) => s.cur);
  const list = alertsOf(cur, stations.map((s) => s.id));
  return (
    <>
      <h2>{t("alerts.title")}</h2>
      {list.length === 0 && <div className="card empty">{t("alerts.none")}</div>}
      {list.map((a) => {
        const name = f.station(stations.find((s) => s.id === a.id));
        return (
          <button key={`${a.id}${a.hour}`} type="button" className="alert" aria-label={t("alerts.jump", { station: name, time: `${a.hour}:00` })} onClick={() => useTwin.getState().jumpTo(a.id, a.hour)}>
            <span><b>{name}</b><br /><N className="note">{a.hour}:00–{a.hour + 1}:00</N></span>
            <span className="lf"><N>{f.pct(a.lf)}</N> ▲</span>
          </button>
        );
      })}
    </>
  );
}

export function Panel() {
  const t = useTranslations();
  const f = useFmt();
  const tab = useTwin((s) => s.tab);
  const nAlerts = useTwin((s) => alertsOf(s.cur, s.stations.map((x) => x.id)).length);
  return (
    <aside className="panel">
      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="tabpanel" onClick={() => useTwin.setState({ tab: k })}>
            {t(`tabs.${k}`)}{k === "alerts" && nAlerts > 0 ? <span className="count"><N>{f.int(nAlerts)}</N></span> : null}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "station" && <StationTab />}
        {tab === "ai" && <AiTab />}
        {tab === "build" && <BuildTab />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "report" && <ReportTab />}
      </div>
    </aside>
  );
}

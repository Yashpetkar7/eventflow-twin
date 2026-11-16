"use client";
// The rider page (/travel, contract 1.15.0): "when should I leave, from which station, and how long will I wait?".
// Pick an event, a station and a time; the answer comes from the simulator with the measures a duty manager
// approved and published. Shareable as a link (?event=…&station=…&hour=…&lang=ar). No sign-in; nothing is sent.
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError, type EventInfo, type ForecastRequest, type RegisteredEvent, type RiderNotice, type Station, type TravelAdvice } from "@/lib/api";
import { N, useFmt, useLocale } from "@/lib/i18n";

type Choice = { key: string; label: string; forecast: ForecastRequest; station: string; endHour: number };

const q = () => new URLSearchParams(window.location.search);

export function Travel() {
  const t = useTranslations("travel");
  const td = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const f = useFmt();
  const { locale, setLocale } = useLocale();
  const [stations, setStations] = useState<Station[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [notices, setNotices] = useState<RiderNotice[]>([]);
  const [key, setKey] = useState<string>("");
  const [station, setStation] = useState<string>("");
  const [hour, setHour] = useState<number>(22);
  const [adv, setAdv] = useState<TravelAdvice | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string | null | undefined) => (id ? f.station(stations.find((s) => s.id === id)) : "–");

  useEffect(() => {
    void Promise.all([api.stations().catch(() => [] as Station[]), api.events().catch(() => [] as EventInfo[]),
      api.eventsRegistered().catch(() => [] as RegisteredEvent[]), api.notices().catch(() => [] as RiderNotice[])])
      .then(([sts, evs, reg, ns]) => {
        setStations(sts);
        setNotices(ns);
        // a demo event has a venue location, not a station: the nearest corridor station
        const near = (lat: number, lon: number) => sts.filter((s) => s.in_corridor)
          .reduce<{ id: string; d: number }>((b, s) => { const d = (s.lat - lat) ** 2 + ((s.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2; return d < b.d ? { id: s.id, d } : b; }, { id: "WTC", d: Infinity }).id;
        const hourOf = (s: string | null | undefined) => (s ? Math.max(5, Math.min(23, parseInt(s.slice(0, 2), 10))) : 22);   // the exit hour
        const list: Choice[] = [
          ...reg.map((r) => ({ key: r.event_key, label: r.name, forecast: r.forecast, station: r.near_station, endHour: hourOf(r.end) })),
          ...evs.map((e) => ({ key: e.id, label: locale === "ar" ? (e.name_ar ?? e.name) : e.name, forecast: { event_id: e.id } as ForecastRequest,
            station: near(e.lat, e.lon), endHour: hourOf(e.end) })),
        ];
        setChoices(list);
        const want = q().get("event");
        const run = q().get("run");
        const pickedNotice = run ? ns.find((n) => n.forecast_run_id === run) : null;
        const fromNotice = pickedNotice ? list.find((c) => JSON.stringify(c.forecast) === JSON.stringify(pickedNotice.forecast)) : null;
        const c = list.find((x) => x.key === want) ?? fromNotice ?? list[0];
        if (c) {
          setKey(c.key);
          setStation(q().get("station") ?? pickedNotice?.stations[0] ?? c.station);
          const h = Number(q().get("hour"));
          setHour(Number.isFinite(h) && h >= 5 && h <= 23 && q().get("hour") ? h : c.endHour);
        }
      });
  }, [locale]);

  const choice = useMemo(() => choices.find((c) => c.key === key) ?? null, [choices, key]);
  useEffect(() => {
    if (!choice || !station) return;
    let live = true;
    api.travel({ forecast: choice.forecast, station, hour, use_notices: true })
      .then((a) => { if (live) { setAdv(a); setErr(null); } }, (e) => { if (live) { setAdv(null); setErr(e instanceof ApiError ? e.detail : String(e)); } });
    const p = new URLSearchParams({ event: choice.key, station, hour: String(hour), ...(locale === "ar" ? { lang: "ar" } : {}) });
    window.history.replaceState(null, "", `/travel?${p}`);
    return () => { live = false; };
  }, [choice, station, hour, locale]);

  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setErr(null); } catch { /* clipboard blocked: the address bar has the link */ }
  };
  const mins = (m: number) => (m < 1 ? t("noWait") : td("minutes", { n: Math.round(m) }));
  const corridor = stations.filter((s) => s.in_corridor);

  return (
    <main className="ops travel" data-testid="travel">
      <header className="ops-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="note">{t("sub")}</p>
        </div>
        <button type="button" className="pill" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{locale === "ar" ? "English" : "عربي"}</button>
      </header>

      <section className="card ops-grid" aria-label={t("choose")}>
        <label>{t("event")}
          <select id="tr-event" value={key} onChange={(e) => { const c = choices.find((x) => x.key === e.target.value); setKey(e.target.value); if (c) { setStation(c.station); setHour(c.endHour); } }}>
            {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label>{t("station")}
          <select id="tr-station" value={station} onChange={(e) => setStation(e.target.value)}>
            {corridor.map((s) => <option key={s.id} value={s.id}>{f.station(s)}</option>)}
            {station && !corridor.some((s) => s.id === station) && <option value={station}>{name(station)}</option>}
          </select>
        </label>
        <label>{td("time", { h: `${String(hour).padStart(2, "0")}:00` })}
          <input id="tr-hour" type="range" min={5} max={23} step={1} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
        </label>
      </section>

      {err && <div className="warnbox" role="alert">{err}</div>}

      {adv && (
        <section className={`card tr-answer ${adv.status}`} data-testid="travel-answer" aria-live="polite">
          <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span className={`tr-status ${adv.status}`} data-testid="travel-status">{t(`status.${adv.status}`)}</span>
            {adv.is_synthetic && <span className="badge sm">{t("synthetic")}</span>}
          </div>
          <h2 style={{ margin: "8px 0 4px" }}><N>{td("headline", { st: name(adv.station), h: `${String(adv.hour).padStart(2, "0")}:00` })}</N></h2>
          <ul className="tr-facts">
            <li><N>{td("load", { p: adv.now.load == null ? "–" : f.pct(adv.now.load), thr: f.pct(adv.threshold) })}</N></li>
            <li><N>{td("wait", { w: mins(adv.now.wait_min) })}</N></li>
            {adv.busy_until != null && <li><N>{td("busyUntil", { h: `${String(adv.busy_until).padStart(2, "0")}:00` })}</N></li>}
            {adv.leave_later && <li data-testid="travel-later"><N>{td("later", { h: `${String(adv.leave_later.hour).padStart(2, "0")}:00`, s: Math.round(Number(adv.leave_later.saves_min)) })}</N></li>}
            {adv.entry_metered && <li className="tr-warn">{t("metered")}</li>}
          </ul>
          {adv.alternatives.length > 0 && (
            <div data-testid="travel-alts">
              <h3>{t("alternatives")}</h3>
              <ul className="tr-facts">
                {adv.alternatives.map((a) => (
                  <li key={a.station} className={a.better ? "tr-better" : ""}>
                    <N>{td("alt", { st: name(a.station), walk: a.walk_min, p: f.pct(a.load), w: a.wait_min < 1 ? t("noWait") : td("waitMin", { n: Math.round(a.wait_min) }) })}</N>{a.better ? <b> · {t("better")}</b> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="tr-ahead" aria-label={t("ahead")}>
            {adv.ahead.map((h) => (
              <div key={h.hour} className={h.load != null && h.load > adv.threshold ? "over" : ""}>
                <small><N>{`${String(h.hour).padStart(2, "0")}:00`}</N></small>
                <b><N>{h.load == null ? "–" : f.pct(h.load)}</N></b>
                <small><N>{mins(h.wait_min)}</N></small>
              </div>
            ))}
          </div>
          {adv.notices.length > 0 && <p className="note" data-testid="travel-with-plan"><bdi>{td("withPlan", { title: adv.notices[0].title })}</bdi></p>}
          <p className="note"><N>{td("source", { run: adv.source.run_id as string, walk: f.num(Number(adv.assumptions.walk_kmh), 1) })}</N></p>
        </section>
      )}

      {(adv?.notices.length ? adv.notices : notices.filter((n) => choice && JSON.stringify(n.forecast) === JSON.stringify(choice.forecast))).map((n) => (
        <section key={n.notice_id} className="card tr-notice" data-testid="travel-notice">
          <small>{t("noticeFrom")}</small>
          <p style={{ margin: "4px 0" }}><bdi>{(n.text as Record<string, { notice: string }>)[locale]?.notice ?? (n.text as Record<string, { notice: string }>).en?.notice}</bdi></p>
          <small className="note"><N>{td("noticeMeta", { t: new Date(n.published).toLocaleString(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Dubai" }) })}</N></small>
        </section>
      ))}

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="pill" onClick={() => void share()} data-testid="travel-share">{t("share")}</button>
      </div>
      <p className="note">{t("footer")}</p>
    </main>
  );
}

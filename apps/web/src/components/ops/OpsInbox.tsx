"use client";
// The duty manager's page (/inbox, contract 1.15.0): register events (form or CSV) that start the event chain by
// themselves, approve or reject what the AI team recommends — on a phone — and publish an approved plan's notice to
// riders. Nothing is applied or published without a click here; every figure comes from the API.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError, setAuthToken, type Inbox, type RiderNotice, type Station } from "@/lib/api";
import { N, useFmt, useLocale } from "@/lib/i18n";

type Busy = Record<string, "approve" | "reject" | "publish" | undefined>;

export function OpsInbox() {
  const t = useTranslations("ops");
  const td = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const f = useFmt();
  const { locale, setLocale } = useLocale();
  const [stations, setStations] = useState<Station[]>([]);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [me, setMe] = useState<{ auth: "on" | "off"; user: { username: string; role: string } | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>({});
  const [done, setDone] = useState<Record<string, { decision: string; notice?: RiderNotice }>>({});
  const [form, setForm] = useState(() => ({ name: "", near_station: "BBY", date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), start: "19:00", end: "22:30", attendance: 15000, venue: "" }));
  const [cred, setCred] = useState({ username: "", password: "" });
  const name = (id: string | null | undefined) => (id ? f.station(stations.find((s) => s.id === id)) : "–");
  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.detail : String(e));

  const refresh = useCallback(() => api.inbox().then((x) => { setInbox(x); setErr(null); }, fail), []);
  useEffect(() => {
    void api.stations().then(setStations, () => {});
    void api.authMe().then(setMe, () => setMe(null));
    void api.inbox().then(setInbox, fail);
    const id = setInterval(() => void refresh(), 20_000);                // new events and alerts appear by themselves
    return () => clearInterval(id);
  }, [refresh]);

  const signIn = async () => {
    try {
      const r = await api.authLogin(cred.username, cred.password);
      setAuthToken(r.token);
      setCred({ username: "", password: "" });
      setMe({ auth: "on", user: { username: r.username, role: r.role } });
      await refresh();
    } catch (e) { fail(e); }
  };
  const register = async () => {
    setMsg(null);
    try {
      const ev = await api.eventsRegister({ ...form, venue: form.venue || null, attendance: Number(form.attendance), auto_chain: true });
      setMsg(td(ev.chain_status === "awaiting_human" ? "registeredInbox" : "registeredClear", { name: ev.name }));
      await refresh();
    } catch (e) { fail(e); }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    try {
      const r = await api.eventsImport(await file.text(), true);
      const errs = (r.errors ?? []) as { line: number; error: string }[];
      setMsg(td("imported", { n: r.created.length, bad: errs.length }) + (errs.length ? " " + errs.map((x) => `#${x.line}: ${x.error}`).join(" · ") : ""));
      await refresh();
    } catch (e) { fail(e); }
  };
  const decide = async (id: string, d: "approve" | "reject") => {
    setBusy((b) => ({ ...b, [id]: d }));
    try {
      await api.chainDecide(id, { decision: d, user: me?.user?.username ?? "duty-manager" });
      setDone((x) => ({ ...x, [id]: { decision: d } }));
      await refresh();
    } catch (e) { fail(e); } finally { setBusy((b) => ({ ...b, [id]: undefined })); }
  };
  const publish = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: "publish" }));
    try {
      const n = await api.chainPublish(id);
      setDone((x) => ({ ...x, [id]: { decision: "approve", notice: n } }));
    } catch (e) { fail(e); } finally { setBusy((b) => ({ ...b, [id]: undefined })); }
  };

  const corridor = stations.filter((s) => s.in_corridor);
  const others = stations.filter((s) => !s.in_corridor);
  const needSignIn = me?.auth === "on" && !me.user;

  return (
    <main className="ops" data-testid="ops">
      <header className="ops-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="note">{t("sub")}</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <a className="pill" href={`/travel${locale === "ar" ? "?lang=ar" : ""}`}>{t("riderLink")}</a>
          <button type="button" className="pill" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{locale === "ar" ? "English" : "عربي"}</button>
        </div>
      </header>

      {err && <div className="warnbox" role="alert">{err}</div>}
      {msg && <div className="verify" role="status" data-testid="ops-msg"><N>{msg}</N></div>}

      {needSignIn && (
        <section className="card" data-testid="ops-signin">
          <h2>{t("signIn")}</h2>
          <div className="ops-grid">
            <label>{t("username")}<input id="ops-user" autoComplete="username" value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} /></label>
            <label>{t("password")}<input id="ops-pass" type="password" autoComplete="current-password" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} /></label>
          </div>
          <button type="button" className="btn navy" onClick={() => void signIn()}>{t("signInBtn")}</button>
        </section>
      )}
      {me && <p className="note" data-testid="ops-auth">{me.auth === "off" ? t("authOff") : me.user ? td("signedIn", { u: me.user.username, r: me.user.role }) : ""}{inbox ? " · " + (inbox.notifications ? t("notifyOn") : t("notifyOff")) : ""}</p>}

      <section className="card" data-testid="ops-inbox">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{td("inbox", { n: inbox?.items.length ?? 0 })}</h2>
          <button type="button" className="pill" onClick={() => void refresh()}>{t("refresh")}</button>
        </div>
        {inbox && inbox.items.length === 0 && Object.keys(done).length === 0 && <p className="note">{t("empty")}</p>}
        {inbox?.items.map((it) => (
          <article key={it.chain_id} className="ops-item" data-testid="ops-item">
            <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <b><bdi>{it.event ?? it.chain_id}</bdi></b>
              {it.is_synthetic && <span className="badge sm">{t("synthetic")}</span>}
            </div>
            <p style={{ margin: "6px 0" }}><N>{td("alert", { st: name(it.station), at: String(it.crosses_at ?? "–") })}</N></p>
            <div className="ops-rec">
              <small>{td("recommends", { r: it.recommended_rank, n: it.options })}</small>
              <b><bdi>{it.title}</bdi></b>
              {it.what && <span><bdi>{it.what}</bdi></span>}
              <small><N>{td("figures", { b: f.num(it.before), a: f.num(it.after) })}</N></small>
            </div>
            <div className="row ops-actions">
              <button type="button" className="btn red" disabled={!!busy[it.chain_id]} onClick={() => void decide(it.chain_id, "approve")} data-testid="ops-approve">{t("approve")}</button>
              <button type="button" className="btn ghost" disabled={!!busy[it.chain_id]} onClick={() => void decide(it.chain_id, "reject")} data-testid="ops-reject">{t("reject")}</button>
            </div>
          </article>
        ))}
        {Object.entries(done).map(([id, d]) => (
          <article key={id} className="ops-item done" data-testid="ops-done">
            <p style={{ margin: 0 }}><N>{d.decision === "approve" ? t("approvedLogged") : t("rejectedLogged")}</N> <small className="note"><bdi>{id}</bdi></small></p>
            {d.decision === "approve" && !d.notice && (
              <button type="button" className="btn navy" style={{ marginTop: 8 }} disabled={busy[id] === "publish"} onClick={() => void publish(id)} data-testid="ops-publish">{t("publish")}</button>
            )}
            {d.notice && (
              <div className="verify" style={{ marginTop: 8 }} data-testid="ops-notice">
                <b>{t("published")}</b>
                <p style={{ margin: "4px 0" }}><bdi>{(d.notice.text as Record<string, { notice: string }>)[locale]?.notice ?? ""}</bdi></p>
                <a href={`/travel?run=${encodeURIComponent(d.notice.forecast_run_id)}${locale === "ar" ? "&lang=ar" : ""}`}>{t("seeRider")}</a>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="card" data-testid="ops-register">
        <h2>{t("register")}</h2>
        <p className="note">{t("registerSub")}</p>
        <div className="ops-grid">
          <label>{t("name")}<input id="ev-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("namePh")} /></label>
          <label>{t("station")}
            <select id="ev-station" value={form.near_station} onChange={(e) => setForm({ ...form, near_station: e.target.value })}>
              <optgroup label={t("corridor")}>{corridor.map((s) => <option key={s.id} value={s.id}>{f.station(s)}</option>)}</optgroup>
              <optgroup label={t("network")}>{others.map((s) => <option key={s.id} value={s.id}>{f.station(s)}</option>)}</optgroup>
            </select>
          </label>
          <label>{t("date")}<input id="ev-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label>{t("start")}<input id="ev-start" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
          <label>{t("end")}<input id="ev-end" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
          <label>{t("attendance")}<input id="ev-att" type="number" min={1} max={200000} step={500} value={form.attendance} onChange={(e) => setForm({ ...form, attendance: Number(e.target.value) })} /></label>
          <label>{t("venue")}<input id="ev-venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></label>
        </div>
        <button type="button" className="btn red" disabled={form.name.trim().length < 2} onClick={() => void register()} data-testid="ops-register-btn">{t("registerBtn")}</button>
        <div className="ops-csv">
          <label className="pill" htmlFor="ev-csv">{t("csv")}</label>
          <input id="ev-csv" type="file" accept=".csv,text/csv" hidden onChange={(e) => void upload(e.target.files?.[0])} data-testid="ops-csv" />
          <small className="note">{t("csvHelp")}</small>
        </div>
      </section>
      <p className="note">{t("footer")}</p>
    </main>
  );
}

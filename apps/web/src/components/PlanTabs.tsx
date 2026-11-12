"use client";
import { useTranslations } from "next-intl";
import { N, useFmt, useLocale } from "@/lib/i18n";
import type { PlanOption, SimSummary } from "@/lib/api";
import { hotHours, overStations, useTwin } from "@/lib/store";

const STEP_KEYS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** before → after for the three headline measures; both sides are simulator summaries. */
function Delta({ b, a }: { b: SimSummary; a: SimSummary }) {
  const t = useTranslations();
  const f = useFmt();
  const cls = (x: number, y: number) => (y < x ? "good" : y > x ? "bad" : "");
  return (
    <div className="delta">
      <div><b><N>{f.num(b.overcap_station_hours)} → <span className={cls(b.overcap_station_hours, a.overcap_station_hours)}>{f.num(a.overcap_station_hours)}</span></N></b><span>{t("dOver")}</span></div>
      <div><b><N>{f.int(b.excess_pax)} → <span className={cls(b.excess_pax, a.excess_pax)}>{f.int(a.excess_pax)}</span></N></b><span>{t("dExcess")}</span></div>
      <div><b><N>{f.pct(b.peak_lf)} → <span className={cls(b.peak_lf, a.peak_lf)}>{f.pct(a.peak_lf)}</span></N></b><span>{t("dPeak")}</span></div>
    </div>
  );
}

function OptionCard({ o, base, verified }: { o: PlanOption; base: SimSummary; verified: boolean }) {
  const t = useTranslations();
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const decision = useTwin((s) => s.decisions[o.rank]);
  const decide = useTwin((s) => s.decide);
  const names = (o.new_hotspots ?? []).map((id) => f.station(stations.find((s) => s.id === id))).join(", ");
  return (
    <article className={`opt${o.rank === 1 ? " top" : ""}${decision === "reject" ? " rejected" : ""}`}>
      <div className="rank">{t("rankL", { n: f.int(o.rank) })}</div>
      <h3>{o.title}</h3>
      <p>{o.what}</p>
      <Delta b={base} a={o.summary} />
      <p>{t("cost")}: <b><N>+{f.num(o.cost_added ?? 0)}</N></b>. {o.risk}</p>
      {names && <div className="warnbox">{t("newHot", { stations: names })}</div>}
      {verified ? <div className="verify">✓ {t("verified", { n: f.int(o.figures ?? 0) })}</div> : <div className="warnbox">{t("notVerified")}</div>}
      <div className="note">{t("sources", { run: o.sources[0]?.run_id ?? "—" })}</div>
      {decision === "reject" ? <div style={{ fontWeight: 600, fontSize: 13 }}>{t("rejected")}</div> : (
        <div className="row">
          <button type="button" className="btn navy" style={{ flex: 1 }} onClick={() => void decide(o.rank, "approve")}>{t("approve")}</button>
          <button type="button" className="btn ghost" onClick={() => void decide(o.rank, "reject")}>{t("reject")}</button>
        </div>
      )}
    </article>
  );
}

/** "openai:gpt-5" → "OpenAI gpt-5", "claude:claude-opus-5-5" → "Claude claude-opus-5-5" (planner id from the API). */
function modelName(planner: string): string {
  const [provider, ...rest] = planner.split(":");
  const brand = ({ openai: "OpenAI", claude: "Claude" } as Record<string, string>)[provider] ?? provider;
  return `${brand} ${rest.join(":")}`.trim();
}

export function AiTab() {
  const t = useTranslations();
  const { locale } = useLocale();
  const status = useTwin((s) => s.planStatus);
  const step = useTwin((s) => s.planStep);
  const plan = useTwin((s) => s.plan);
  const planError = useTwin((s) => s.planError);
  const decisionError = useTwin((s) => s.decisionError);
  const applied = useTwin((s) => s.applied.length);
  const ready = useTwin((s) => !!s.forecast && !s.loading);
  const run = useTwin((s) => s.runAgents);
  return (
    <>
      <div className="card">
        <button type="button" className="btn red" style={{ width: "100%" }} disabled={status === "running" || !ready} onClick={() => void run(locale)}>{t("plan")}</button>
        {(status === "running" || status === "ready") && (
          <ol className="agent-steps" aria-live="polite">
            {STEP_KEYS.map((i) => (
              <li key={i} className={i < step ? "done" : i === step ? "run" : ""}>
                <span className="dot">{i < step ? "✓" : ""}</span>
                <span>{plan?.steps?.[i]?.label ?? t(`steps.${i}`)}{plan?.steps?.[i]?.detail ? <small><bdi>{plan.steps[i].detail}</bdi></small> : null}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="note" style={{ marginTop: 8 }}>{t("planNote")}</div>
        {plan && plan.planner === "deterministic-template" && <div className="note" style={{ marginTop: 6 }}><span className="badge sm navy">{plan.mode}</span> {t("planMode")}{plan.cached ? ` ${t("planCached")}` : ""}</div>}
        {plan && plan.mode === "live" && <div className="note" style={{ marginTop: 6 }}><span className="badge sm navy">{plan.mode}</span> {t("planLive", { model: modelName(plan.planner) })}{plan.cached ? ` ${t("planCached")}` : ""}</div>}
      </div>
      {status === "error" && <div className="warnbox" role="alert">{t("planError", { msg: planError ?? "" })}</div>}
      {decisionError && <div className="warnbox" role="alert">{t("decisionError", { msg: decisionError })}</div>}
      {status === "ready" && plan && plan.options.length === 0 && <div className="card empty">{t("noHot")}</div>}
      {status === "ready" && plan && plan.options.map((o) => <OptionCard key={o.rank} o={o} base={plan.baseline_summary} verified={plan.verify.all_matched} />)}
      {status === "idle" && applied > 0 && <div className="card empty">{t("replan")}</div>}
    </>
  );
}

export function BuildTab() {
  const t = useTranslations();
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const b = useTwin((s) => s.build);
  const cur = useTwin((s) => s.cur);
  const preview = useTwin((s) => s.preview);
  const previewError = useTwin((s) => s.previewError);
  const patch = useTwin((s) => s.patchBuild);
  const approve = useTwin((s) => s.approveMine);
  const ids = stations.map((s) => s.id);
  const hrs = hotHours(cur, ids);
  const idx = (id: string) => ids.indexOf(id);
  const neighbours = (id: string) => stations.filter((_, i) => Math.abs(i - idx(id)) === 1);     // wayfinding: walkable neighbours only
  const sel = (id: string, value: string, opts: typeof stations, on: (v: string) => void, label: string) => (
    <select id={id} aria-label={label} value={value} onChange={(e) => on(e.target.value)}>{opts.map((s) => <option key={s.id} value={s.id}>{f.station(s)}</option>)}</select>
  );
  const active = b.headway || b.wayShare || b.buses || b.rt || b.stag;
  const newHot = preview && cur ? [...overStations(preview)].filter((id) => !overStations(cur).has(id)) : [];
  return (
    <>
      <div className="card"><h2>{t("build.title")}</h2><div className="note">{t("build.intro")} <b><N>{hrs.map((h) => `${h}:00`).join(", ")}</N></b></div></div>
      <div className="ctl">
        <div className="head">{t("build.trains")}</div>
        <div className="seg">{[0, 3.5, 3, 2.5].map((v) => <button key={v} type="button" aria-pressed={b.headway === v} onClick={() => patch({ headway: v })}>{v ? <N>{t("build.min", { n: f.num(v, 1) })}</N> : t("build.off")}</button>)}</div>
      </div>
      <div className="ctl">
        <div className="head"><label htmlFor="bWay">{t("build.way")}</label><b><N>{f.pct(b.wayShare / 100)}</N></b></div>
        <input id="bWay" type="range" min={0} max={50} step={5} value={b.wayShare} onChange={(e) => patch({ wayShare: +e.target.value })} />
        <div className="two">
          <div><span className="note">{t("build.from")}</span>{sel("bWayF", b.wayFrom, stations, (v) => patch({ wayFrom: v, wayTo: neighbours(v).some((n) => n.id === b.wayTo) ? b.wayTo : neighbours(v)[0]?.id ?? v }), `${t("build.way")} ${t("build.from")}`)}</div>
          <div><span className="note">{t("build.to")}</span>{sel("bWayT", b.wayTo, neighbours(b.wayFrom), (v) => patch({ wayTo: v }), `${t("build.way")} ${t("build.to")}`)}</div>
        </div>
      </div>
      <div className="ctl">
        <div className="head"><label htmlFor="bBus">{t("build.bus")}</label><b><N>{t("build.buses", { n: f.int(b.buses) })}</N></b></div>
        <input id="bBus" type="range" min={0} max={20} step={1} value={b.buses} onChange={(e) => patch({ buses: +e.target.value })} />
        <div className="two">
          <div><span className="note">{t("build.from")}</span>{sel("bBusF", b.busFrom, stations, (v) => patch({ busFrom: v }), `${t("build.bus")} ${t("build.from")}`)}</div>
          <div><span className="note">{t("build.to")}</span>{sel("bBusT", b.busTo, stations, (v) => patch({ busTo: v }), `${t("build.bus")} ${t("build.to")}`)}</div>
        </div>
      </div>
      <div className="ctl">
        <div className="head"><label htmlFor="bRt">{t("build.rt")}</label><b><N>{t("build.vehicles", { n: f.int(b.rt) })}</N></b></div>
        <input id="bRt" type="range" min={0} max={60} step={5} value={b.rt} onChange={(e) => patch({ rt: +e.target.value })} />
        <div><span className="note">{t("build.at")}</span>{sel("bRtA", b.rtAt, stations, (v) => patch({ rtAt: v }), `${t("build.rt")} ${t("build.at")}`)}</div>
      </div>
      <div className="ctl">
        <div className="head">{t("build.stag")}</div>
        <div className="seg">{[0, 30, 60, 90].map((v) => <button key={v} type="button" aria-pressed={b.stag === v} onClick={() => patch({ stag: v })}>{v ? <N>{t("build.min", { n: f.int(v) })}</N> : t("build.off")}</button>)}</div>
      </div>
      <div className="card" aria-live="polite">
        {!active && <div className="empty">{t("build.nothing")}</div>}
        {active && previewError ? <div className="warnbox" role="alert">{t("build.error", { msg: previewError })}</div> : null}
        {active && preview && cur ? (
          <>
            <h2>{t("build.preview")}</h2>
            <Delta b={cur.resp.summary} a={preview.resp.summary} />
            <p className="note" style={{ margin: "8px 0" }}>{t("sCost")}: <b><N>{f.num(cur.resp.summary.cost_proxy)} → {f.num(preview.resp.summary.cost_proxy)}</N></b></p>
            {newHot.length > 0 && <div className="warnbox">{t("newHot", { stations: newHot.map((id) => f.station(stations.find((s) => s.id === id))).join(", ") })}</div>}
            <div className="note">{t("sources", { run: preview.resp.run_id })}</div>
            <button type="button" className="btn navy" style={{ width: "100%", marginTop: 8 }} onClick={() => void approve(t("build.mine"))}>{t("build.approveMine")}</button>
          </>
        ) : null}
      </div>
    </>
  );
}

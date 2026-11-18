"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type Evidence } from "@/lib/api";
import { N, useFmt, useLocale } from "@/lib/i18n";
import { useTwin } from "@/lib/store";

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ReportTab() {
  const t = useTranslations();
  const f = useFmt();
  const { locale } = useLocale();
  const base = useTwin((s) => s.base);
  const cur = useTwin((s) => s.cur);
  const fc = useTwin((s) => s.forecast);
  const log = useTwin((s) => s.log);
  const applied = useTwin((s) => s.applied);
  const [ev, setEv] = useState<Evidence | null>(null);
  const [saved, setSaved] = useState(false);
  const [snapErr, setSnapErr] = useState(false);
  const tmd = useTranslations("report.md");
  const has3d = useTwin((s) => s.view === "3d" && !s.glFailed && s.sceneReady);     // the snapshot needs the 3D view on screen
  const [storage, setStorage] = useState<string | undefined>();
  useEffect(() => { api.health().then((h) => setStorage(h.storage)).catch(() => {}); }, []);
  useEffect(() => { api.evidence().then(setEv).catch(() => setEv(null)); }, [log.length]);
  // the decision log's hash chain (WP5): absent on an older API, then nothing is shown
  const [chainOk, setChainOk] = useState<{ ok: boolean; records: number; first_bad: number | null } | null>(null);
  useEffect(() => { api.verifyLog().then(setChainOk).catch(() => setChainOk(null)); }, [log.length]);
  if (!base || !cur || !fc) return <div className="empty">…</div>;
  const b = base.resp.summary, c = cur.resp.summary;
  const cl = (x: number, y: number) => (y === x ? "" : y < x ? "good" : "bad");
  const clock = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
  const line = (e: (typeof log)[number]) => e.kind === "reset" ? t("logReset", { time: clock(e.ts) }) : t(e.kind === "approve" ? "logApprove" : "logReject", { time: clock(e.ts), title: e.title ?? "" });

  // The brief is written in the language on screen; every figure is the simulator's, with its run id.
  const brief = () => {
    const e = fc.event;
    const weather = t(fc.weather === "hot" ? "wHot" : fc.weather === "rain" ? "wRain" : "wNormal");
    const row = (k: "rowOver" | "rowExcess" | "rowPeak" | "rowWait" | "rowCost", x: number, y: number) => `| ${tmd(k)} | ${x} | ${y} |`;
    const md = [
      `# ${tmd("title")}`, "",
      `${tmd("scenario")}: ${e ? `${f.event(e)} — ${f.venue(e)}, ${e.date}, ${e.start}–${e.end}` : tmd("background")}`,
      `${tmd("attendance")}: ${fc.attendance_used ?? "—"}`,
      `${tmd("conditions")}: ${weather} (${tmd("metroShare")} ${fc.metro_share_used ?? "—"})`,
      `${tmd("threshold")}: ${c.threshold}`, `${tmd("data")}: ${fc.dataset_version}${fc.is_synthetic ? ` — ${t("synthetic")}` : ""}`, "",
      `| ${tmd("measure")} | ${tmd("noPlans")} | ${tmd("withPlans")} |`, "|---|---|---|",
      row("rowOver", b.overcap_station_hours, c.overcap_station_hours),
      row("rowExcess", b.excess_pax, c.excess_pax),
      row("rowPeak", b.peak_lf, c.peak_lf),
      row("rowWait", b.max_wait_min, c.max_wait_min),
      row("rowCost", b.cost_proxy, c.cost_proxy), "",
      `## ${tmd("approved")}`, ...(applied.length ? applied.map((a) => `- ${a.title}: \`${JSON.stringify(a.ivs)}\``) : [`- ${tmd("none")}`]), "",
      `## ${t("decisions")}`, ...(log.length ? [...log].reverse().map((l) => `- ${l.ts} · ${line(l)}`) : [`- ${tmd("none")}`]), "",
      tmd("sources", { fc: fc.run_id, base: base.resp.run_id, cur: cur.resp.run_id }),
      "", `_${tmd("disclaimer")}_`, "",
    ].join("\n");
    download(locale === "ar" ? "eventflow-twin-brief-ar.md" : "eventflow-twin-brief.md", new Blob([md], { type: "text/markdown" }));
    setSnapErr(false);
    setSaved(true);
  };
  const snapshot = () => {
    const canvas = document.querySelector<HTMLCanvasElement>(".view canvas");
    if (!canvas) { setSnapErr(true); return; }
    canvas.toBlob((blob) => { if (blob) { download("eventflow-twin-3d.png", blob); setSnapErr(false); setSaved(true); } else setSnapErr(true); }, "image/png");
  };
  const fcEval = ev?.eval.forecast, simEval = ev?.eval.simulator;
  const lg = fcEval?.metrics as { lgbm_mase?: number; naive_mase?: number; lgbm_coverage80?: number } | undefined;
  const sm = simEval?.metrics as { property_pass_rate?: number } | undefined;

  return (
    <>
      <div className="card">
        <h2>{t("score")}</h2>
        <div className="score">
          <span className="h">{t("metric")}</span><span className="h">{t("before")}</span><span className="h">{t("after")}</span>
          <span>{t("sOver")}</span><b><N>{f.num(b.overcap_station_hours)}</N></b><b className={cl(b.overcap_station_hours, c.overcap_station_hours)}><N>{f.num(c.overcap_station_hours)}</N></b>
          <span>{t("sExcess")}</span><b><N>{f.int(b.excess_pax)}</N></b><b className={cl(b.excess_pax, c.excess_pax)}><N>{f.int(c.excess_pax)}</N></b>
          <span>{t("sPeak")}</span><b><N>{f.pct(b.peak_lf)}</N></b><b className={cl(b.peak_lf, c.peak_lf)}><N>{f.pct(c.peak_lf)}</N></b>
          <span>{t("sWait")}</span><b><N>{f.num(b.max_wait_min, 1)}</N></b><b className={cl(b.max_wait_min, c.max_wait_min)}><N>{f.num(c.max_wait_min, 1)}</N></b>
          <span>{t("sCost")}</span><b><N>{f.num(b.cost_proxy)}</N></b><b><N>{f.num(c.cost_proxy)}</N></b>
        </div>
        <div className="note" style={{ marginTop: 8 }}>{t("sources", { run: cur.resp.run_id })}</div>
      </div>
      <div className="card">
        <h2>{t("decisions")}</h2>
        {log.length ? <ol className="log">{log.map((l, i) => <li key={i}><bdi>{line(l)}</bdi></li>)}</ol> : <div className="empty">{t("noDecisions")}</div>}
        {storage === "ephemeral" && <div className="note" style={{ marginTop: 6 }}>{t("report.ephemeral")}</div>}
      </div>
      <div className="card">
        <h2>{t("report.evidence")}</h2>
        <div className="score" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
          <span>{t("report.dataset")}</span><b style={{ fontWeight: 500 }}>{fc.is_synthetic && <span className="badge sm">{t("synthetic")}</span>} <bdi className="note">{fc.dataset_version}</bdi></b>
          {lg?.lgbm_mase != null && (
            <>
              <span>{t("report.forecast")}<br /><span className="note">{t("report.file", { file: fcEval!.file })}</span></span>
              <b style={{ fontWeight: 500 }}>
                {t("report.mase")} <N>{f.num(lg.lgbm_mase, 3)}</N>{lg.naive_mase != null && <> / <N>{f.num(lg.naive_mase, 3)}</N></>}
                {lg.lgbm_coverage80 != null && <><br />{t("report.coverage")} <N>{f.pct(lg.lgbm_coverage80)}</N></>}
                {fcEval?.is_synthetic && <> <span className="badge sm">{t("synthetic")}</span></>}
              </b>
            </>
          )}
          {sm?.property_pass_rate != null && (
            <>
              <span>{t("report.simulator")}<br /><span className="note">{t("report.file", { file: simEval!.file })}</span></span>
              <b style={{ fontWeight: 500 }}><N>{t("report.passed", { a: f.pct(sm.property_pass_rate), b: f.int(simEval?.n ?? 0) })}</N></b>
            </>
          )}
          {ev && <><span>{t("report.logged")}</span><b><N>{f.int(ev.decisions_logged)}</N></b></>}
          {chainOk && <><span>{t("report.chain")}</span><b data-testid="log-verified" className={chainOk.ok ? "good" : "bad"}><N>{chainOk.ok ? t("report.chainOk", { n: chainOk.records }) : t("report.chainBad", { line: chainOk.first_bad ?? 0 })}</N></b></>}
          {ev && <><span>{t("report.contract")}</span><b style={{ fontWeight: 500 }}><N>{ev.contract}</N></b></>}
        </div>
      </div>
      <div className="card">
        <h2>{t("report.title")}</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn navy" onClick={brief}>{t("report.save")}</button>
          <button type="button" className="btn ghost" disabled={!has3d} onClick={snapshot} data-testid="report-snap">{t("report.snap")}</button>
          <button type="button" className="btn ghost" onClick={() => window.print()} data-testid="print-brief">{t("report.print")}</button>
        </div>
        {!has3d && <div className="note" style={{ marginTop: 6 }} data-testid="report-snap-note">{t("report.snapNo")}</div>}
        {snapErr && <div className="warnbox" role="alert" style={{ marginTop: 6 }}>{t("report.snapFail")}</div>}
        {saved && <div className="note" role="status" style={{ marginTop: 6 }}>{t("report.saved")}</div>}
      </div>
    </>
  );
}

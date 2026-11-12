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
  useEffect(() => { api.evidence().then(setEv).catch(() => setEv(null)); }, [log.length]);
  if (!base || !cur || !fc) return <div className="empty">…</div>;
  const b = base.resp.summary, c = cur.resp.summary;
  const cl = (x: number, y: number) => (y === x ? "" : y < x ? "good" : "bad");
  const clock = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
  const line = (e: (typeof log)[number]) => e.kind === "reset" ? t("logReset", { time: clock(e.ts) }) : t(e.kind === "approve" ? "logApprove" : "logReject", { time: clock(e.ts), title: e.title ?? "" });

  const brief = () => {
    const e = fc.event;
    const md = [
      "# EventFlow Twin – event brief", "",
      `Scenario: ${e ? `${e.name} — ${e.venue}, ${e.date}, ${e.start}–${e.end}` : "background day"}`,
      `Attendance (assumption): ${fc.attendance_used ?? "—"}`, `Conditions: ${fc.weather} (metro share of event trips ${fc.metro_share_used ?? "—"}, assumption)`,
      `Comfort threshold: ${c.threshold}`, `Demand data: ${fc.dataset_version}${fc.is_synthetic ? " — SYNTHETIC" : ""}`, "",
      "| Measure | No plans | With approved plans |", "|---|---|---|",
      `| Station-hours over threshold | ${b.overcap_station_hours} | ${c.overcap_station_hours} |`,
      `| Riders above threshold | ${b.excess_pax} | ${c.excess_pax} |`,
      `| Peak station load factor | ${b.peak_lf} | ${c.peak_lf} |`,
      `| Longest extra wait (min) | ${b.max_wait_min} | ${c.max_wait_min} |`,
      `| Cost proxy (relative) | ${b.cost_proxy} | ${c.cost_proxy} |`, "",
      "## Approved plans", ...(applied.length ? applied.map((a) => `- ${a.title}: \`${JSON.stringify(a.ivs)}\``) : ["- none"]), "",
      "## Decisions", ...(log.length ? [...log].reverse().map((l) => `- ${l.ts} ${l.kind}${l.title ? `: ${l.title}` : ""}`) : ["- none"]), "",
      `Sources: forecast run ${fc.run_id}; simulator runs ${base.resp.run_id} (no plans) and ${cur.resp.run_id} (with approved plans).`,
      "", "_Research prototype. Synthetic baseline demand and assumption-based scenario. Not an RTA system and not endorsed by RTA._", "",
    ].join("\n");
    download("eventflow-twin-brief.md", new Blob([md], { type: "text/markdown" }));
    setSaved(true);
  };
  const snapshot = () => {
    const canvas = document.querySelector<HTMLCanvasElement>(".view canvas");
    canvas?.toBlob((blob) => { if (blob) { download("eventflow-twin-3d.png", blob); setSaved(true); } }, "image/png");
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
          {ev && <><span>{t("report.contract")}</span><b style={{ fontWeight: 500 }}><N>{ev.contract}</N></b></>}
        </div>
      </div>
      <div className="card">
        <h2>{t("report.title")}</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn navy" onClick={brief}>{t("report.save")}</button>
          <button type="button" className="btn ghost" onClick={snapshot}>{t("report.snap")}</button>
        </div>
        {saved && <div className="note" role="status" style={{ marginTop: 6 }}>{t("report.saved")}</div>}
      </div>
    </>
  );
}

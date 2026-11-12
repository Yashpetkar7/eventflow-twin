"use client";
// Break point for the selected station: at what crowd size it crosses the comfort line (POST /breakpoint), where
// this scenario sits on that scale, and how the answer moves with the softest assumption (free space on arriving
// trains). Every number comes from the API; the bar positions are proportions of those numbers.
import { useTranslations } from "next-intl";
import { N, useFmt } from "@/lib/i18n";
import { useTwin } from "@/lib/store";

export function BreakCard() {
  const t = useTranslations();
  const f = useFmt();
  const breaks = useTwin((s) => s.breaks);
  const selected = useTwin((s) => s.selected);
  const stations = useTwin((s) => s.stations);
  if (!breaks) return null;
  const st = stations.find((s) => s.id === selected);
  const row = breaks.stations.find((s) => s.station_id === selected);
  const att = breaks.attendance_used ?? 0;
  if (!row || !st) return null;
  const name = f.station(st);
  const brk = row.break_attendance;
  const scale = Math.max(att, brk ?? 0) * 1.15 || 1;
  const pos = (v: number) => `${Math.min(100, (v / scale) * 100).toFixed(1)}%`;
  const over = brk !== null && att >= brk;
  const gridMax = Math.max(...breaks.grid.map((g) => g.break_attendance ?? 0), att) * 1.1 || 1;
  return (
    <div className="card brk" data-testid="break-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{t("brk.title")}</h2>
        {breaks.is_synthetic && <span className="badge sm">{t("synthetic")}</span>}
      </div>
      {brk === null || !row.served ? (
        <p className="note" style={{ margin: "8px 0 0" }}>{t("brk.notServed", { station: name })}</p>
      ) : (
        <>
          <p className="brk-head"><bdi>{t("brk.crosses", { station: name, n: f.int(brk) })}</bdi></p>
          <p className="note" style={{ margin: 0 }}><bdi>{t("brk.firstAt", { time: row.first_time ?? "" })}</bdi></p>
          <div className="brk-bar" role="img" aria-label={`${t("brk.aria")}: ${t("brk.crosses", { station: name, n: f.int(brk) })}; ${t("brk.now")} ${f.int(att)}`}>
            <div className="brk-fill" style={{ width: pos(att), background: over ? "var(--risk)" : "var(--ok)" }} />
            <div className="brk-line" style={{ insetInlineStart: pos(brk) }} />
          </div>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
            <span>{t("brk.now")}: <b><N>{f.int(att)}</N></b></span>
            <span className={over ? "bad" : "good"}><b><N>{over ? t("brk.over", { n: f.int(att - brk) }) : t("brk.margin", { n: f.int(brk - att) })}</N></b></span>
          </div>
        </>
      )}
      <div className="brk-grid">
        <div className="note" style={{ marginBottom: 4 }}>{t("brk.gridTitle")}</div>
        {breaks.grid.map((g) => {
          const isDefault = Math.abs(g.boardable_share - breaks.boardable_share_default) < 1e-9;
          const gs = stations.find((s) => s.id === g.station_id);
          const crossed = g.break_attendance !== null && att >= g.break_attendance;
          return (
            <div key={g.boardable_share} className={`brk-g${isDefault ? " def" : ""}`}>
              <span className="num">{f.pct(g.boardable_share)}</span>
              <span className="brk-gbar"><i style={{ width: `${(((g.break_attendance ?? 0) / gridMax) * 100).toFixed(1)}%`, background: crossed ? "var(--risk)" : "var(--navy)" }} /></span>
              <span className="num"><N>{g.break_attendance === null ? "—" : f.int(g.break_attendance)}</N></span>
              <span className="note brk-gst">{gs ? f.station(gs) : ""}</span>
            </div>
          );
        })}
        <p className="note" style={{ margin: "6px 0 0" }}>{t("brk.assumptionTrain", { pct: f.pct(breaks.boardable_share_default) })}</p>
      </div>
    </div>
  );
}

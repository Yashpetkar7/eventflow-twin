"use client";
// Accessible table version of the map + heat strip (PRD story 5). Same numbers, same sources.
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ForecastResponse, SimulateResponse, Station } from "@/lib/api";
import { useFmt, useNames } from "@/lib/i18n";
import { COMFORT } from "@/lib/load";

export default function TableView({ forecast, sim, stations }: {
  forecast: ForecastResponse | null; sim: SimulateResponse | null; stations: Station[];
}) {
  const t = useTranslations("table");
  const { fmt, pct, hh } = useFmt();
  const names = useNames();
  const [stationId, setStationId] = useState<string>(stations[0]?.id ?? "");
  const rows = Array.from({ length: 19 }, (_, i) => i + 5).map((h) => ({
    h,
    f: forecast?.rows.find((r) => r.station_id === stationId && r.hour === h),
    s: sim?.hourly.find((r) => r.station_id === stationId && r.hour === h),
  }));

  return (
    <div className="min-h-0 overflow-auto p-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-[13px] text-ink-2" htmlFor="tv-station">{t("station")}</label>
        <select id="tv-station" value={stationId} onChange={(e) => setStationId(e.target.value)}
          className="min-h-10 rounded-lg border border-line bg-surface px-3 py-1.5 text-[14px]">
          {stations.map((s) => <option key={s.id} value={s.id}>{names.station(s)}</option>)}
        </select>
        <span className="text-[12px] text-ink-3">{t("sources", { fc: forecast?.run_id ?? "—", sim: sim?.run_id ?? "—" })}</span>
      </div>
      <table className="num w-full max-w-4xl border-collapse text-[13px]">
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-ink-3">
            <th className="py-2 text-start">{t("hour")}</th><th className="text-end">{t("p10")}</th><th className="text-end">{t("p50")}</th>
            <th className="text-end">{t("p90")}</th><th className="text-end">{t("capacity")}</th><th className="text-end">{t("peak")}</th>
            <th className="ps-3 text-start">{t("status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ h, f, s }) => (
            <tr key={h} className="border-t border-line">
              <th scope="row" className="py-1.5 text-start font-medium">{hh(h)}</th>
              <td className="text-end">{fmt(f?.entries_p10 ?? 0)}</td>
              <td className="text-end">{fmt(f?.entries_p50 ?? 0)}</td>
              <td className="text-end">{fmt(f?.entries_p90 ?? 0)}</td>
              <td className="text-end">{fmt(s?.capacity ?? 0)}</td>
              <td className="text-end font-semibold">{pct(s?.peak_lf ?? 0)}</td>
              <td className="ps-3">{(s?.peak_lf ?? 0) > COMFORT ? t("above") : t("ok")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

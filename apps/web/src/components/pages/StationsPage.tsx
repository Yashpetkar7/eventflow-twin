"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { useShownSim, useTwinCtx } from "@/lib/twinContext";
import { useFmt, useNames } from "@/lib/i18n";
import { stationDays, type StationDay } from "@/lib/stats";
import { band } from "@/lib/load";
import { StationChart, StationSummary } from "../Inspector";
import { Badge, LineChip, PageHeader } from "../ui";

const BAND_TEXT = { ok: "text-ok", warn: "text-warn", risk: "text-risk" } as const;
type SortKey = "peak" | "name" | "boardings";

export default function StationsPage() {
  const t = useTranslations("stations");
  const tn = useTranslations("nav");
  const tp = useTranslations("page");
  const { fmt, pct, hh } = useFmt();
  const names = useNames();
  const { twin, stationId, setStationId, setHour } = useTwinCtx();
  const sim = useShownSim();
  const [q, setQ] = useState("");
  const [line, setLine] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("peak");
  const [open, setOpen] = useState<string | null>(null);

  const days = useMemo(() => stationDays(sim, twin.stations, twin.forecast), [sim, twin.stations, twin.forecast]);
  const lines = useMemo(() => [...new Set(twin.stations.flatMap((s) => s.lines ?? []))], [twin.stations]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = days.filter((d) => (line === "all" || d.station.lines?.includes(line)) &&
      (!needle || d.station.name_en.toLowerCase().includes(needle) || (d.station.name_ar ?? "").includes(q.trim())));
    const cmp: Record<SortKey, (a: StationDay, b: StationDay) => number> = {
      peak: (a, b) => b.peakLf - a.peakLf,
      boardings: (a, b) => b.boardings - a.boardings,
      name: (a, b) => names.station(a.station).localeCompare(names.station(b.station)),
    };
    return list.sort(cmp[sort]);
  }, [days, q, line, sort, names]);
  const detail = days.find((d) => d.station.id === open);

  const select = (d: StationDay) => { setOpen(d.station.id); setStationId(d.station.id); setHour(d.peakHour); };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader title={tn("stations")} sub={tp("stationsSub")} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")}
            className="min-h-10 w-64 rounded-full border border-line bg-surface ps-9 pe-3 text-[13px]" />
        </label>
        <div className="flex rounded-full border border-line bg-surface p-1" role="group">
          {["all", ...lines].map((l) => (
            <button key={l} onClick={() => setLine(l)} aria-pressed={line === l}
              className={`min-h-8 rounded-full px-3 text-[12px] ${line === l ? "bg-accent text-white" : "text-ink-2"}`}>
              {l === "all" ? t("all") : <LineName line={l} />}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[12px] text-ink-2">{t("sortBy")}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="min-h-9 rounded-lg border border-line bg-surface px-2 text-[13px]">
            <option value="peak">{t("peak")}</option><option value="boardings">{t("boardings")}</option><option value="name">{t("name")}</option>
          </select>
        </label>
        <span className="text-[12px] text-ink-3">{t("count", { n: shown.length })}</span>
      </div>

      <div className={`grid gap-4 ${detail ? "xl:grid-cols-[1fr_420px]" : ""}`}>
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-1)]">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-4 py-2.5 text-start">{t("name")}</th><th className="px-2 text-start">{t("lines")}</th>
                <th className="px-2 text-end">{t("peak")}</th><th className="px-2 text-end">{t("peakHour")}</th>
                <th className="px-2 text-end">{t("boardings")}</th><th className="px-4 text-end">{t("capacity")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.station.id} onClick={() => select(d)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && select(d)}
                  aria-selected={d.station.id === stationId}
                  className={`cursor-pointer border-t border-line hover:bg-muted/50 ${d.station.id === open ? "bg-accent-soft/60" : ""}`}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{names.station(d.station)}</span>
                    <span className="ms-2 inline-flex gap-1 align-middle">
                      {(d.station.lines?.length ?? 0) > 1 && <Badge>{t("interchange")}</Badge>}
                      {d.station.in_corridor && <Badge tone="ok">{t("corridor")}</Badge>}
                    </span>
                  </td>
                  <td className="px-2"><span className="flex gap-1">{d.station.lines?.map((l) => <LineChip key={l} line={l} />)}</span></td>
                  <td className={`num px-2 text-end font-semibold ${BAND_TEXT[band(d.peakLf)]}`}>{pct(d.peakLf)}</td>
                  <td className="num px-2 text-end text-ink-2">{hh(d.peakHour)}</td>
                  <td className="num px-2 text-end text-ink-2">{fmt(d.boardings)}</td>
                  <td className="num px-4 text-end text-ink-2">{fmt(d.capacityAtPeak)}/h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail && (
          <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start" aria-label={t("detail")}>
            <div className="flex justify-end">
              <button onClick={() => setOpen(null)} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-surface px-3 text-[12px]">
                <X className="h-4 w-4" aria-hidden /> {t("close")}
              </button>
            </div>
            <StationSummary station={detail.station} />
            <section className="glass p-4"><StationChart stationId={detail.station.id} height="h-56" /></section>
          </aside>
        )}
      </div>
    </div>
  );
}

function LineName({ line }: { line: string }) {
  const t = useTranslations("lineName");
  return <>{line === "Red" || line === "Green" || line === "Branch" ? t(line) : line}</>;
}

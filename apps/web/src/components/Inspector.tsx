"use client";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlanOption, SimSummary, Station } from "@/lib/api";
import type { Twin } from "@/lib/useTwin";
import type { OptionLabel, PlannerText } from "@/lib/previewPlanner";
import { useFmt, useLocaleSwitch, useNames } from "@/lib/i18n";
import { COMFORT, band } from "@/lib/load";

const BAND_TEXT = { ok: "text-ok", warn: "text-warn", risk: "text-risk" } as const;

export default function Inspector({ twin, station, hour, view, plannerText }: {
  twin: Twin; station: Station | null; hour: number; view: "before" | "after"; plannerText: PlannerText;
}) {
  const t = useTranslations("inspector");
  const { fmt, pct, hh } = useFmt();
  const names = useNames();
  const { locale } = useLocaleSwitch();
  const rtl = locale === "ar";
  const { forecast, baseline, after } = twin;
  const shown = view === "after" && after ? after : baseline;
  const row = shown?.hourly.find((r) => r.station_id === station?.id && r.hour === hour);
  const lf = row?.peak_lf ?? 0;

  const chart = useMemo(() => {
    if (!forecast || !baseline || !station) return [];
    return Array.from({ length: 19 }, (_, i) => i + 5).map((h) => {
      const f = forecast.rows.find((r) => r.station_id === station.id && r.hour === h);
      const cap = baseline.hourly.find((r) => r.station_id === station.id && r.hour === h)?.capacity ?? 0;
      const a = after?.hourly.find((r) => r.station_id === station.id && r.hour === h)?.demand;
      return { hour: h, band: [f?.entries_p10 ?? 0, f?.entries_p90 ?? 0], p50: f?.entries_p50 ?? 0,
        comfort: Math.round(cap * COMFORT), after: a };
    });
  }, [forecast, baseline, after, station]);

  return (
    <aside className="flex min-h-0 w-full flex-col gap-4 overflow-y-auto border-s border-line bg-surface/60 p-5">
      <section>
        <h2 className="label">{t("selected", { station: names.station(station) })}</h2>
        <div className="glass mt-2 p-4">
          <p className={`num text-[40px] font-semibold leading-none ${BAND_TEXT[band(lf)]}`}>{pct(lf)}</p>
          <p className="mt-2 text-[13px] text-ink-2">
            {t("peakAt", { hour: hh(hour) })}{lf > COMFORT ? t("aboveComfort") : ""}{view === "after" && after ? t("afterPlan") : ""}
          </p>
          {row && <p className="num mt-1 text-[12px] text-ink-3">{t("flow", { demand: fmt(row.demand), capacity: fmt(row.capacity) })}</p>}
        </div>
      </section>

      <section className="glass p-4">
        <h3 className="mb-1 text-[13px] font-medium text-ink-2">{t("chartTitle")}</h3>
        <div className="h-44" role="img" aria-label={t("chartAria")}>
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ top: 6, right: rtl ? -12 : 6, bottom: 0, left: rtl ? 6 : -12 }}>
              <CartesianGrid stroke="rgba(27,31,42,0.06)" vertical={false} />
              <XAxis dataKey="hour" reversed={rtl} tickFormatter={(h) => String(h).padStart(2, "0")} tick={{ fontSize: 10 }} interval={2} />
              <YAxis orientation={rtl ? "right" : "left"} tick={{ fontSize: 10 }} width={44} tickFormatter={(v) => fmt(Number(v))} />
              <Tooltip formatter={(v) => (Array.isArray(v) ? v.map((x) => fmt(Number(x))).join(" – ") : fmt(Number(v)))}
                labelFormatter={(h) => hh(Number(h))} />
              <Area dataKey="band" name={t("band")} stroke="none" fill="#1D4ED8" fillOpacity={0.14} isAnimationActive={false} />
              <Line dataKey="p50" name={t("p50")} stroke="#1D4ED8" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="comfort" name={t("comfort")} stroke="#B4454F" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              {after && <Line dataKey="after" name={t("afterLine")} stroke="#3F8F6B" strokeWidth={2} dot={false} isAnimationActive={false} />}
              <ReferenceLine x={hour} stroke="#8A8F9C" strokeDasharray="2 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {forecast && locale === "en" && <p className="mt-1 text-[11px] leading-snug text-ink-3">{forecast.band_note}</p>}
      </section>

      <PlanPanel twin={twin} plannerText={plannerText} />
      {after && baseline && <Scoreboard before={baseline.summary} after={after.summary} source={after.source.run_id} />}
    </aside>
  );
}

function PlanPanel({ twin, plannerText }: { twin: Twin; plannerText: PlannerText }) {
  const t = useTranslations("plan");
  const { plan, planLabels, planStatus, planError, requestPlan, decisions, decide, baseline, afterLoading, stations } = twin;
  const nothingToFix = baseline && baseline.summary.overcap_station_hours === 0;
  const preview = plan?.plan_id.startsWith("preview_");

  return (
    <section className="flex flex-col gap-3">
      <button onClick={requestPlan} disabled={!baseline || planStatus === "loading"} data-tour="plan"
        className="min-h-12 rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50">
        {planStatus === "loading" ? t("planning") : plan ? t("replan") : t("button")}
      </button>
      <p className="text-[12px] leading-snug text-ink-3">{t("human")}</p>
      {planError && (
        <p role="alert" className="text-[13px] text-risk">
          {planError.kind === "decision" ? t("notLogged", { error: planError.message }) : planError.message}
        </p>
      )}
      {plan && preview && (
        <p className="rounded-lg bg-muted px-3 py-2 text-[12px] leading-snug text-ink-2"><b>{t("preview")}</b> {t("previewText")}</p>
      )}
      {plan && plan.options.length === 0 && <p className="text-[13px] text-ink-2">{nothingToFix ? t("nothing") : t("noGain")}</p>}
      {plan?.options.map((o) => (
        <OptionCard key={o.rank} option={o} base={plan.baseline_summary} decision={decisions[o.rank]} busy={afterLoading}
          label={planLabels?.[o.rank]} plannerText={plannerText} stations={stations} onDecide={(d) => decide(o.rank, d)} />
      ))}
    </section>
  );
}

function OptionCard({ option, base, decision, busy, label, plannerText, stations, onDecide }: {
  option: PlanOption; base: SimSummary; decision?: "approve" | "reject"; busy: boolean; label?: OptionLabel;
  plannerText: PlannerText; stations: Station[]; onDecide: (d: "approve" | "reject") => void;
}) {
  const t = useTranslations("plan");
  const { fmt, pct } = useFmt();
  const s = option.summary;
  // Preview options re-render their text in the current language; agent options arrive already localised.
  const title = label ? plannerText.title(label, stations) : option.title;
  const rationale = label ? plannerText.rationale(title, base, s) : option.rationale;
  const metrics: [string, string, string][] = [
    [t("overcap"), fmt(base.overcap_station_hours, 2), fmt(s.overcap_station_hours, 2)],
    [t("excess"), fmt(base.excess_pax), fmt(s.excess_pax)],
    [t("peak"), pct(base.peak_lf), pct(s.peak_lf)],
    [t("wait"), fmt(base.max_wait_min, 1), fmt(s.max_wait_min, 1)],
  ];
  return (
    <article className={`glass p-4 ${decision === "approve" ? "ring-2 ring-ok/60" : decision === "reject" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{option.rank}</span>
        <h3 className="text-[14px] font-semibold leading-snug">{title}</h3>
      </div>
      <table className="num mt-3 w-full text-[12px]">
        <tbody>
          {metrics.map(([k, b, a]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1 text-ink-3">{k}</td>
              <td className="py-1 text-end text-ink-3">{b}</td>
              <td className="px-1 text-ink-3 rtl:-scale-x-100">→</td>
              <td className="py-1 text-end font-semibold">{a}</td>
            </tr>
          ))}
          <tr className="border-t border-line"><td className="py-1 text-ink-3">{t("cost")}</td><td /><td /><td className="py-1 text-end">{fmt(s.cost_proxy, 1)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{rationale}</p>
      <p className="mt-1 truncate text-[10px] text-ink-3" dir="ltr" title={option.sources.map((x) => `${x.tool}:${x.run_id}`).join(", ")}>
        {t("sources")}: {option.sources.map((x) => `${x.tool} ${x.run_id}`).join(" · ")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => onDecide("approve")} disabled={busy} aria-pressed={decision === "approve"}
          className={`min-h-12 rounded-xl text-[14px] font-semibold ${decision === "approve" ? "bg-ok text-white" : "border border-ok/40 text-ok hover:bg-ok/10"}`}>
          {decision === "approve" ? t("approved") : t("approve")}
        </button>
        <button onClick={() => onDecide("reject")} disabled={busy} aria-pressed={decision === "reject"}
          className={`min-h-12 rounded-xl text-[14px] font-semibold ${decision === "reject" ? "bg-ink-3 text-white" : "border border-line text-ink-2 hover:bg-muted"}`}>
          {decision === "reject" ? t("rejected") : t("reject")}
        </button>
      </div>
    </article>
  );
}

function Scoreboard({ before, after, source }: { before: SimSummary; after: SimSummary; source: string }) {
  const t = useTranslations("plan");
  const { fmt, pct } = useFmt();
  const rows: [string, number, number, (n: number) => string, boolean][] = [
    [t("overcap"), before.overcap_station_hours, after.overcap_station_hours, (n) => fmt(n, 2), true],
    [t("excess"), before.excess_pax, after.excess_pax, (n) => fmt(n), true],
    [t("peak"), before.peak_lf, after.peak_lf, pct, true],
    [t("wait"), before.max_wait_min, after.max_wait_min, (n) => fmt(n, 1), true],
    [t("cost"), before.cost_proxy, after.cost_proxy, (n) => fmt(n, 1), false],
  ];
  return (
    <section className="glass p-4" aria-label={t("scoreAria")}>
      <h3 className="label mb-2">{t("scoreTitle")}</h3>
      <table className="num w-full text-[13px]">
        <tbody>
          {rows.map(([k, b, a, f, lowerIsBetter]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5 text-ink-2">{k}</td>
              <td className="py-1.5 text-end text-ink-3">{f(b)}</td>
              <td className="px-1 text-ink-3 rtl:-scale-x-100">→</td>
              <td className={`py-1.5 text-end font-semibold ${lowerIsBetter && a < b ? "text-ok" : ""}`}>{f(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 truncate text-[10px] text-ink-3" dir="ltr">{t("source", { id: source })}</p>
    </section>
  );
}

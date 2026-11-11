"use client";
import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlanOption, SimSummary, Station } from "@/lib/api";
import type { Twin } from "@/lib/useTwin";
import { COMFORT, band, fmt, hh, pct } from "@/lib/load";

const BAND_TEXT = { ok: "text-ok", warn: "text-warn", risk: "text-risk" } as const;

export default function Inspector({ twin, station, hour, view }: {
  twin: Twin; station: Station | null; hour: number; view: "before" | "after";
}) {
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
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-s border-line bg-surface/60 p-5">
      <section>
        <h2 className="label">Selected · {station?.name_en ?? "—"}</h2>
        <div className="glass mt-2 p-4">
          <p className={`num text-[40px] font-semibold leading-none ${BAND_TEXT[band(lf)]}`}>{pct(lf)}</p>
          <p className="mt-2 text-[13px] text-ink-2">
            peak 15-min load at {hh(hour)} vs 85% comfort{lf > COMFORT ? " — above comfort" : ""}
            {view === "after" && after ? " (after approved plan)" : ""}
          </p>
          {row && (
            <p className="num mt-1 text-[12px] text-ink-3">
              {fmt(row.demand)} boardings/h · capacity {fmt(row.capacity)}/h
            </p>
          )}
        </div>
      </section>

      <section className="glass p-4">
        <h3 className="mb-1 text-[13px] font-medium text-ink-2">Boardings per hour: forecast band (p10–p90) vs comfort capacity</h3>
        <div className="h-44" role="img" aria-label="Forecast boardings per hour against comfort capacity">
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ top: 6, right: 6, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="rgba(27,31,42,0.06)" vertical={false} />
              <XAxis dataKey="hour" tickFormatter={(h) => String(h).padStart(2, "0")} tick={{ fontSize: 10 }} interval={2} />
              <YAxis tick={{ fontSize: 10 }} width={44} />
              <Tooltip formatter={(v) => (Array.isArray(v) ? v.map((x) => fmt(Number(x))).join(" – ") : fmt(Number(v)))}
                labelFormatter={(h) => hh(Number(h))} />
              <Area dataKey="band" name="p10–p90" stroke="none" fill="#1D4ED8" fillOpacity={0.14} isAnimationActive={false} />
              <Line dataKey="p50" name="forecast p50" stroke="#1D4ED8" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="comfort" name="85% of capacity" stroke="#B4454F" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              {after && <Line dataKey="after" name="after plan" stroke="#3F8F6B" strokeWidth={2} dot={false} isAnimationActive={false} />}
              <ReferenceLine x={hour} stroke="#8A8F9C" strokeDasharray="2 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {forecast && <p className="mt-1 text-[11px] leading-snug text-ink-3">{forecast.band_note}</p>}
      </section>

      <PlanPanel twin={twin} />
      {after && baseline && <Scoreboard before={baseline.summary} after={after.summary} source={after.source.run_id} />}
    </aside>
  );
}

function PlanPanel({ twin }: { twin: Twin }) {
  const { plan, planStatus, planError, requestPlan, decisions, decide, baseline, afterLoading } = twin;
  const nothingToFix = baseline && baseline.summary.overcap_station_hours === 0;
  const preview = plan?.plan_id.startsWith("preview_");

  return (
    <section className="flex flex-col gap-3">
      <button onClick={requestPlan} disabled={!baseline || planStatus === "loading"}
        className="min-h-12 rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50">
        {planStatus === "loading" ? "Planning…" : plan ? "Re-plan interventions" : "Plan interventions →"}
      </button>
      <p className="text-[12px] leading-snug text-ink-3">A human planner approves every option. Numbers come only from the simulator.</p>
      {planError && <p role="alert" className="text-[13px] text-risk">{planError}</p>}
      {plan && preview && (
        <p className="rounded-lg bg-muted px-3 py-2 text-[12px] leading-snug text-ink-2">
          <b>Preview planner (no AI yet):</b> fixed candidate menu around the hotspot, measured by the simulator.
          The AI agent replaces this when it lands.
        </p>
      )}
      {plan && plan.options.length === 0 && (
        <p className="text-[13px] text-ink-2">
          {nothingToFix ? "No station exceeds the comfort threshold in this scenario — nothing to plan. Try a larger attendance." :
            "No candidate reduced crowding."}
        </p>
      )}
      {plan?.options.map((o) => (
        <OptionCard key={o.rank} option={o} base={plan.baseline_summary} decision={decisions[o.rank]}
          busy={afterLoading} onDecide={(d) => decide(o.rank, d)} />
      ))}
    </section>
  );
}

function OptionCard({ option, base, decision, busy, onDecide }: {
  option: PlanOption; base: SimSummary; decision?: "approve" | "reject"; busy: boolean;
  onDecide: (d: "approve" | "reject") => void;
}) {
  const s = option.summary;
  const metrics: [string, string, string][] = [
    ["Over-capacity station-hours", fmt(base.overcap_station_hours, 2), fmt(s.overcap_station_hours, 2)],
    ["Passengers above comfort", fmt(base.excess_pax), fmt(s.excess_pax)],
    ["Peak load", pct(base.peak_lf), pct(s.peak_lf)],
    ["Longest wait (min)", fmt(base.max_wait_min, 1), fmt(s.max_wait_min, 1)],
  ];
  return (
    <article className={`glass p-4 ${decision === "approve" ? "ring-2 ring-ok/60" : decision === "reject" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{option.rank}</span>
        <h3 className="text-[14px] font-semibold leading-snug">{option.title}</h3>
      </div>
      <table className="num mt-3 w-full text-[12px]">
        <tbody>
          {metrics.map(([k, b, a]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1 text-ink-3">{k}</td>
              <td className="py-1 text-end text-ink-3">{b}</td>
              <td className="px-1 text-ink-3">→</td>
              <td className="py-1 text-end font-semibold">{a}</td>
            </tr>
          ))}
          <tr className="border-t border-line"><td className="py-1 text-ink-3">Cost proxy</td><td /><td /><td className="py-1 text-end">{fmt(s.cost_proxy, 1)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{option.rationale}</p>
      <p className="mt-1 truncate text-[10px] text-ink-3" title={option.sources.map((x) => `${x.tool}:${x.run_id}`).join(", ")}>
        Sources: {option.sources.map((x) => `${x.tool} ${x.run_id}`).join(" · ")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => onDecide("approve")} disabled={busy} aria-pressed={decision === "approve"}
          className={`min-h-12 rounded-xl text-[14px] font-semibold ${decision === "approve" ? "bg-ok text-white" : "border border-ok/40 text-ok hover:bg-ok/10"}`}>
          {decision === "approve" ? "Approved ✓" : "Approve"}
        </button>
        <button onClick={() => onDecide("reject")} disabled={busy} aria-pressed={decision === "reject"}
          className={`min-h-12 rounded-xl text-[14px] font-semibold ${decision === "reject" ? "bg-ink-3 text-white" : "border border-line text-ink-2 hover:bg-muted"}`}>
          {decision === "reject" ? "Rejected" : "Reject"}
        </button>
      </div>
    </article>
  );
}

function Scoreboard({ before, after, source }: { before: SimSummary; after: SimSummary; source: string }) {
  const rows: [string, number, number, (n: number) => string][] = [
    ["Over-capacity station-hours", before.overcap_station_hours, after.overcap_station_hours, (n) => fmt(n, 2)],
    ["Passengers above comfort", before.excess_pax, after.excess_pax, (n) => fmt(n)],
    ["Peak load", before.peak_lf, after.peak_lf, pct],
    ["Longest platform wait (min)", before.max_wait_min, after.max_wait_min, (n) => fmt(n, 1)],
    ["Cost proxy", before.cost_proxy, after.cost_proxy, (n) => fmt(n, 1)],
  ];
  return (
    <section className="glass p-4" aria-label="Before and after the approved plan">
      <h3 className="label mb-2">Before → after approved plan (simulated)</h3>
      <table className="num w-full text-[13px]">
        <tbody>
          {rows.map(([k, b, a, f]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5 text-ink-2">{k}</td>
              <td className="py-1.5 text-end text-ink-3">{f(b)}</td>
              <td className="px-1 text-ink-3">→</td>
              <td className={`py-1.5 text-end font-semibold ${k !== "Cost proxy" && a < b ? "text-ok" : ""}`}>{f(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 truncate text-[10px] text-ink-3">Source: simulate {source}</p>
    </section>
  );
}

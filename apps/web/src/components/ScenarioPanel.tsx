"use client";
// Scenario controls (event, attendance what-if, end time). Floats over the map on the Live twin tab.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTwinCtx } from "@/lib/twinContext";
import { useFmt, useNames } from "@/lib/i18n";

const END_TIMES = ["16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];

export default function ScenarioPanel() {
  const t = useTranslations("rail");
  const { fmt } = useFmt();
  const names = useNames();
  const { twin } = useTwinCtx();
  const { events, event, scenario, setScenario } = twin;
  const attendance = scenario.attendance ?? event?.attendance ?? 0;
  const end = scenario.endTime ?? event?.end ?? "18:00";
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} aria-expanded={false}
        className="glass inline-flex min-h-11 items-center gap-2 px-4 text-[13px] font-medium text-ink">
        <SlidersHorizontal className="h-4 w-4 text-accent" aria-hidden /> {t("scenario")}
        {event && <span className="max-w-[180px] truncate text-ink-3">· {names.event(event)}</span>}
      </button>
    );
  }
  return (
    <div className="glass flex w-[300px] flex-col gap-4 p-4">
      <section data-tour="scenario">
        <div className="mb-2 flex items-center">
          <h2 className="label">{t("scenario")}</h2>
          <div className="flex-1" />
          <button onClick={() => setOpen(false)} aria-expanded={true} aria-label={t("scenario")}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-muted"><ChevronDown className="h-4 w-4 rotate-180" /></button>
        </div>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t("scenarioGroup")}>
          {events.map((ev) => {
            const active = ev.id === scenario.eventId;
            return (
              <button key={ev.id} role="radio" aria-checked={active}
                aria-label={`${names.event(ev)}, ${names.venue(ev)}, ${ev.start}–${ev.end}`}
                onClick={() => setScenario({ eventId: ev.id, attendance: null, endTime: null })}
                className={`min-h-12 rounded-xl border px-3 py-2 text-start text-[13px] leading-snug transition ${active
                  ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface/80 text-ink-2 hover:bg-muted"}`}>
                <span className="block font-medium">{names.event(ev)}</span>
                <span className="block text-[11px] text-ink-3">{names.venue(ev)} · <span className="num" dir="ltr">{ev.start}–{ev.end}</span></span>
              </button>
            );
          })}
          <button role="radio" aria-checked={scenario.eventId === null}
            onClick={() => setScenario({ eventId: null, attendance: null, endTime: null })}
            className={`min-h-11 rounded-xl border px-3 py-2 text-start text-[12px] ${scenario.eventId === null
              ? "border-accent bg-accent-soft" : "border-line bg-surface/80 text-ink-2 hover:bg-muted"}`}>
            {t("noEvent")}
          </button>
        </div>
      </section>

      {event && (
        <section>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="label">{t("attendance")}</h2>
            {event.is_assumption && <span className="badge-assumption rounded-full px-2 py-0.5 text-[11px] font-medium">{t("assumption")}</span>}
          </div>
          <p className="num text-[22px] font-semibold">{fmt(attendance)}</p>
          <input type="range" min={5000} max={100000} step={2500} value={attendance} aria-label={t("attendance")}
            aria-valuetext={fmt(attendance)} onChange={(e) => setScenario({ ...scenario, attendance: Number(e.target.value) })}
            className="mt-1 w-full" />
          <div className="num flex justify-between text-[11px] text-ink-3"><span>{fmt(5000)}</span><span>{fmt(100000)}</span></div>
          {scenario.attendance !== null && (
            <button className="mt-1 min-h-8 text-[12px] text-accent underline-offset-2 hover:underline"
              onClick={() => setScenario({ ...scenario, attendance: null })}>
              {t("resetTo", { value: fmt(event.attendance), kind: event.is_assumption ? "assumed" : "sourced" })}
            </button>
          )}
          <div className="mt-3 flex items-center gap-2">
            <h2 className="label">{t("ends")}</h2>
            <select value={end} aria-label={t("ends")} dir="ltr"
              onChange={(e) => setScenario({ ...scenario, endTime: e.target.value === event.end ? null : e.target.value })}
              className="min-h-10 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px]">
              {[...new Set([event.end, ...END_TIMES])].sort().map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </section>
      )}
    </div>
  );
}

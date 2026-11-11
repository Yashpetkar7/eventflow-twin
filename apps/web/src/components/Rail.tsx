"use client";
import { useTranslations } from "next-intl";
import type { Twin } from "@/lib/useTwin";
import { useFmt, useNames } from "@/lib/i18n";

const END_TIMES = ["16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];

export default function Rail({ twin }: { twin: Twin }) {
  const t = useTranslations("rail");
  const { fmt } = useFmt();
  const names = useNames();
  const { events, event, scenario, setScenario, forecast } = twin;
  const attendance = scenario.attendance ?? event?.attendance ?? 0;
  const end = scenario.endTime ?? event?.end ?? "18:00";

  return (
    <aside className="flex min-h-0 w-full flex-col gap-6 overflow-y-auto border-e border-line bg-surface/60 p-5">
      <section data-tour="scenario">
        <h2 className="label mb-2">{t("scenario")}</h2>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("scenarioGroup")}>
          {events.map((ev) => {
            const active = ev.id === scenario.eventId;
            return (
              <button key={ev.id} role="radio" aria-checked={active}
                aria-label={`${names.event(ev)}, ${names.venue(ev)}, ${ev.start}–${ev.end}`}
                onClick={() => setScenario({ eventId: ev.id, attendance: null, endTime: null })}
                className={`min-h-12 rounded-xl border px-3 py-2.5 text-start text-[14px] leading-snug transition ${active
                  ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface text-ink-2 hover:bg-muted"}`}>
                <span className="block font-medium">{names.event(ev)}</span>
                <span className="block text-[12px] text-ink-3">{names.venue(ev)} · <span className="num" dir="ltr">{ev.start}–{ev.end}</span></span>
              </button>
            );
          })}
          <button role="radio" aria-checked={scenario.eventId === null}
            onClick={() => setScenario({ eventId: null, attendance: null, endTime: null })}
            className={`min-h-12 rounded-xl border px-3 py-2 text-start text-[13px] ${scenario.eventId === null
              ? "border-accent bg-accent-soft" : "border-line bg-surface text-ink-2 hover:bg-muted"}`}>
            {t("noEvent")}
          </button>
        </div>
      </section>

      {event && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="label">{t("attendance")}</h2>
            {event.is_assumption && <span className="badge-assumption rounded-full px-2 py-0.5 text-[11px] font-medium">{t("assumption")}</span>}
          </div>
          <p className="num text-[22px] font-semibold">{fmt(attendance)}</p>
          <input type="range" min={5000} max={100000} step={2500} value={attendance} aria-label={t("attendance")}
            aria-valuetext={fmt(attendance)}
            onChange={(e) => setScenario({ ...scenario, attendance: Number(e.target.value) })}
            className="mt-2 w-full" />
          <div className="num mt-1 flex justify-between text-[11px] text-ink-3"><span>{fmt(5000)}</span><span>{fmt(100000)}</span></div>
          {scenario.attendance !== null && (
            <button className="mt-2 min-h-8 text-[12px] text-accent underline-offset-2 hover:underline"
              onClick={() => setScenario({ ...scenario, attendance: null })}>
              {t("resetTo", { value: fmt(event.attendance), kind: event.is_assumption ? "assumed" : "sourced" })}
            </button>
          )}
          {names.note(event) && <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{names.note(event)}</p>}
        </section>
      )}

      {event && (
        <section>
          <h2 className="label mb-2">{t("ends")}</h2>
          <select value={end} aria-label={t("ends")} dir="ltr"
            onChange={(e) => setScenario({ ...scenario, endTime: e.target.value === event.end ? null : e.target.value })}
            className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[14px]">
            {[...new Set([event.end, ...END_TIMES])].sort().map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </section>
      )}

      <section className="mt-auto space-y-2 text-[12px] leading-relaxed text-ink-3">
        <p>{t("capacityNote")}</p>
        {forecast && <p>{t("modelNote", { model: forecast.model })}</p>}
        <p>{t("comfortNote")}</p>
      </section>
    </aside>
  );
}

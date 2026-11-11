"use client";
import type { Twin } from "@/lib/useTwin";
import { fmt } from "@/lib/load";

const END_TIMES = ["16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];

export default function Rail({ twin }: { twin: Twin }) {
  const { events, event, scenario, setScenario, forecast } = twin;
  const attendance = scenario.attendance ?? event?.attendance ?? 0;
  const end = scenario.endTime ?? event?.end ?? "18:00";

  return (
    <aside className="flex min-h-0 flex-col gap-6 overflow-y-auto border-e border-line bg-surface/60 p-5">
      <section>
        <h2 className="label mb-2">Scenario</h2>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Event scenario">
          {events.map((ev) => {
            const active = ev.id === scenario.eventId;
            return (
              <button key={ev.id} role="radio" aria-checked={active} aria-label={`${ev.name}, ${ev.venue}, ${ev.start} to ${ev.end}`}
                onClick={() => setScenario({ eventId: ev.id, attendance: null, endTime: null })}
                className={`rounded-xl border px-3 py-2.5 text-start text-[14px] leading-snug transition ${active
                  ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface text-ink-2 hover:bg-muted"}`}>
                <span className="block font-medium">{ev.name}</span>
                <span className="block text-[12px] text-ink-3">{ev.venue} · {ev.start}–{ev.end}</span>
              </button>
            );
          })}
          <button role="radio" aria-checked={scenario.eventId === null}
            onClick={() => setScenario({ eventId: null, attendance: null, endTime: null })}
            className={`rounded-xl border px-3 py-2 text-start text-[13px] ${scenario.eventId === null
              ? "border-accent bg-accent-soft" : "border-line bg-surface text-ink-2 hover:bg-muted"}`}>
            Normal weekday (no event)
          </button>
        </div>
      </section>

      {event && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="label">Attendance per day</h2>
            {event.is_assumption && <span className="badge-assumption rounded-full px-2 py-0.5 text-[11px] font-medium">assumption</span>}
          </div>
          <p className="num text-[22px] font-semibold">{fmt(attendance)}</p>
          <input type="range" min={5000} max={100000} step={2500} value={attendance} aria-label="Attendance per day"
            onChange={(e) => setScenario({ ...scenario, attendance: Number(e.target.value) })}
            className="mt-2 w-full" />
          <div className="mt-1 flex justify-between text-[11px] text-ink-3"><span>5,000</span><span>100,000</span></div>
          {scenario.attendance !== null && (
            <button className="mt-2 text-[12px] text-accent underline-offset-2 hover:underline"
              onClick={() => setScenario({ ...scenario, attendance: null })}>
              Reset to {fmt(event.attendance)} ({event.is_assumption ? "scenario value" : "sourced"})
            </button>
          )}
          {event.note && <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{event.note}</p>}
        </section>
      )}

      {event && (
        <section>
          <h2 className="label mb-2">Event ends</h2>
          <select value={end} aria-label="Event end time"
            onChange={(e) => setScenario({ ...scenario, endTime: e.target.value === event.end ? null : e.target.value })}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-[14px]">
            {[...new Set([event.end, ...END_TIMES])].sort().map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </section>
      )}

      <section className="mt-auto space-y-2 text-[12px] leading-relaxed text-ink-3">
        <p>Capacity: official RTA GTFS timetable (2021), per direction.</p>
        {forecast && <p>Forecast model: {forecast.model}</p>}
        <p>Comfort threshold: 85% of practical boarding capacity.</p>
      </section>
    </aside>
  );
}

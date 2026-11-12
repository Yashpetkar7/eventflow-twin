"use client";
import { useTranslations } from "next-intl";
import { CalendarDays, Clock, MapPin, Play, Users } from "lucide-react";
import { useTwinCtx } from "@/lib/twinContext";
import { useFmt, useNames } from "@/lib/i18n";
import { Badge, Card, PageHeader } from "../ui";

export default function EventsPage({ go }: { go: (tab: "twin") => void }) {
  const t = useTranslations("events");
  const tn = useTranslations("nav");
  const tp = useTranslations("page");
  const { fmt } = useFmt();
  const names = useNames();
  const { twin } = useTwinCtx();
  const { events, scenario, setScenario } = twin;
  const run = (eventId: string | null) => { setScenario({ eventId, attendance: null, endTime: null }); go("twin"); };

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader title={tn("events")} sub={tp("eventsSub")} />
      <div className="grid gap-4 lg:grid-cols-2">
        {events.map((ev) => {
          const active = ev.id === scenario.eventId;
          return (
            <Card key={ev.id} className={active ? "ring-2 ring-accent/50" : ""}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h2 className="text-[17px] font-semibold leading-snug">{names.event(ev)}</h2>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={ev.is_assumption ? "neutral" : "ok"}>{ev.is_assumption ? t("assumed") : t("sourced")}</Badge>
                  </div>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
                <Fact icon={MapPin} label={t("venue")} value={names.venue(ev)} />
                <Fact icon={CalendarDays} label={t("date")} value={<span className="num" dir="ltr">{ev.date}</span>} />
                <Fact icon={Clock} label={t("hours")} value={<span className="num" dir="ltr">{ev.start}–{ev.end}</span>} />
                <Fact icon={Users} label={t("attendance")} value={<span className="num">{fmt(ev.attendance)}</span>} />
              </dl>
              {names.note(ev) && <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{names.note(ev)}</p>}
              {!!ev.sources?.length && (
                <details className="mt-3 text-[12px]">
                  <summary className="cursor-pointer text-ink-2">{t("sources")} ({ev.sources.length})</summary>
                  <ul className="mt-1 space-y-0.5">{ev.sources.map((s) => <li key={s} className="break-all text-accent" dir="ltr">{s}</li>)}</ul>
                </details>
              )}
              <button onClick={() => run(ev.id)}
                className={`mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold ${active ? "bg-accent-soft text-accent" : "bg-accent text-white hover:brightness-110"}`}>
                <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> {active ? t("running") : t("run")}
              </button>
            </Card>
          );
        })}
        <Card className={scenario.eventId === null ? "ring-2 ring-accent/50" : ""}>
          <h2 className="text-[17px] font-semibold">{t("baseline")}</h2>
          <p className="mt-2 text-[13px] text-ink-2">{t("baselineText")}</p>
          <button onClick={() => run(null)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-[14px] font-semibold text-ink-2 hover:bg-muted">
            <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> {scenario.eventId === null ? t("running") : t("run")}
          </button>
        </Card>
        <div className="grid place-items-center rounded-[var(--radius-card)] border border-dashed border-line p-6 text-center text-[13px] text-ink-3">
          {t("soon")}
        </div>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
      <div><dt className="text-[11px] text-ink-3">{label}</dt><dd className="font-medium text-ink">{value}</dd></div>
    </div>
  );
}

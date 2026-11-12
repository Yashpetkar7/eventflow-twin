"use client";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Activity, Clock, Gauge, Users } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useShownSim, useTwinCtx } from "@/lib/twinContext";
import { useEvidence } from "@/lib/useEvidence";
import { useFmt, useLocaleSwitch, useNames } from "@/lib/i18n";
import { stationDays } from "@/lib/stats";
import { COMFORT, band } from "@/lib/load";
import { Badge, Card, KpiCard, LineChip, PageHeader } from "../ui";

const BAND_TEXT = { ok: "text-ok", warn: "text-warn", risk: "text-risk" } as const;

export default function OverviewPage({ go }: { go: (tab: "twin" | "events" | "stations") => void }) {
  const t = useTranslations("overview");
  const tn = useTranslations("nav");
  const tp = useTranslations("page");
  const tl = useTranslations("lineName");
  const tr = useTranslations("rail");
  const tst = useTranslations("strip");
  const { fmt, pct, hh } = useFmt();
  const names = useNames();
  const { locale } = useLocaleSwitch();
  const rtl = locale === "ar";
  const { twin, hour, setHour, setStationId } = useTwinCtx();
  const sim = useShownSim();
  const { evidence } = useEvidence([twin.scenario.eventId]);
  const { event, stations, forecast } = twin;

  const days = useMemo(() => stationDays(sim, stations, forecast), [sim, stations, forecast]);
  const worst = useMemo(() => (sim?.hourly.length ? sim.hourly.reduce((a, b) => (b.peak_lf > a.peak_lf ? b : a)) : null), [sim]);
  const worstStation = stations.find((s) => s.id === worst?.station_id);
  const hotspots = useMemo(() => [...(sim?.hourly ?? [])].sort((a, b) => b.peak_lf - a.peak_lf).slice(0, 8), [sim]);
  const curve = useMemo(() => {
    const by = new Map<number, { demand: number; capacity: number }>();
    for (const r of sim?.hourly ?? []) {
      const c = by.get(r.hour) ?? { demand: 0, capacity: 0 };
      c.demand += r.demand; c.capacity += r.capacity * COMFORT; by.set(r.hour, c);
    }
    return Array.from({ length: 19 }, (_, i) => i + 5).map((h) => ({ hour: h, demand: Math.round(by.get(h)?.demand ?? 0), capacity: Math.round(by.get(h)?.capacity ?? 0) }));
  }, [sim]);
  const byLine = useMemo(() => {
    const out = new Map<string, { lf: number; station: string }>();
    for (const r of sim?.hourly ?? []) {
      if (r.hour !== hour) continue;
      for (const l of stations.find((s) => s.id === r.station_id)?.lines ?? []) {
        if ((out.get(l)?.lf ?? -1) < r.peak_lf) out.set(l, { lf: r.peak_lf, station: r.station_id });
      }
    }
    return ["Red", "Green", "Branch"].filter((l) => out.has(l)).map((l) => ({ line: l, ...out.get(l)! }));
  }, [sim, hour, stations]);
  const breakAt = event ? evidence?.eval.sensitivity?.metrics[`break_attendance_default__${event.id}`] : undefined;
  const served = days.filter((d) => d.served);
  const s = sim?.summary;

  const openAt = (stationId: string, h: number) => { setStationId(stationId); setHour(h); go("twin"); };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader title={tn("overview")} sub={tp("overviewSub")} actions={
        <button onClick={() => go("twin")} className="min-h-10 rounded-full bg-accent px-4 text-[13px] font-semibold text-white shadow-sm hover:brightness-110">
          {t("openTwin")} →
        </button>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Gauge} label={t("peakLoad")} tone={worst ? (band(worst.peak_lf) === "risk" ? "risk" : band(worst.peak_lf) === "warn" ? "warn" : "ok") : "neutral"}
          value={worst ? pct(worst.peak_lf) : "—"}
          sub={worst ? t("peakAt", { station: names.station(worstStation), hour: hh(worst.hour) }) : undefined} />
        <KpiCard icon={Activity} label={t("overcap")} tone={(s?.overcap_station_hours ?? 0) > 0 ? "risk" : "ok"}
          value={s ? fmt(s.overcap_station_hours, 2) : "—"} sub={t("overcapHint")} />
        <KpiCard icon={Clock} label={t("wait")} tone={(s?.max_wait_min ?? 0) > 0 ? "warn" : "ok"}
          value={s ? fmt(s.max_wait_min, 1) : "—"} unit={t("waitUnit")} sub={t("waitHint")} />
        <KpiCard icon={Users} label={t("breakPoint")} value={breakAt ? fmt(breakAt) : t("noBreak")} sub={t("breakHint")} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title={t("dayCurve")}>
          <div className="h-64" role="img" aria-label={t("dayCurve")}>
            <ResponsiveContainer>
              <ComposedChart data={curve} margin={{ top: 6, right: rtl ? -6 : 8, bottom: 0, left: rtl ? 8 : -6 }}>
                <CartesianGrid stroke="rgba(27,31,42,0.06)" vertical={false} />
                <XAxis dataKey="hour" reversed={rtl} tickFormatter={(h) => String(h).padStart(2, "0")} tick={{ fontSize: 11 }} />
                <YAxis orientation={rtl ? "right" : "left"} tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => fmt(Number(v))} />
                <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(h) => hh(Number(h))} />
                <Area dataKey="demand" name={t("demand")} stroke="#1D4ED8" fill="#1D4ED8" fillOpacity={0.14} strokeWidth={2} isAnimationActive={false} />
                <Line dataKey="capacity" name={t("capacity")} stroke="#B4454F" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                <ReferenceLine x={hour} stroke="#8A8F9C" strokeDasharray="2 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title={t("scenario")} action={<button onClick={() => go("events")} className="text-[12px] font-medium text-accent hover:underline">{tn("events")} →</button>}>
          {event ? (
            <div className="space-y-2">
              <p className="text-[15px] font-semibold leading-snug">{names.event(event)}</p>
              <p className="text-[13px] text-ink-2">{names.venue(event)} · <span className="num" dir="ltr">{event.date} · {event.start}–{event.end}</span></p>
              <p className="num text-[13px] text-ink-2">{t("attendance", { value: fmt(twin.forecast?.attendance_used ?? event.attendance) })}
                {" "}{event.is_assumption && <Badge>{tr("assumption")}</Badge>}</p>
              <div className="pt-1">
                <p className="label mb-1">{t("served")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {served.map((d) => (
                    <button key={d.station.id} onClick={() => openAt(d.station.id, d.peakHour)}
                      className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-muted">
                      {names.station(d.station)} <span className={`num font-semibold ${BAND_TEXT[band(d.peakLf)]}`}>{pct(d.peakLf)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : <p className="text-[13px] text-ink-2">{t("noEvent")}</p>}
          <div className="mt-4 border-t border-line pt-3">
            <p className="label mb-1">{t("assumptions")}</p>
            <ul className="space-y-0.5 text-[12px] text-ink-2"><li>{t("a1")}</li><li>{t("a2")}</li><li>{t("a3")}</li></ul>
            {twin.forecast?.is_synthetic && <p className="mt-2 text-[12px] text-ink-3">{t("synthetic")}</p>}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title={t("hotspots")} action={<button onClick={() => go("stations")} className="text-[12px] font-medium text-accent hover:underline">{tn("stations")} →</button>}>
          <ul className="divide-y divide-line">
            {hotspots.map((r) => {
              const st = stations.find((x) => x.id === r.station_id);
              return (
                <li key={`${r.station_id}-${r.hour}`}>
                  <button onClick={() => openAt(r.station_id, r.hour)} className="flex min-h-11 w-full items-center gap-3 py-2 text-start hover:bg-muted/60">
                    <span className="num w-14 text-[13px] text-ink-3">{hh(r.hour)}</span>
                    <span className="flex-1 truncate text-[14px] font-medium">{names.station(st)}</span>
                    <span className="hidden gap-1 sm:flex">{st?.lines?.map((l) => <LineChip key={l} line={l} />)}</span>
                    <span className="h-2 w-28 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className={`block h-full rounded-full ${band(r.peak_lf) === "risk" ? "bg-risk" : band(r.peak_lf) === "warn" ? "bg-warn" : "bg-ok"}`}
                        style={{ width: `${Math.min(100, r.peak_lf * 100)}%` }} />
                    </span>
                    <span className={`num w-14 text-end text-[14px] font-semibold ${BAND_TEXT[band(r.peak_lf)]}`}>{pct(r.peak_lf)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title={t("byLine", { hour: hh(hour) })}>
          <ul className="space-y-3">
            {byLine.map((l) => (
              <li key={l.line}>
                <div className="flex items-center gap-2 text-[13px]">
                  <LineChip line={l.line} />
                  <span className="truncate text-ink-3">{names.station(stations.find((x) => x.id === l.station))}</span>
                  <span className="flex-1" />
                  <span className={`num font-semibold ${BAND_TEXT[band(l.lf)]}`}>{pct(l.lf)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${tl(l.line as "Red")} ${pct(l.lf)}`}>
                  <div className={`h-full rounded-full ${band(l.lf) === "risk" ? "bg-risk" : band(l.lf) === "warn" ? "bg-warn" : "bg-ok"}`}
                    style={{ width: `${Math.min(100, l.lf * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <input type="range" min={5} max={23} value={hour} onChange={(e) => setHour(Number(e.target.value))}
            aria-label={tst("hourAria")} className="mt-4 w-full" />
        </Card>
      </div>
    </div>
  );
}

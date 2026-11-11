"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { PlannerText } from "@/lib/previewPlanner";
import { useTwin } from "@/lib/useTwin";
import { useFmt, useLocaleSwitch, useNames } from "@/lib/i18n";
import { isKiosk, lockDown } from "@/lib/kiosk";
import Rail from "./Rail";
import HeatStrip from "./HeatStrip";
import Inspector from "./Inspector";
import EvidenceDrawer from "./EvidenceDrawer";
import TableView from "./TableView";
import KioskLayer, { type KioskMode } from "./KioskLayer";

// deck.gl needs the browser (WebGL): load it client-side only.
const CorridorMap = dynamic(() => import("./CorridorMap"), { ssr: false });

export type View = "before" | "after";

function usePlannerText(): PlannerText {
  const tp = useTranslations("planner");
  const { fmt, pct } = useFmt();
  const names = useNames();
  return useMemo<PlannerText>(() => ({
    title: (l, stations) => {
      const n = (id: string) => names.station(stations.find((s) => s.id === id));
      switch (l.kind) {
        case "trains": return tp("trains");
        case "robotaxi": return tp("robotaxi", { station: n(l.station) });
        case "walk": return tp("walk", { from: n(l.from), to: n(l.to) });
        case "shuttle": return tp("shuttle", { from: n(l.from), to: n(l.to) });
        case "stagger": return tp("stagger");
      }
    },
    rationale: (title, b, s) => tp("rationale", {
      title, ob: fmt(b.overcap_station_hours, 2), oa: fmt(s.overcap_station_hours, 2), eb: fmt(b.excess_pax),
      ea: fmt(s.excess_pax), pb: pct(b.peak_lf), pa: pct(s.peak_lf), wb: fmt(b.max_wait_min, 1),
      wa: fmt(s.max_wait_min, 1), cost: fmt(s.cost_proxy, 1),
    }),
  }), [tp, fmt, pct, names]);
}

export default function Workspace() {
  const t = useTranslations("app");
  const { locale, setLocale } = useLocaleSwitch();
  const { hh } = useFmt();
  const names = useNames();
  const plannerText = usePlannerText();
  const twin = useTwin(plannerText, locale);
  const { baseline, after, stations, event, events, forecast, setScenario } = twin;

  const [kiosk] = useState(isKiosk);
  const [kioskMode, setKioskMode] = useState<KioskMode>(kiosk ? "attract" : "live");
  const [hour, setHour] = useState(17);
  const [stationId, setStationId] = useState<string | null>(null);
  const [view, setView] = useState<View>("before");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  useEffect(() => (kiosk ? lockDown() : undefined), [kiosk]);

  // Adjust state while rendering when new results arrive (https://react.dev/learn/you-might-not-need-an-effect):
  // jump to the worst station-hour for a new baseline, and show "after" when a new approved plan is simulated.
  const [seenBase, setSeenBase] = useState<string | null>(null);
  if (baseline && baseline.run_id !== seenBase && baseline.hourly.length) {
    const worst = baseline.hourly.reduce((a, b) => (b.peak_lf > a.peak_lf ? b : a));
    setSeenBase(baseline.run_id);
    if (kioskMode !== "attract") setHour(worst.hour);   // autoplay keeps scrubbing from the start of the day
    setStationId(worst.station_id);
    setView("before");
  }
  const [seenAfter, setSeenAfter] = useState<string | null>(null);
  if ((after?.run_id ?? null) !== seenAfter) {
    setSeenAfter(after?.run_id ?? null);
    setView(after ? "after" : "before");
  }

  // Kiosk autoplay: scrub the day; at the end of each day, move to the next scenario.
  const scenarioId = twin.scenario.eventId;
  const tick = useCallback(() => {
    setHour((h) => (h < 22 ? h + 1 : 7));
    if (hour >= 22) {
      const i = events.findIndex((e) => e.id === scenarioId);
      const next = events[(i + 1) % Math.max(1, events.length)];
      if (next) setScenario({ eventId: next.id, attendance: null, endTime: null });
    }
  }, [hour, events, scenarioId, setScenario]);
  const resetForNextVisitor = useCallback(() => {
    setScenario({ eventId: events[0]?.id ?? null, attendance: null, endTime: null });
    setTableOpen(false);
    setEvidenceOpen(false);
  }, [events, setScenario]);

  const shown = view === "after" && after ? after : baseline;
  const synthetic = !!(forecast?.is_synthetic || baseline?.is_synthetic);
  const station = useMemo(() => stations.find((s) => s.id === stationId) ?? null, [stations, stationId]);
  const scale = kiosk ? "kiosk-scale" : "";

  return (
    <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
      <header className={`flex min-h-14 items-center gap-3 border-b border-line bg-surface/80 px-5 py-2 backdrop-blur ${scale}`}>
        <h1 className="text-[19px] font-semibold tracking-tight" dir="ltr">EventFlow <span className="text-accent">Twin</span></h1>
        {event && (
          <span className="rounded-full bg-accent-soft px-3 py-1 text-[13px] font-medium text-accent">
            {names.event(event)} · <span className="num">{hh(hour)}</span>
          </span>
        )}
        {!kiosk && <span className="hidden text-[12px] text-ink-3 xl:inline">{t("tagline")}</span>}
        <div className="flex-1" />
        {synthetic && (
          <span className="badge-synthetic rounded-full px-3 py-1 text-[12px] font-semibold tracking-wide" title={t("syntheticHint")}>
            {t("synthetic")}
          </span>
        )}
        <button onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label={t("languageLabel")}
          lang={locale === "ar" ? "en" : "ar"}
          className="min-h-10 rounded-full border border-line bg-surface px-4 text-[14px] font-medium hover:bg-muted">
          {t("language")}
        </button>
        {!kiosk && (
          <button onClick={() => setTableOpen((v) => !v)} aria-pressed={tableOpen}
            className="min-h-10 rounded-full border border-line bg-surface px-3 text-[13px] hover:bg-muted">
            {tableOpen ? t("mapView") : t("tableView")}
          </button>
        )}
        <button onClick={() => setEvidenceOpen(true)}
          className="min-h-10 rounded-full border border-line bg-surface px-3 text-[13px] hover:bg-muted">
          {t("evidence")}
        </button>
      </header>

      <div className="grid min-h-0 grid-cols-[auto_1fr_auto]">
        <div className={`flex min-h-0 w-[280px] ${scale}`}><Rail twin={twin} /></div>

        <main className="relative grid min-h-0 grid-rows-[1fr_auto] bg-bg">
          {twin.error && (
            <div role="alert" className="absolute inset-x-6 top-4 z-20 rounded-xl border border-risk/30 bg-surface p-4 text-sm text-risk shadow">
              {twin.error}
            </div>
          )}
          {tableOpen ? (
            <TableView forecast={forecast} sim={shown} stations={stations} />
          ) : (
            <div className="relative min-h-0" data-map>
              <CorridorMap sim={shown} stations={stations} event={event} hour={hour}
                selected={stationId} onSelect={setStationId} orbit={kiosk && kioskMode === "attract"} />
              {after && (
                <div className={`absolute start-4 top-4 z-10 flex rounded-full border border-line bg-surface p-1 text-[13px] shadow-sm ${scale}`}
                  role="group" aria-label={t("compare")}>
                  {(["before", "after"] as const).map((v) => (
                    <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                      className={`min-h-9 rounded-full px-3 ${view === v ? "bg-accent text-white" : "text-ink-2"}`}>
                      {v === "before" ? t("before") : t("after")}
                    </button>
                  ))}
                </div>
              )}
              {twin.loading && (
                <div className="absolute end-4 top-4 z-10 rounded-full bg-surface px-3 py-1 text-[12px] text-ink-3 shadow-sm">
                  {t("updating")}
                </div>
              )}
            </div>
          )}
          <div className={scale} data-tour="timeline">
            <HeatStrip sim={shown} stations={stations} hour={hour} onHour={setHour}
              selected={stationId} onSelect={setStationId} view={after ? view : null} kiosk={kiosk} />
          </div>
        </main>

        <div className={`flex min-h-0 w-[380px] ${scale}`}><Inspector twin={twin} station={station} hour={hour} view={view} plannerText={plannerText} /></div>
      </div>

      <EvidenceDrawer open={evidenceOpen} onClose={() => setEvidenceOpen(false)} forecast={forecast} event={event}
        events={events} decisionsVersion={Object.keys(twin.decisions).length} />
      {kiosk && <KioskLayer mode={kioskMode} setMode={setKioskMode} onTick={tick} onReset={resetForNextVisitor} />}
    </div>
  );
}

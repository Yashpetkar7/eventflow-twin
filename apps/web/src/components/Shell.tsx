"use client";
// App frame: sidebar navigation (one page per job, like the LuLu dashboard), header, and the active tab.
// The tab lives in the URL (?tab=stations) so links and the browser back button work. Kiosk mode shows only the
// Live twin with the booth layer on top.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, ClipboardCheck, LayoutDashboard, Map as MapIcon, PanelLeftClose, PanelLeftOpen, ShieldCheck, Sparkles, TrainFront,
  type LucideIcon } from "lucide-react";
import { useTwinCtx } from "@/lib/twinContext";
import { useFmt, useLocaleSwitch, useNames } from "@/lib/i18n";
import KioskLayer, { type KioskMode } from "./KioskLayer";
import TwinPage from "./pages/TwinPage";
import OverviewPage from "./pages/OverviewPage";
import EventsPage from "./pages/EventsPage";
import StationsPage from "./pages/StationsPage";
import PlannerPage from "./pages/PlannerPage";
import EvidencePage from "./pages/EvidencePage";
import DecisionsPage from "./pages/DecisionsPage";

export const TABS = ["overview", "twin", "events", "stations", "planner", "evidence", "decisions"] as const;
export type Tab = (typeof TABS)[number];
const ICONS: Record<Tab, LucideIcon> = {
  overview: LayoutDashboard, twin: MapIcon, events: CalendarDays, stations: TrainFront, planner: Sparkles,
  evidence: ShieldCheck, decisions: ClipboardCheck,
};

function tabFromUrl(): Tab {
  const v = new URLSearchParams(window.location.search).get("tab");
  return (TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "overview";
}

export default function Shell({ kiosk, kioskMode, setKioskMode }: {
  kiosk: boolean; kioskMode: KioskMode; setKioskMode: (m: KioskMode) => void;
}) {
  const tn = useTranslations("nav");
  const ta = useTranslations("app");
  const tr = useTranslations("rail");
  const { locale, setLocale } = useLocaleSwitch();
  const { hh } = useFmt();
  const names = useNames();
  const { twin, hour, setHour } = useTwinCtx();
  const [tab, setTab] = useState<Tab>(() => (kiosk ? "twin" : tabFromUrl()));
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1280);   // laptops: give the map room

  const go = useCallback((next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState({ tab: next }, "", url);
    document.getElementById("content")?.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Kiosk autoplay: scrub the day; at the end of each day move to the next scenario. Idle → reset.
  const { events, scenario, setScenario } = twin;
  const tick = useCallback(() => {
    setHour((h) => (h < 22 ? h + 1 : 7));
    if (hour >= 22) {
      const i = events.findIndex((e) => e.id === scenario.eventId);
      const next = events[(i + 1) % Math.max(1, events.length)];
      if (next) setScenario({ eventId: next.id, attendance: null, endTime: null });
    }
  }, [hour, events, scenario.eventId, setScenario, setHour]);
  const reset = useCallback(() => setScenario({ eventId: events[0]?.id ?? null, attendance: null, endTime: null }), [events, setScenario]);

  const synthetic = !!(twin.forecast?.is_synthetic || twin.baseline?.is_synthetic);
  const lineCount = new Set(twin.stations.flatMap((s) => s.lines ?? [])).size;
  const scale = kiosk ? "kiosk-scale" : "";

  return (
    <div className="flex h-full overflow-hidden">
      {!kiosk && (
        <nav aria-label={tn("main")} className={`flex shrink-0 flex-col border-e border-line bg-surface transition-[width] ${collapsed ? "w-[68px]" : "w-[232px]"}`}>
          <div className="flex h-16 items-center gap-2 px-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-[13px] font-bold text-white" aria-hidden>EF</span>
            {!collapsed && <span className="text-[17px] font-semibold tracking-tight" dir="ltr">EventFlow <span className="text-accent">Twin</span></span>}
          </div>
          <ul className="flex flex-1 flex-col gap-1 px-3 py-2">
            {TABS.map((id) => {
              const Icon = ICONS[id];
              const active = id === tab;
              return (
                <li key={id}>
                  <button onClick={() => go(id)} aria-current={active ? "page" : undefined} title={collapsed ? tn(id) : undefined}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition ${active
                      ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-muted hover:text-ink"}`}>
                    <Icon className="h-5 w-5 shrink-0" aria-hidden />
                    {!collapsed && <span>{tn(id)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {!collapsed && (
            <div className="m-3 rounded-xl bg-muted/70 p-3 text-[11px] leading-relaxed text-ink-2">
              <p className="label mb-1">{tn("dataStatus")}</p>
              <p>{tn("network", { stations: twin.stations.length, lines: lineCount })}</p>
              <p>{tn("realCapacity")}</p>
              {synthetic && <p className="text-[#7A5A1E]">{tn("syntheticDemand")}</p>}
            </div>
          )}
          <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? tn("expand") : tn("collapse")}
            className="m-3 grid min-h-10 place-items-center rounded-xl text-ink-3 hover:bg-muted">
            {collapsed ? <PanelLeftOpen className="h-5 w-5 rtl:-scale-x-100" /> : <PanelLeftClose className="h-5 w-5 rtl:-scale-x-100" />}
          </button>
        </nav>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex min-h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/85 px-5 py-2 backdrop-blur ${scale}`}>
          {kiosk && <h1 className="text-[19px] font-semibold tracking-tight" dir="ltr">EventFlow <span className="text-accent">Twin</span></h1>}
          {twin.event ? (
            <span className="truncate rounded-full bg-accent-soft px-3 py-1 text-[13px] font-medium text-accent">
              {names.event(twin.event)} · <span className="num">{hh(hour)}</span>
            </span>
          ) : <span className="text-[13px] text-ink-3">{tr("noEvent")}</span>}
          {!kiosk && <span className="hidden text-[12px] text-ink-3 2xl:inline">{ta("tagline")}</span>}
          <div className="flex-1" />
          {synthetic && <span className="badge-synthetic shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold tracking-wide" title={ta("syntheticHint")}>{ta("synthetic")}</span>}
          <button onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label={ta("languageLabel")} lang={locale === "ar" ? "en" : "ar"}
            className="min-h-10 shrink-0 rounded-full border border-line bg-surface px-4 text-[14px] font-medium hover:bg-muted">
            {ta("language")}
          </button>
        </header>

        <div id="content" className={`min-h-0 flex-1 ${tab === "twin" ? "overflow-hidden" : "overflow-y-auto"}`}>
          {tab === "twin" && <TwinPage kiosk={kiosk} orbit={kiosk && kioskMode === "attract"} onShowAll={() => go("stations")} />}
          {tab === "overview" && <OverviewPage go={go} />}
          {tab === "events" && <EventsPage go={go} />}
          {tab === "stations" && <StationsPage />}
          {tab === "planner" && <PlannerPage />}
          {tab === "evidence" && <EvidencePage />}
          {tab === "decisions" && <DecisionsPage />}
        </div>
      </div>
      {kiosk && <KioskLayer mode={kioskMode} setMode={setKioskMode} onTick={tick} onReset={reset} />}
    </div>
  );
}

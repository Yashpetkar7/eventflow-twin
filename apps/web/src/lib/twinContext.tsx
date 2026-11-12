"use client";
// One shared twin for every tab: scenario, forecast, simulations, plan, decisions, and the UI selection
// (hour, station, before/after view). Pages read it with useTwinCtx().
import { createContext, useContext, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { PlannerText } from "./previewPlanner";
import { useTwin, type Twin } from "./useTwin";
import { useFmt, useLocaleSwitch, useNames } from "./i18n";

export type View = "before" | "after";

interface Ctx {
  twin: Twin;
  plannerText: PlannerText;
  hour: number;
  setHour: (h: number | ((h: number) => number)) => void;
  stationId: string | null;
  setStationId: (id: string | null) => void;
  view: View;
  setView: (v: View) => void;
}

const TwinCtx = createContext<Ctx | null>(null);

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

export function TwinProvider({ children, holdHour = false }: { children: React.ReactNode; holdHour?: boolean }) {
  const { locale } = useLocaleSwitch();
  const plannerText = usePlannerText();
  const twin = useTwin(plannerText, locale);
  const { baseline, after } = twin;
  const [hour, setHour] = useState(17);
  const [stationId, setStationId] = useState<string | null>(null);
  const [view, setView] = useState<View>("before");

  // Adjust state while rendering when new results arrive (https://react.dev/learn/you-might-not-need-an-effect):
  // jump to the worst station-hour for a new baseline; show "after" when a new approved plan is simulated.
  const [seenBase, setSeenBase] = useState<string | null>(null);
  if (baseline && baseline.run_id !== seenBase && baseline.hourly.length) {
    const worst = baseline.hourly.reduce((a, b) => (b.peak_lf > a.peak_lf ? b : a));
    setSeenBase(baseline.run_id);
    if (!holdHour) setHour(worst.hour);       // kiosk autoplay keeps scrubbing from the start of the day
    setStationId(worst.station_id);
    setView("before");
  }
  const [seenAfter, setSeenAfter] = useState<string | null>(null);
  if ((after?.run_id ?? null) !== seenAfter) {
    setSeenAfter(after?.run_id ?? null);
    setView(after ? "after" : "before");
  }

  const value = useMemo<Ctx>(() => ({ twin, plannerText, hour, setHour, stationId, setStationId, view, setView }),
    [twin, plannerText, hour, stationId, view]);
  return <TwinCtx.Provider value={value}>{children}</TwinCtx.Provider>;
}

export function useTwinCtx(): Ctx {
  const c = useContext(TwinCtx);
  if (!c) throw new Error("useTwinCtx outside TwinProvider");
  return c;
}

/** The simulation currently on screen (after the approved plan when that view is selected). */
export function useShownSim() {
  const { twin, view } = useTwinCtx();
  return view === "after" && twin.after ? twin.after : twin.baseline;
}

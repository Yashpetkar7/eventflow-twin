"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useShownSim, useTwinCtx } from "@/lib/twinContext";
import { relevantStations, stationDays } from "@/lib/stats";
import HeatStrip from "../HeatStrip";
import Inspector from "../Inspector";
import ScenarioPanel from "../ScenarioPanel";

// MapLibre + deck.gl need the browser (WebGL): client-only.
const DubaiMap = dynamic(() => import("../DubaiMap"), { ssr: false });

export default function TwinPage({ kiosk, orbit, onShowAll }: { kiosk: boolean; orbit: boolean; onShowAll: () => void }) {
  const t = useTranslations("app");
  const { twin, hour, stationId, setStationId, view, setView } = useTwinCtx();
  const sim = useShownSim();
  const scale = kiosk ? "kiosk-scale" : "";
  const days = useMemo(() => stationDays(twin.baseline, twin.stations, twin.forecast), [twin.baseline, twin.stations, twin.forecast]);
  const rows = useMemo(() => relevantStations(days, stationId, kiosk ? 6 : 8), [days, stationId, kiosk]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_auto]">
      <main className="relative grid min-h-0 grid-rows-[1fr_auto] bg-bg">
        {twin.error && (
          <div role="alert" className="absolute inset-x-6 top-4 z-20 rounded-xl border border-risk/30 bg-surface p-4 text-sm text-risk shadow">
            {twin.error}
          </div>
        )}
        <div className="relative min-h-0" data-map>
          <DubaiMap sim={sim} stations={twin.stations} event={twin.event} hour={hour} selected={stationId}
            onSelect={setStationId} orbit={orbit} />
          <div className={`absolute start-4 top-4 z-10 ${scale}`}><ScenarioPanel /></div>
          {twin.after && (
            <div className={`absolute top-4 z-10 flex rounded-full border border-line bg-surface p-1 text-[13px] shadow-sm ${scale}`}
              style={{ insetInlineStart: kiosk ? 440 : 332 }} role="group" aria-label={t("compare")}>
              {(["before", "after"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                  className={`min-h-9 rounded-full px-3 ${view === v ? "bg-accent text-white" : "text-ink-2"}`}>
                  {v === "before" ? t("before") : t("after")}
                </button>
              ))}
            </div>
          )}
          {twin.loading && (
            <div className="absolute bottom-20 end-4 z-10 rounded-full bg-surface px-3 py-1 text-[12px] text-ink-3 shadow-sm">{t("updating")}</div>
          )}
        </div>
        <div className={scale} data-tour="timeline">
          <HeatStrip rows={rows} total={twin.stations.length} kiosk={kiosk} onShowAll={onShowAll} />
        </div>
      </main>
      <div className={`flex min-h-0 w-[380px] ${scale}`}><Inspector /></div>
    </div>
  );
}

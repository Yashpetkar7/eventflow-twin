"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useTwin } from "@/lib/useTwin";
import { hh } from "@/lib/load";
import Rail from "./Rail";
import HeatStrip from "./HeatStrip";
import Inspector from "./Inspector";
import EvidenceDrawer from "./EvidenceDrawer";
import TableView from "./TableView";

// deck.gl needs the browser (WebGL): load it client-side only.
const CorridorMap = dynamic(() => import("./CorridorMap"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-3">Loading 3D corridor…</div>,
});

export type View = "before" | "after";

export default function Workspace() {
  const twin = useTwin();
  const { baseline, after, stations, event, forecast } = twin;
  const [hour, setHour] = useState(17);
  const [stationId, setStationId] = useState<string | null>(null);
  const [view, setView] = useState<View>("before");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  // Adjust state while rendering when new results arrive (https://react.dev/learn/you-might-not-need-an-effect):
  // jump to the worst station-hour for a new baseline, and show "after" when a new approved plan is simulated.
  const [seenBase, setSeenBase] = useState<string | null>(null);
  if (baseline && baseline.run_id !== seenBase && baseline.hourly.length) {
    const worst = baseline.hourly.reduce((a, b) => (b.peak_lf > a.peak_lf ? b : a));
    setSeenBase(baseline.run_id);
    setHour(worst.hour);
    setStationId(worst.station_id);
    setView("before");
  }
  const [seenAfter, setSeenAfter] = useState<string | null>(null);
  if ((after?.run_id ?? null) !== seenAfter) {
    setSeenAfter(after?.run_id ?? null);
    setView(after ? "after" : "before");
  }

  const shown = view === "after" && after ? after : baseline;
  const synthetic = !!(forecast?.is_synthetic || baseline?.is_synthetic);
  const station = useMemo(() => stations.find((s) => s.id === stationId) ?? null, [stations, stationId]);

  return (
    <div className="grid h-full grid-rows-[56px_1fr] overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line bg-surface/80 px-5 backdrop-blur">
        <h1 className="text-[19px] font-semibold tracking-tight">EventFlow <span className="text-accent">Twin</span></h1>
        {event && (
          <span className="rounded-full bg-accent-soft px-3 py-1 text-[13px] font-medium text-accent">
            {event.name} · {hh(hour)}
          </span>
        )}
        <span className="text-[12px] text-ink-3">Research prototype · designed for RTA&apos;s agentic-AI and congestion priorities</span>
        <div className="flex-1" />
        {synthetic && (
          <span className="badge-synthetic rounded-full px-3 py-1 text-[12px] font-semibold tracking-wide"
            title="Background demand comes from the labelled synthetic panel until RTA ridership is ingested">
            SYNTHETIC BASELINE
          </span>
        )}
        <button onClick={() => setTableOpen((v) => !v)} aria-pressed={tableOpen}
          className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] hover:bg-muted">
          {tableOpen ? "Map view" : "Table view"}
        </button>
        <button onClick={() => setEvidenceOpen(true)}
          className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] hover:bg-muted">
          Evidence
        </button>
      </header>

      <div className="grid min-h-0 grid-cols-[280px_1fr_380px]">
        <Rail twin={twin} />

        <main className="relative grid min-h-0 grid-rows-[1fr_auto] bg-bg">
          {twin.error && (
            <div role="alert" className="absolute inset-x-6 top-4 z-20 rounded-xl border border-risk/30 bg-surface p-4 text-sm text-risk shadow">
              {twin.error}
            </div>
          )}
          {tableOpen ? (
            <TableView forecast={forecast} sim={shown} stations={stations} />
          ) : (
            <div className="relative min-h-0">
              <CorridorMap sim={shown} stations={stations} event={event} hour={hour}
                selected={stationId} onSelect={setStationId} />
              {after && (
                <div className="absolute left-4 top-4 z-10 flex rounded-full border border-line bg-surface p-1 text-[13px] shadow-sm"
                  role="group" aria-label="Compare before and after the approved plan">
                  {(["before", "after"] as const).map((v) => (
                    <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                      className={`rounded-full px-3 py-1 ${view === v ? "bg-accent text-white" : "text-ink-2"}`}>
                      {v === "before" ? "Before" : "After approved plan"}
                    </button>
                  ))}
                </div>
              )}
              {twin.loading && (
                <div className="absolute right-4 top-4 z-10 rounded-full bg-surface px-3 py-1 text-[12px] text-ink-3 shadow-sm">
                  Updating forecast…
                </div>
              )}
            </div>
          )}
          <HeatStrip sim={shown} stations={stations} hour={hour} onHour={setHour}
            selected={stationId} onSelect={setStationId} view={after ? view : null} />
        </main>

        <Inspector twin={twin} station={station} hour={hour} view={view} />
      </div>

      <EvidenceDrawer open={evidenceOpen} onClose={() => setEvidenceOpen(false)} forecast={forecast} event={event} events={twin.events}
        decisionsVersion={Object.keys(twin.decisions).length} />
    </div>
  );
}

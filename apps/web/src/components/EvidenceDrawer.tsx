"use client";
// Evidence: every metric with its result file, data provenance, decision log size and limitations.
import { useEffect, useState } from "react";
import { api, type EventInfo, type Evidence, type ForecastResponse } from "@/lib/api";
import { fmt } from "@/lib/load";

const LABELS: Record<string, string> = {
  lgbm_mase: "Forecast MASE (LightGBM, test week; < 1 beats seasonal baseline)",
  naive_mase: "Seasonal-naive MASE (reference)",
  lgbm_smape: "Forecast sMAPE",
  naive_smape: "Seasonal-naive sMAPE (reference)",
  lgbm_coverage80: "80% interval coverage",
  property_pass_rate: "Simulator property checks passed",
  conservation_error_max: "Max passenger-conservation error",
};

export default function EvidenceDrawer({ open, onClose, forecast, event, events, decisionsVersion }: {
  open: boolean; onClose: () => void; forecast: ForecastResponse | null; event: EventInfo | null; events: EventInfo[];
  decisionsVersion: number;
}) {
  const names = Object.fromEntries(events.map((e) => [e.id, e.name]));
  const [ev, setEv] = useState<Evidence | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    api.evidence().then(setEv).catch((e) => setErr((e as Error).message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, decisionsVersion]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Evidence"
        className="h-full w-[520px] max-w-full overflow-y-auto bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <h2 className="text-[18px] font-semibold">Evidence</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="min-h-10 rounded-full border border-line px-3 text-[13px]" autoFocus>Close</button>
        </div>
        {err && <p className="text-risk">{err}</p>}

        <h3 className="label mb-2">Evaluation results</h3>
        {ev && Object.entries(ev.eval).filter(([suite]) => suite !== "sensitivity").map(([suite, r]) => (
          <div key={suite} className="mb-3 rounded-xl border border-line p-3">
            <p className="text-[13px] font-semibold capitalize">{suite}{r.is_synthetic && <span className="badge-synthetic ms-2 rounded-full px-2 py-0.5 text-[10px]">SYNTHETIC</span>}</p>
            <table className="num mt-1 w-full text-[12px]"><tbody>
              {Object.entries(r.metrics).map(([k, v]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1 text-ink-2">{LABELS[k] ?? k}</td>
                  <td className="py-1 text-end font-semibold">{typeof v === "number" ? fmt(v, v < 10 ? 3 : 0) : String(v)}</td>
                </tr>
              ))}
            </tbody></table>
            <p className="mt-1 text-[10px] text-ink-3">{r.file} · n={r.n ?? "n/a"} · split={r.split ?? "n/a"} · {r.timestamp}</p>
          </div>
        ))}

        {ev?.eval.sensitivity && <Sensitivity file={ev.eval.sensitivity.file} metrics={ev.eval.sensitivity.metrics} names={names} />}

        <h3 className="label mb-2 mt-5">Data provenance</h3>
        <ul className="space-y-1.5 text-[13px] text-ink-2">
          <li><b>Background demand:</b> {ev?.data.dataset_version ?? "…"} {ev?.data.is_synthetic && "(labelled synthetic until RTA ridership is ingested)"}</li>
          <li><b>Capacity:</b> official RTA GTFS timetable, service Sep–Dec 2021, per station and direction.</li>
          <li><b>Map geometry:</b> RTA GTFS shapes and stops (open data).</li>
          {event && <li><b>Event:</b> {event.name} — {event.is_assumption ? "attendance is an assumption" : "sourced"}{event.sources?.length ? "; sources:" : ""}
            {event.sources?.map((s) => <span key={s} className="block break-all text-[11px] text-accent">{s}</span>)}</li>}
          {forecast && <li><b>Forecast run:</b> <span className="num">{forecast.run_id}</span> ({forecast.model})</li>}
          <li><b>Config hash:</b> <span className="num">{ev?.data.config_hash}</span> · contract {ev?.contract}</li>
        </ul>

        <h3 className="label mb-2 mt-5">Human-approval log</h3>
        <p className="text-[13px] text-ink-2">{ev ? `${fmt(ev.decisions_logged)} decisions logged` : "…"} (anonymous; append-only file data/processed/decisions_log.jsonl)</p>

        <h3 className="label mb-2 mt-5">Limitations</h3>
        <ul className="list-disc space-y-1 ps-5 text-[13px] text-ink-2">
          <li>Research prototype; not an operational RTA system. Designed for, not endorsed by, RTA.</li>
          <li>Free space on arriving trains (35%) and metro share of visitors (45%) are assumptions; see the break-point table.</li>
          <li>Timetable is from 2021; RTA has added service since.</li>
          <li>Simulated effects are model outputs, not observed outcomes.</li>
        </ul>
      </aside>
    </div>
  );
}

function Sensitivity({ file, metrics, names }: { file: string; metrics: Record<string, number | null>; names: Record<string, string> }) {
  return (
    <div className="mb-3 rounded-xl border border-line p-3">
      <p className="text-[13px] font-semibold">Break-point sensitivity</p>
      <p className="mt-1 text-[12px] text-ink-2">
        Crowd size at which a station first exceeds 85% comfort under the default assumptions (35% free space on
        arriving trains, 45% of visitors by metro):
      </p>
      <table className="num mt-1 w-full text-[12px]"><tbody>
        {Object.entries(metrics).map(([k, v]) => (
          <tr key={k} className="border-t border-line">
            <td className="py-1 text-ink-2">{names[k.replace("break_attendance_default__", "")] ?? k.replace("break_attendance_default__", "")}</td>
            <td className="py-1 text-end font-semibold">{v == null ? "not reached" : `${fmt(v)} visitors/day`}</td>
          </tr>
        ))}
      </tbody></table>
      <p className="mt-1 text-[10px] text-ink-3">Full grid over both assumptions: eval/results/{file}</p>
    </div>
  );
}

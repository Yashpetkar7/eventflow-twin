"use client";
// Evidence: every metric with its result file, data provenance, decision log size and limitations.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type EventInfo, type Evidence, type ForecastResponse } from "@/lib/api";
import { useFmt, useNames } from "@/lib/i18n";

export default function EvidenceDrawer({ open, onClose, forecast, event, events, decisionsVersion }: {
  open: boolean; onClose: () => void; forecast: ForecastResponse | null; event: EventInfo | null; events: EventInfo[];
  decisionsVersion: number;
}) {
  const t = useTranslations("evidence");
  const tm = useTranslations("metric");
  const { fmt } = useFmt();
  const names = useNames();
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
  const label = (k: string) => (tm.has(k as never) ? tm(k as never) : k);
  const eventName = (id: string) => { const e = events.find((x) => x.id === id); return e ? names.event(e) : id; };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={t("title")}
        className="h-full w-[520px] max-w-full overflow-y-auto bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <h2 className="text-[18px] font-semibold">{t("title")}</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="min-h-11 rounded-full border border-line px-4 text-[13px]" autoFocus>{t("close")}</button>
        </div>
        {err && <p className="text-risk">{err}</p>}

        <h3 className="label mb-2">{t("results")}</h3>
        {ev && Object.entries(ev.eval).filter(([suite]) => suite !== "sensitivity").map(([suite, r]) => (
          <div key={suite} className="mb-3 rounded-xl border border-line p-3">
            <p className="text-[13px] font-semibold capitalize" dir="ltr">{suite}{r.is_synthetic && <span className="badge-synthetic ms-2 rounded-full px-2 py-0.5 text-[10px]">SYNTHETIC</span>}</p>
            <table className="num mt-1 w-full text-[12px]"><tbody>
              {Object.entries(r.metrics).map(([k, v]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1 text-ink-2">{label(k)}</td>
                  <td className="py-1 text-end font-semibold">{typeof v === "number" ? fmt(v, v < 10 ? 3 : 0) : String(v)}</td>
                </tr>
              ))}
            </tbody></table>
            <p className="mt-1 text-[10px] text-ink-3" dir="ltr">{r.file} · n={r.n ?? "n/a"} · split={r.split ?? "n/a"} · {r.timestamp}</p>
          </div>
        ))}

        {ev?.eval.sensitivity && (
          <div className="mb-3 rounded-xl border border-line p-3">
            <p className="text-[13px] font-semibold">{t("breakTitle")}</p>
            <p className="mt-1 text-[12px] text-ink-2">{t("breakText")}</p>
            <table className="num mt-1 w-full text-[12px]"><tbody>
              {Object.entries(ev.eval.sensitivity.metrics).map(([k, v]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1 text-ink-2">{eventName(k.replace("break_attendance_default__", ""))}</td>
                  <td className="py-1 text-end font-semibold">{v == null ? t("notReached") : t("perDay", { value: fmt(v) })}</td>
                </tr>
              ))}
            </tbody></table>
            <p className="mt-1 text-[10px] text-ink-3" dir="ltr">{t("grid", { file: ev.eval.sensitivity.file })}</p>
          </div>
        )}

        <h3 className="label mb-2 mt-5">{t("provenance")}</h3>
        <ul className="space-y-1.5 text-[13px] text-ink-2">
          <li><b>{t("background")}</b> <span dir="ltr">{ev?.data.dataset_version ?? "…"}</span> {ev?.data.is_synthetic && t("syntheticNote")}</li>
          <li><b>{t("capacity")}</b> {t("capacityText")}</li>
          <li><b>{t("geometry")}</b> {t("geometryText")}</li>
          {event && (
            <li><b>{t("event")}</b> {names.event(event)} — {event.is_assumption ? t("assumed") : t("sourced")}{event.sources?.length ? `; ${t("sourcesLabel")}` : ""}
              {event.sources?.map((s) => <span key={s} className="block break-all text-[11px] text-accent" dir="ltr">{s}</span>)}</li>
          )}
          {forecast && <li><b>{t("run")}</b> <span className="num" dir="ltr">{forecast.run_id}</span></li>}
          <li><b>{t("config")}</b> <span className="num" dir="ltr">{ev?.data.config_hash} · contract {ev?.contract}</span></li>
        </ul>

        <h3 className="label mb-2 mt-5">{t("log")}</h3>
        <p className="text-[13px] text-ink-2">{ev ? t("logText", { count: fmt(ev.decisions_logged) }) : "…"}</p>

        <h3 className="label mb-2 mt-5">{t("limits")}</h3>
        <ul className="list-disc space-y-1 ps-5 text-[13px] text-ink-2">
          <li>{t("l1")}</li><li>{t("l2")}</li><li>{t("l3")}</li><li>{t("l4")}</li>
        </ul>
      </aside>
    </div>
  );
}

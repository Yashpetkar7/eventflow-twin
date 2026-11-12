"use client";
// Every metric with its result file, the break points, data provenance and limitations.
import { useTranslations } from "next-intl";
import { useTwinCtx } from "@/lib/twinContext";
import { useEvidence } from "@/lib/useEvidence";
import { useFmt, useNames } from "@/lib/i18n";
import { Badge, Card, PageHeader } from "../ui";

export default function EvidencePage() {
  const t = useTranslations("evidence");
  const tm = useTranslations("metric");
  const tn = useTranslations("nav");
  const tp = useTranslations("page");
  const { fmt } = useFmt();
  const names = useNames();
  const { twin } = useTwinCtx();
  const { event, events, forecast } = twin;
  const { evidence: ev, error } = useEvidence([Object.keys(twin.decisions).length]);
  const label = (k: string) => (tm.has(k as never) ? tm(k as never) : k);
  const eventName = (id: string) => { const e = events.find((x) => x.id === id); return e ? names.event(e) : id; };

  return (
    <div className="mx-auto max-w-[1300px] p-6">
      <PageHeader title={tn("evidence")} sub={tp("evidenceSub")} />
      {error && <p className="mb-3 text-risk">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {ev && Object.entries(ev.eval).filter(([suite]) => suite !== "sensitivity").map(([suite, r]) => (
            <Card key={suite} title={<span className="capitalize" dir="ltr">{suite}</span>} action={r.is_synthetic ? <Badge tone="synthetic">SYNTHETIC</Badge> : null}>
              <table className="num w-full text-[13px]"><tbody>
                {Object.entries(r.metrics).map(([k, v]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 text-ink-2">{label(k)}</td>
                    <td className="py-1.5 text-end font-semibold">{typeof v === "number" ? fmt(v, v < 10 ? 3 : 0) : String(v)}</td>
                  </tr>
                ))}
              </tbody></table>
              <p className="mt-2 text-[11px] text-ink-3" dir="ltr">{r.file} · n={r.n ?? "n/a"} · split={r.split ?? "n/a"} · {r.timestamp}</p>
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {ev?.eval.sensitivity && (
            <Card title={t("breakTitle")}>
              <p className="text-[13px] text-ink-2">{t("breakText")}</p>
              <table className="num mt-2 w-full text-[13px]"><tbody>
                {Object.entries(ev.eval.sensitivity.metrics).map(([k, v]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 text-ink-2">{eventName(k.replace("break_attendance_default__", ""))}</td>
                    <td className="py-1.5 text-end font-semibold">{v == null ? t("notReached") : t("perDay", { value: fmt(v) })}</td>
                  </tr>
                ))}
              </tbody></table>
              <p className="mt-2 text-[11px] text-ink-3" dir="ltr">{t("grid", { file: ev.eval.sensitivity.file })}</p>
            </Card>
          )}
          <Card title={t("provenance")}>
            <ul className="space-y-2 text-[13px] text-ink-2">
              <li><b>{t("background")}</b> <span dir="ltr">{ev?.data.dataset_version ?? "…"}</span> {ev?.data.is_synthetic && t("syntheticNote")}</li>
              <li><b>{t("capacity")}</b> {t("capacityText")}</li>
              <li><b>{t("geometry")}</b> {t("geometryText")} © OpenStreetMap contributors.</li>
              {event && (
                <li><b>{t("event")}</b> {names.event(event)} — {event.is_assumption ? t("assumed") : t("sourced")}{event.sources?.length ? `; ${t("sourcesLabel")}` : ""}
                  {event.sources?.map((s) => <span key={s} className="block break-all text-[11px] text-accent" dir="ltr">{s}</span>)}</li>
              )}
              {forecast && <li><b>{t("run")}</b> <span className="num" dir="ltr">{forecast.run_id}</span></li>}
              <li><b>{t("config")}</b> <span className="num" dir="ltr">{ev?.data.config_hash} · contract {ev?.contract}</span></li>
            </ul>
          </Card>
          <Card title={t("log")}><p className="text-[13px] text-ink-2">{ev ? t("logText", { count: fmt(ev.decisions_logged) }) : "…"}</p></Card>
          <Card title={t("limits")}>
            <ul className="list-disc space-y-1 ps-5 text-[13px] text-ink-2"><li>{t("l1")}</li><li>{t("l2")}</li><li>{t("l3")}</li><li>{t("l4")}</li></ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

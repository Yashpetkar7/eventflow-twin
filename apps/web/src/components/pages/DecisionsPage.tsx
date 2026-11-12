"use client";
// The human-approval audit trail (GET /decisions), newest first, with a CSV export of what is shown.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Download, ListChecks, RefreshCw, XCircle } from "lucide-react";
import { api, type DecisionList } from "@/lib/api";
import { useTwinCtx } from "@/lib/twinContext";
import { useFmt } from "@/lib/i18n";
import { Card, KpiCard, PageHeader } from "../ui";

export default function DecisionsPage() {
  const t = useTranslations("decisions");
  const tn = useTranslations("nav");
  const tp = useTranslations("page");
  const tpl = useTranslations("plan");
  const { fmt } = useFmt();
  const { twin } = useTwinCtx();
  const [data, setData] = useState<DecisionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.decisions().then((d) => { setData(d); setError(null); }).catch((e) => setError((e as Error).message));
  }, []);
  const count = Object.keys(twin.decisions).length;
  useEffect(() => { load(); }, [load, count]);

  const exportCsv = () => {
    if (!data) return;
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const lines = [["timestamp", "decision", "option_title", "plan_id", "option_rank", "forecast_run_id", "interventions"].join(",")];
    for (const r of data.items) {
      lines.push([r.timestamp, r.decision, r.option_title, r.plan_id, r.option_rank, r.forecast_run_id,
        (r.interventions ?? []).map((i) => i.type).join("+")].map(esc).join(","));
    }
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "eventflow-decisions.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-[1300px] p-6">
      <PageHeader title={tn("decisions")} sub={tp("decisionsSub")} actions={
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[13px] hover:bg-muted">
            <RefreshCw className="h-4 w-4" aria-hidden /> {t("refresh")}
          </button>
          <button onClick={exportCsv} disabled={!data?.items.length}
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-semibold text-white disabled:opacity-50">
            <Download className="h-4 w-4" aria-hidden /> {t("export")}
          </button>
        </div>} />
      {error && <p className="mb-3 text-risk">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard icon={ListChecks} label={t("total")} value={data ? fmt(data.total) : "—"} />
        <KpiCard icon={CheckCircle2} label={t("approved")} tone="ok" value={data ? fmt(data.approved) : "—"} />
        <KpiCard icon={XCircle} label={t("rejected")} tone="risk" value={data ? fmt(data.rejected) : "—"} />
      </div>
      <Card className="mt-4">
        {data && data.items.length === 0 ? <p className="text-[13px] text-ink-3">{t("empty")}</p> : (
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-3">
              <tr><th className="py-2 text-start">{t("time")}</th><th className="text-start">{t("decision")}</th>
                <th className="text-start">{t("option")}</th><th className="text-start">{t("what")}</th><th className="text-start">{t("plan")}</th></tr>
            </thead>
            <tbody>
              {data?.items.map((r) => (
                <tr key={r.decision_id} className="border-t border-line align-top">
                  <td className="num py-2 pe-3 text-ink-2" dir="ltr">{r.timestamp.replace("T", " ").slice(0, 19)}</td>
                  <td className="py-2 pe-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.decision === "approve" ? "bg-ok/12 text-ok" : "bg-muted text-ink-2"}`}>
                      {r.decision === "approve" ? tpl("approved") : tpl("rejected")}
                    </span>
                  </td>
                  <td className="py-2 pe-3">{r.option_title ?? `#${r.option_rank}`}</td>
                  <td className="py-2 pe-3 text-ink-2" dir="ltr">{(r.interventions ?? []).map((i) => i.type).join(" + ") || "—"}</td>
                  <td className="num py-2 text-[11px] text-ink-3" dir="ltr">{r.plan_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

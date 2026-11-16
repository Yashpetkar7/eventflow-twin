"use client";
// The debate (decision #128): for every plan the team tested, the case made for it (which specialist proposed it and
// what the simulator measured) against the critic's objections (the named criteria it fails) and the verdict.
// Read straight from the mission: proposals from the specialists' events, figures from each plan's simulation,
// objections from the critic's checks. Nothing is computed here.
import { useTranslations } from "next-intl";
import type { Mission } from "@/lib/api";
import { N, useFmt } from "@/lib/i18n";

interface Row { key: string; types: string[]; by: string | null; rank: number | null; over: number | null; excess: number | null; runId: string | null; fails: string[]; reason: string | null }

function rows(m: Mission): Row[] {
  // who proposed which bundle (the composer builds the cross-domain ones)
  const by: Record<string, string> = {};
  for (const e of m.events) if (e.kind === "proposal") for (const k of ((e.params as { keys?: string[] }).keys ?? [])) by[k] = e.agent;
  const order = (m.events.find((e) => e.key === "ranker.kept")?.params as { order?: string[] } | undefined)?.order ?? [];
  const out: Row[] = m.plan.options.map((o, i) => {
    const a = m.assessments.find((x) => x.rank === o.rank);
    return { key: order[i] ?? `option${o.rank}`, types: [...new Set(o.interventions.map((iv) => iv.type))], by: by[order[i] ?? ""] ?? null, rank: o.rank,
      over: o.summary.overcap_station_hours, excess: o.summary.excess_pax, runId: o.sources?.[0]?.run_id ?? null,
      fails: (a?.checks ?? []).filter((c) => c.passed === false).map((c) => c.id), reason: null };
  });
  for (const r of m.rejected) {
    out.push({ key: r.label, types: [...new Set(r.interventions.map((iv) => iv.type))], by: by[r.label] ?? null, rank: null,
      over: r.summary?.overcap_station_hours ?? null, excess: r.summary?.excess_pax ?? null, runId: r.run_id ?? null, fails: r.criteria, reason: r.reason });
  }
  return out;
}

export function DebateCard({ mission, max = 6 }: { mission: Mission; max?: number }) {
  const t = useTranslations("mission.debate");
  const tm = useTranslations("mission") as unknown as (k: string, v?: Record<string, string | number>) => string;
  const f = useFmt();
  const all = rows(mission), base = mission.plan.baseline_summary;
  if (!all.length) return null;
  const lim = (c: string) => { const x = mission.assessments[0]?.checks.find((y) => y.id === c)?.limit; return x == null ? "" : f.int(x); };
  return (
    <div className="card" data-testid="team-debate">
      <h3 className="team-h">{t("title")}</h3>
      <p className="note">{t("sub")}</p>
      <ol className="debate">
        {all.slice(0, max).map((r) => {
          const what = r.types.map((k) => tm(`measure.${k}`)).join(" + ");
          return (
            <li key={`${r.key}${r.rank ?? ""}`} className={r.rank ? "kept" : "out"} data-debate={r.key}>
              <div className="debate-case">
                <em>{t("case")}</em>
                <span><bdi>{r.by && r.by !== "composer" ? t("by", { agent: tm(`agent.${r.by}`), what }) : t("combined", { what })}</bdi>{" "}
                  {r.over !== null && r.excess !== null && <N>{t("measured", { b: f.int(base.excess_pax), a: f.int(r.excess), ob: f.num(base.overcap_station_hours), oa: f.num(r.over) })}</N>}
                  {r.runId ? <small> <bdi>{r.runId}</bdi></small> : null}</span>
              </div>
              <div className="debate-critic">
                <em>{t("critic")}</em>
                <span>{r.fails.length ? <N>{t("objects", { list: r.fails.map((c) => `${c} ${tm(`crit.${c}`, { limit: lim(c) })}`).join("; ") })}</N> : t("noObjection")}</span>
              </div>
              <div className="debate-verdict"><N>{r.rank ? t("offered", { rank: r.rank }) : t("notOffered", { reason: tm(`reason.${r.reason ?? "outranked"}`) })}</N></div>
            </li>
          );
        })}
      </ol>
      {all.length > max && <div className="note"><N>{t("more", { n: all.length - max })}</N></div>}
    </div>
  );
}

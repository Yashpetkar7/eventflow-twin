"use client";
// The agent trace (WP4, contract 1.14.0): one bar per agent step on the mission's own clock, coloured by layer, with
// the simulator runs behind it. DOM only (not in the 3D canvas); no animation, so reduced motion needs nothing extra.
import { useTranslations } from "next-intl";
import type { Mission } from "@/lib/api";
import { N, useFmt } from "@/lib/i18n";

export function TraceCard({ mission }: { mission: Mission }) {
  const t = useTranslations("mission.trace");
  const ta = useTranslations("mission");
  const tag = ta as unknown as (k: string) => string;
  const f = useFmt();
  const sp = mission.spans ?? [];
  if (!sp.length) return null;                      // an older snapshot has no spans: no card
  const total = Math.max(...sp.map((s) => s.end_ms), 1);
  return (
    <div className="card" data-testid="team-trace">
      <h3 className="team-h" style={{ marginTop: 0 }}>{t("title")}</h3>
      <p className="note"><N>{t("sub", { ms: f.int(total), n: sp.length })}</N></p>
      <ol className="trace" aria-label={t("title")}>
        {sp.map((s, i) => {
          const left = (s.start_ms / total) * 100;
          const width = Math.max(0.8, ((s.end_ms - s.start_ms) / total) * 100);
          return (
            <li key={i} className={`L${s.layer}`} title={s.keys.join(", ")}>
              <span className="who"><bdi>{tag(`agent.${s.agent}`)}</bdi>{s.round > 1 ? <small> · <N>{t("round", { r: s.round })}</N></small> : null}{s.llm ? <em className="ai">AI</em> : null}</span>
              <span className="lane" aria-hidden="true"><i style={{ insetInlineStart: `${left}%`, inlineSize: `${Math.min(width, 100 - left)}%` }} /></span>
              <span className="meta"><N>{t("meta", { ms: f.num(s.end_ms - s.start_ms), runs: s.run_ids.length })}</N></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

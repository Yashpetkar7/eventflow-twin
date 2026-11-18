"use client";
// The kiosk's plan editor (decision #155): the visitor takes one of the AI's options, changes a setting or drops a
// measure, and the simulator tests exactly that version before anything can be approved. The AI's own result stays
// next to it, so the visitor sees whether their change helped. Approving logs the edited measures as the visitor's
// decision (POST /decisions), as every approval does. Values outside the simulator's bounds are refused by the API
// (HTTP 422), never clipped: the editor then says so and keeps the last tested version.
import { useEffect, useRef, useState } from "react";
import { N, useFmt } from "@/lib/i18n";
import { api, type AgentPlanResponse, type Intervention, type SimulateResponse } from "@/lib/api";
import { simulateBody } from "@/lib/requests";
import { mergeInterventions, useTwin } from "@/lib/store";
import { useSay } from "../assistant/say";

type Option = AgentPlanResponse["options"][number];
type Summary = SimulateResponse["summary"];
interface Knob { p: string; step: number; min: number; max: number; pct?: boolean }
// the one setting of each measure a visitor can turn (bounds: config/corridor.yaml → interventions.bounds)
const KNOBS: Record<string, Knob | null> = {
  staggered_exit: { p: "spread_minutes", step: 15, min: 15, max: 90 },
  extra_trains: { p: "headway_min", step: 0.5, min: 2, max: 6 },
  wayfinding_redirect: { p: "share", step: 0.05, min: 0.05, max: 0.5, pct: true },
  shuttle_bus: { p: "buses", step: 2, min: 2, max: 30 },
  robotaxi_staging: { p: "vehicles", step: 10, min: 10, max: 60 },
  station_metering: { p: "max_load", step: 0.05, min: 0.5, max: 0.95, pct: true },
  extended_hours: null,
};
const round = (v: number) => Math.round(v * 100) / 100;

export function PlanEditor({ option, before, onApproved, onClose }: { option: Option; before: Summary; onApproved: (title: string) => void; onClose: () => void }) {
  const { t } = useSay();
  const f = useFmt();
  const threshold = useTwin((s) => s.threshold);
  const deciding = useTwin((s) => s.deciding);
  const [ivs, setIvs] = useState<Intervention[]>(() => JSON.parse(JSON.stringify(option.interventions)) as Intervention[]);
  const [off, setOff] = useState<number[]>([]);
  const [mine, setMine] = useState<{ summary: Summary; runId: string; key: string } | null>(null);
  const [state, setState] = useState<"testing" | "ok" | "refused">("ok");
  const active = ivs.filter((_, i) => !off.includes(i));
  const key = JSON.stringify(active);
  const changed = key !== JSON.stringify(option.interventions);
  const seq = useRef(0);

  // every change is tested by the simulator (debounced); the figures shown are always those of a finished run
  useEffect(() => {
    if (!changed || !active.length) return;
    const n = ++seq.current;
    const h = setTimeout(async () => {
      const s = useTwin.getState();
      if (!s.forecast || !s.forecastReq) return;
      setState("testing");
      try {
        const r = await api.simulate(simulateBody(s.forecast.run_id, mergeInterventions([...s.applied.map((a) => a.ivs), active]), s.threshold, s.forecastReq));
        if (n === seq.current) { setMine({ summary: r.summary, runId: r.run_id, key }); setState("ok"); }
      } catch {
        if (n === seq.current) setState("refused");
      }
    }, 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const turn = (i: number, dir: 1 | -1) => {
    const k = KNOBS[ivs[i].type];
    if (!k) return;
    const now = Number((ivs[i].params as Record<string, unknown>)[k.p] ?? k.min);
    const v = round(Math.min(k.max, Math.max(k.min, now + dir * k.step)));
    setIvs(ivs.map((x, j) => (j === i ? ({ ...x, params: { ...x.params, [k.p]: v } } as Intervention) : x)));
  };
  const shown = (i: number) => {
    const k = KNOBS[ivs[i].type];
    if (!k) return "";
    const v = Number((ivs[i].params as Record<string, unknown>)[k.p] ?? 0);
    return t(`kai.edit.knob.${ivs[i].type}`, { v: k.pct ? f.int(Math.round(v * 100)) : f.num(v, v % 1 ? 1 : 0) });
  };
  const tested = changed && mine && mine.key === key && state === "ok" ? mine : null;
  const ai = option.summary;
  const gap = tested ? Math.round(tested.summary.excess_pax - ai.excess_pax) : 0;
  const title = t("kai.edit.mine", { title: option.title });
  const approve = async () => {
    if (!tested) return;
    if (await useTwin.getState().approveEdited(title, active, tested.runId)) onApproved(title);
  };
  const cls = (lf: number) => (lf > threshold ? "risk" : "okc");

  return (
    <div className="kedit" data-testid="kiosk-editor" data-state={!changed ? "same" : !active.length ? "empty" : state === "ok" && tested ? "tested" : state}>
      <p className="ksub">{t("kai.edit.sub")}</p>
      <ul>
        {ivs.map((iv, i) => {
          const k = KNOBS[iv.type], gone = off.includes(i);
          return (
            <li key={i} className={gone ? "off" : ""} data-type={iv.type}>
              <b>{t(`measure.${iv.type}`)}</b>
              {k && !gone ? (
                <span className="kstep">
                  <button type="button" aria-label={t("kai.edit.less")} onClick={() => turn(i, -1)} data-testid="kedit-less">−</button>
                  <i><N>{shown(i)}</N></i>
                  <button type="button" aria-label={t("kai.edit.more")} onClick={() => turn(i, 1)} data-testid="kedit-more">+</button>
                </span>
              ) : <span className="kstep"><i>{gone ? t("kai.edit.removed") : t("kai.edit.fixed")}</i></span>}
              <button type="button" className="kpill" aria-pressed={gone} onClick={() => setOff(gone ? off.filter((x) => x !== i) : [...off, i])} data-testid="kedit-drop">{gone ? t("kai.edit.restore") : t("kai.edit.drop")}</button>
            </li>
          );
        })}
      </ul>
      <table className="kcmp" data-testid="kedit-table">
        <thead><tr><th /><th>{t("kai.edit.today")}</th><th>{t("kai.edit.ai")}</th><th>{t("kai.edit.yours")}</th></tr></thead>
        <tbody>
          <tr><th>{t("kai.edit.peak")}</th><td><N>{f.pct(before.peak_lf)}</N></td><td className={cls(ai.peak_lf)}><N>{f.pct(ai.peak_lf)}</N></td>
            <td className={tested ? cls(tested.summary.peak_lf) : ""} data-testid="kedit-peak"><N>{tested ? f.pct(tested.summary.peak_lf) : "–"}</N></td></tr>
          <tr><th>{t("kai.edit.over")}</th><td><N>{f.int(before.excess_pax)}</N></td><td><N>{f.int(ai.excess_pax)}</N></td>
            <td data-testid="kedit-over"><N>{tested ? f.int(tested.summary.excess_pax) : "–"}</N></td></tr>
        </tbody>
      </table>
      <p className="knote" data-testid="kedit-verdict" aria-live="polite">
        {!changed ? t("kai.edit.same") : !active.length ? t("kai.edit.empty") : state === "testing" ? t("kai.edit.testing") : state === "refused" ? t("kai.edit.refused")
          : !tested ? t("kai.edit.testing") : <N>{gap > 0 ? t("kai.edit.worse", { n: f.int(gap) }) : gap < 0 ? t("kai.edit.better", { n: f.int(-gap) }) : t("kai.edit.equal")}</N>}
      </p>
      <div className="krow">
        <button type="button" className="kgo" disabled={!tested || deciding} onClick={() => void approve()} data-testid="kedit-approve">{t("kai.edit.approve")}</button>
        <button type="button" className="kgo ghost" onClick={onClose} data-testid="kedit-close">{t("kai.edit.back")}</button>
      </div>
    </div>
  );
}

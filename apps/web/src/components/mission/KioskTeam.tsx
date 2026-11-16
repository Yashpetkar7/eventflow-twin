"use client";
// "Watch the AI team work" on the visitor kiosk: the five layers light up as the mission's events play back, with
// the latest agent's line in plain words and a Skip button. Text comes from the mission's own events.
import { useTranslations } from "next-intl";
import { N } from "@/lib/i18n";
import { useEventText } from "@/lib/mission";
import { useTwin } from "@/lib/store";
import { TeamGraph } from "./TeamTab";

export function KioskTeam() {
  const t = useTranslations("mission");
  const td = t as unknown as (k: string) => string;
  const mission = useTwin((s) => s.mission);
  const shown = useTwin((s) => s.missionShown);
  const stations = useTwin((s) => s.stations);
  const text = useEventText(stations);
  if (!mission) return null;
  const last = mission.events[Math.max(0, shown - 1)];
  return (
    <div className="kteam" data-testid="kiosk-team">
      <div className="kteam-head">
        <b><N>{t("lede", { agents: mission.counts.agents, model: mission.counts.model_capable })}</N></b>
      </div>
      <TeamGraph mission={mission} shown={shown} compact />
      {last && (
        <p className="kteam-now" aria-live="polite">
          <span>{td(`agent.${last.agent}`)}</span><bdi><N>{text(last)}</N></bdi>
        </p>
      )}
      <button type="button" className="kpill" onClick={() => useTwin.getState().skipMission()} data-testid="kiosk-team-skip">{t("skip")}</button>
    </div>
  );
}

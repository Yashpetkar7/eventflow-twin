"use client";
import { useTranslations } from "next-intl";
import { useTwinCtx } from "@/lib/twinContext";
import { useFmt, useNames } from "@/lib/i18n";
import { PlanPanel, Scoreboard, StationChart, StationSummary } from "../Inspector";
import { Card, PageHeader } from "../ui";

export default function PlannerPage() {
  const t = useTranslations("planner");
  const tn = useTranslations("nav");
  const tp = useTranslations("page");
  const to = useTranslations("overview");
  const { fmt } = useFmt();
  const names = useNames();
  const { twin, stationId } = useTwinCtx();
  const station = twin.stations.find((s) => s.id === stationId) ?? null;

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader title={tn("planner")} sub={tp("plannerSub")} />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-[13px] leading-relaxed text-ink-2">{t("intro")}</p>
            {twin.event && (
              <p className="mt-2 text-[13px] text-ink-2"><b>{to("scenario")}:</b> {names.event(twin.event)} ·{" "}
                <span className="num">{to("attendance", { value: fmt(twin.forecast?.attendance_used ?? twin.event.attendance) })}</span></p>
            )}
          </Card>
          <PlanPanel columns={3} />
        </div>
        <div className="flex flex-col gap-4">
          <Scoreboard />
          <StationSummary station={station} />
          <section className="glass p-4"><StationChart stationId={stationId} /></section>
        </div>
      </div>
    </div>
  );
}

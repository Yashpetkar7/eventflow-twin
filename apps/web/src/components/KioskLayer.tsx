"use client";
// Booth behaviour for ?kiosk=1 (docs/07): attract screen with autoplay → touch → 3-step guided tour → live use;
// 60 s without a touch resets the twin for the next visitor and returns to the attract screen.
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { enterFullscreen, idleMs } from "@/lib/kiosk";

export type KioskMode = "attract" | "tour" | "live";

const TOUR = [
  { target: "scenario", title: "t1Title", body: "t1" },
  { target: "timeline", title: "t2Title", body: "t2" },
  { target: "plan", title: "t3Title", body: "t3" },
] as const;

export default function KioskLayer({ mode, setMode, onTick, onReset }: {
  mode: KioskMode; setMode: (m: KioskMode) => void; onTick: () => void; onReset: () => void;
}) {
  const t = useTranslations("kiosk");
  const [step, setStep] = useState(0);
  const [idle] = useState(idleMs);

  // Autoplay while attracting.
  useEffect(() => {
    if (mode !== "attract") return;
    const id = window.setInterval(onTick, 1600);
    return () => window.clearInterval(id);
  }, [mode, onTick]);

  // Idle → reset and attract.
  useEffect(() => {
    if (mode === "attract") return;
    let timer = window.setTimeout(fire, idle);
    function fire() { onReset(); setMode("attract"); }
    const poke = () => { window.clearTimeout(timer); timer = window.setTimeout(fire, idle); };
    window.addEventListener("pointerdown", poke, true);
    window.addEventListener("keydown", poke, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", poke, true);
      window.removeEventListener("keydown", poke, true);
    };
  }, [mode, onReset, setMode, idle]);

  const start = useCallback(() => {
    void enterFullscreen();
    onReset();
    setStep(0);
    setMode("tour");
  }, [onReset, setMode]);

  if (mode === "attract") {
    return (
      <button type="button" onPointerDown={start} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && start()}
        className="eft-fade fixed inset-0 z-[60] flex flex-col items-center justify-end bg-gradient-to-t from-ink/70 via-ink/25 to-transparent pb-[12vh] text-center text-white"
        aria-label={t("start")}>
        <p className="text-[64px] font-semibold leading-tight tracking-tight drop-shadow" lang="en" dir="ltr">Predict the crowd before it arrives.</p>
        <p className="mt-2 text-[56px] font-semibold leading-tight drop-shadow" lang="ar" dir="rtl" style={{ fontFamily: "var(--font-arabic)" }}>
          توقّع الزحام قبل وصوله
        </p>
        <p className="mt-5 max-w-3xl text-[24px] leading-relaxed text-white/90">{t("sub")}</p>
        <span className="mt-8 rounded-full bg-accent px-10 py-5 text-[26px] font-semibold shadow-lg">{t("start")}</span>
        <span className="mt-4 text-[18px] text-white/80">{t("touch")}</span>
      </button>
    );
  }
  if (mode === "tour") {
    const s = TOUR[step];
    return (
      <TourStep key={step} target={s.target} title={t(s.title)} body={t(s.body)} stepLabel={t("step", { n: step + 1 })}
        skip={t("skip")} next={step < TOUR.length - 1 ? t("next") : t("done")}
        onSkip={() => setMode("live")}
        onNext={() => (step < TOUR.length - 1 ? setStep(step + 1) : setMode("live"))} />
    );
  }
  return null;
}

function TourStep({ target, title, body, stepLabel, skip, next, onSkip, onNext }: {
  target: string; title: string; body: string; stepLabel: string; skip: string; next: string;
  onSkip: () => void; onNext: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector(`[data-tour="${target}"]`);
    const measure = () => setRect(el ? el.getBoundingClientRect() : null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [target]);

  // Card sits beside the highlighted area, on whichever side has more room.
  const vw = typeof window === "undefined" ? 1920 : window.innerWidth;
  const vh = typeof window === "undefined" ? 1080 : window.innerHeight;
  const cardW = 520;
  let left = vw / 2 - cardW / 2;
  let top = vh / 2 - 120;
  if (rect) {
    const roomRight = vw - rect.right, roomLeft = rect.left;
    if (Math.max(roomRight, roomLeft) > cardW + 48) {
      left = roomRight >= roomLeft ? rect.right + 24 : rect.left - cardW - 24;
      top = Math.min(Math.max(24, rect.top), vh - 320);
    } else {
      left = Math.min(Math.max(24, rect.left), vw - cardW - 24);
      top = rect.top > vh / 2 ? Math.max(24, rect.top - 300) : Math.min(vh - 320, rect.bottom + 24);
    }
  }
  return (
    <div className="eft-fade fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={title}>
      {rect && (
        <div className="pointer-events-none absolute rounded-2xl ring-4 ring-accent transition-all"
          style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16,
            boxShadow: "0 0 0 9999px rgba(27,31,42,0.55)" }} />
      )}
      <div className="absolute rounded-2xl bg-surface p-7 shadow-2xl" style={{ left, top, width: cardW }}>
        <p className="label">{stepLabel}</p>
        <h2 className="mt-2 text-[28px] font-semibold leading-snug">{title}</h2>
        <p className="mt-3 text-[20px] leading-relaxed text-ink-2">{body}</p>
        <div className="mt-6 flex gap-3">
          <button onClick={onSkip} className="min-h-14 flex-1 rounded-xl border border-line text-[20px] text-ink-2">{skip}</button>
          <button onClick={onNext} autoFocus className="min-h-14 flex-[2] rounded-xl bg-accent text-[20px] font-semibold text-white">{next}</button>
        </div>
      </div>
    </div>
  );
}

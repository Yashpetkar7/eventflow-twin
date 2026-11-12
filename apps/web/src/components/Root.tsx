"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { isPublicDemo } from "@/lib/api";
import { I18nProvider, useLocale } from "@/lib/i18n";
import { useTwin } from "@/lib/store";
import { armIdle, runTour, stopTour, watchApi } from "@/lib/tour";
import { Header } from "./Header";
import { Kiosk } from "./kiosk/Kiosk";
import { Panel } from "./Panel";
import { Rail } from "./Rail";
import { Stage } from "./Stage";

/** ?kiosk=1 → the visitor kiosk; ?kiosk=classic → the earlier kiosk (workspace with big targets + idle guided demo). */
const kioskMode = () => new URLSearchParams(window.location.search).get("kiosk");

function idleMs(): number {
  const v = Number(new URLSearchParams(window.location.search).get("idle"));
  return Number.isFinite(v) && v >= 5 && v <= 600 ? v * 1000 : 60_000;
}

function wantsWelcome(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get("kiosk")) return false;
  let seen = false;
  try { seen = sessionStorage.getItem("eft_welcome") === "1"; } catch { /* private mode: show it */ }
  return q.get("welcome") === "1" || (isPublicDemo() && !seen);
}

function Workspace() {
  const t = useTranslations();
  const { locale } = useLocale();
  const localeRef = useRef(locale);
  useEffect(() => { localeRef.current = locale; }, [locale]);
  const kiosk = useTwin((s) => s.kiosk);
  const apiDown = useTwin((s) => s.apiDown);
  const error = useTwin((s) => s.error);
  const tourStep = useTwin((s) => s.tourStep);
  const expanded = useTwin((s) => s.expanded);
  const [how, setHow] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  // Public link: a first-visit sheet that says what this is and offers the visitor story (?welcome=1 shows it locally)
  const [welcome, setWelcome] = useState(wantsWelcome);
  const wdlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    useTwin.setState({ kiosk: q.get("kiosk") === "1" || q.get("kiosk") === "classic", reducedMotion: mq.matches });
    const onMq = () => useTwin.setState({ reducedMotion: mq.matches });
    mq.addEventListener("change", onMq);
    void useTwin.getState().init();
    const stop = watchApi();
    return () => { mq.removeEventListener("change", onMq); stop(); };
  }, []);

  // Kiosk: larger touch targets, no text selection or context menu, idle → guided demo.
  useEffect(() => {
    document.body.classList.toggle("kiosk", kiosk);
    if (!kiosk) return;
    const noMenu = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", noMenu);
    document.addEventListener("selectstart", noMenu);
    const disarm = kioskMode() === "classic" ? armIdle(idleMs(), () => localeRef.current) : () => {};   // the visitor kiosk runs its own attract loop
    return () => { document.removeEventListener("contextmenu", noMenu); document.removeEventListener("selectstart", noMenu); disarm(); };
  }, [kiosk]);

  useEffect(() => { if (how) dlg.current?.showModal(); else dlg.current?.close(); }, [how]);
  useEffect(() => { if (welcome && !wdlg.current?.open) wdlg.current?.showModal(); else if (!welcome) wdlg.current?.close(); }, [welcome]);
  const closeWelcome = () => { try { sessionStorage.setItem("eft_welcome", "1"); } catch { /* ignore */ } setWelcome(false); };

  if (kiosk && kioskMode() !== "classic") return <Kiosk />;

  return (
    <div className="shell" style={{ display: "flex", flexDirection: "column", height: "100dvh", minHeight: 640 }}>
      <Header onHow={() => setHow(true)} onTour={() => void runTour(locale)} />
      {isPublicDemo() && <div className="banner demo" role="note">{t("publicDemo")}</div>}
      {(apiDown || error) && <div className="banner" role="status">{apiDown ? t("apiDown") : t("apiError", { msg: error ?? "" })}</div>}
      <main className={`app${expanded ? " expanded" : ""}`}>
        <Rail />
        <Stage />
        <Panel />
      </main>
      <footer className="ftr">{t("footer")}</footer>
      {tourStep !== null && (
        <div className="tour" role="status" aria-live="polite">
          <div><span>{t(`tourSteps.${tourStep as 0 | 1 | 2 | 3 | 4}`)}</span><button type="button" onClick={stopTour}>{t("skip")}</button></div>
        </div>
      )}
      <dialog ref={wdlg} className="how welcome" onClose={closeWelcome} data-testid="welcome">
        <h3>{t("welcome.title")}</h3>
        <p className="lead">{t("welcome.lead")}</p>
        <ol><li>{t("welcome.p1")}</li><li>{t("welcome.p2")}</li></ol>
        <div className="wbtns">
          {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full page load: the kiosk reads its mode when the page starts */}
          <button type="button" className="btn navy" onClick={() => { window.location.href = "/?kiosk=1"; }} data-testid="welcome-story">{t("welcome.story")}</button>
          <button type="button" className="btn ghost" onClick={closeWelcome}>{t("welcome.work")}</button>
        </div>
        <p className="note">{t("welcome.note")}</p>
      </dialog>
      <dialog ref={dlg} className="how" onClose={() => setHow(false)}>
        <h3>{t("howTitle")}</h3>
        <ol>{(["how1", "how2", "how3", "how4", "how5"] as const).map((k) => <li key={k}>{t(k)}</li>)}</ol>
        <p>{t("howAlign")}</p>
        <button type="button" className="btn navy" onClick={() => setHow(false)}>{t("close")}</button>
      </dialog>
    </div>
  );
}

export default function Root() {
  return (
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  );
}

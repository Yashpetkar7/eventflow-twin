"use client";
import { useTranslations } from "next-intl";
import { useLocale } from "@/lib/i18n";
import { useTwin } from "@/lib/store";

export function Header({ onHow, onTour }: { onHow: () => void; onTour: () => void }) {
  const t = useTranslations();
  const { locale, setLocale } = useLocale();
  const synthetic = useTwin((s) => s.forecast?.is_synthetic ?? false);
  const kiosk = useTwin((s) => s.kiosk);
  return (
    <header className="hdr">
      <div className="brand">
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
          <rect x="3" y="15" width="6" height="12" rx="2" fill="var(--navy)" /><rect x="12" y="5" width="6" height="22" rx="2" fill="var(--brand)" /><rect x="21" y="10" width="6" height="17" rx="2" fill="var(--warn)" />
        </svg>
        <div><b>EventFlow Twin</b><span>{t("tagline")}</span></div>
      </div>
      <div style={{ flex: 1 }} />
      {synthetic && <span className="badge" data-testid="synthetic-badge">{t("synthetic")}</span>}
      <button type="button" className="pill" onClick={onTour}>{t("tourBtn")}</button>
      <button type="button" className="pill" onClick={onHow}>{t("how")}</button>
      <button type="button" className="pill" aria-pressed={kiosk} onClick={() => useTwin.setState({ kiosk: !kiosk })}>{t("kiosk")}</button>
      <button type="button" className="pill" lang={locale === "ar" ? "en" : "ar"} onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{t("langSwitch")}</button>
    </header>
  );
}

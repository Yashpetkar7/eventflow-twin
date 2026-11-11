"use client";
// English / Arabic with full RTL. next-intl handles messages (ICU); locale lives in client state because the
// kiosk is a single offline page (no locale routing). Initial locale: ?lang=ar|en, else last choice, else en.
// This module is only rendered client-side (see App.tsx), so reading window during initial state is safe.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import type { EventInfo, Station } from "./api";

export type Locale = "en" | "ar";
const KEY = "eventflow.locale";

function initialLocale(): Locale {
  const q = new URLSearchParams(window.location.search).get("lang");
  if (q === "ar" || q === "en") return q;
  try {
    const s = window.localStorage.getItem(KEY);
    if (s === "ar" || s === "en") return s;
  } catch { /* storage blocked: fall through */ }
  return "en";
}

const LocaleCtx = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({ locale: "en", setLocale: () => {} });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    try { window.localStorage.setItem(KEY, locale); } catch { /* ignore */ }
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return (
    <LocaleCtx.Provider value={value}>
      <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en} timeZone="Asia/Dubai">
        {children}
      </NextIntlClientProvider>
    </LocaleCtx.Provider>
  );
}

export const useLocaleSwitch = () => useContext(LocaleCtx);

/** Locale-aware number formatting. Arabic uses Western digits (common in UAE interfaces). */
export function useFmt() {
  const { locale } = useLocaleSwitch();
  return useMemo(() => {
    const tag = locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB";
    const cache = new Map<string, Intl.NumberFormat>();
    const nf = (key: string, opts: Intl.NumberFormatOptions) => {
      if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(tag, opts));
      return cache.get(key)!;
    };
    return {
      fmt: (n: number, digits = 0) => nf(`n${digits}`, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n),
      pct: (lf: number) => nf("p", { style: "percent", maximumFractionDigits: 0 }).format(lf),
      hh: (h: number) => `${String(h).padStart(2, "0")}:00`,
    };
  }, [locale]);
}

/** Pick the Arabic name when available (official RTA GTFS translations for stations). */
export function useNames() {
  const { locale } = useLocaleSwitch();
  return useMemo(() => ({
    station: (s: Pick<Station, "name_en" | "name_ar"> | null | undefined) =>
      !s ? "—" : locale === "ar" && s.name_ar ? s.name_ar : s.name_en,
    event: (e: EventInfo) => (locale === "ar" && e.name_ar ? e.name_ar : e.name),
    venue: (e: EventInfo) => (locale === "ar" && e.venue_ar ? e.venue_ar : e.venue),
    note: (e: EventInfo) => (locale === "ar" && e.note_ar ? e.note_ar : e.note),
  }), [locale]);
}

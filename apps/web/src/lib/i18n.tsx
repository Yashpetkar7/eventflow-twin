"use client";
// English / Arabic with full RTL. next-intl handles messages (ICU); the locale lives in client state because the
// exhibit is one offline page (no locale routing). Initial locale: ?lang=ar|en, else the last choice, else en.
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
  } catch { /* storage blocked */ }
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

export const useLocale = () => useContext(LocaleCtx);

const formatters = new Map<string, Intl.NumberFormat>();
function nf(locale: Locale, key: string, opts: Intl.NumberFormatOptions) {
  const k = `${locale}:${key}`;
  // Arabic uses Western digits: standard in UAE interfaces and consistent with the poster (docs/09 #30).
  if (!formatters.has(k)) formatters.set(k, new Intl.NumberFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", opts));
  return formatters.get(k)!;
}
export const fmtInt = (l: Locale, n: number) => nf(l, "i", { maximumFractionDigits: 0 }).format(n);
export const fmtNum = (l: Locale, n: number, d = 2) => nf(l, `n${d}`, { maximumFractionDigits: d }).format(n);
export const fmtPct = (l: Locale, lf: number) => nf(l, "p", { style: "percent", maximumFractionDigits: 0 }).format(lf);
export function hhmm(t: number): string {
  const x = Math.max(0, t), h = Math.floor(x), m = Math.floor((x - h) * 60);
  return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function useFmt() {
  const { locale } = useLocale();
  return useMemo(() => ({
    int: (n: number) => fmtInt(locale, n), num: (n: number, d = 2) => fmtNum(locale, n, d), pct: (lf: number) => fmtPct(locale, lf),
    station: (s: Pick<Station, "name_en" | "name_ar"> | undefined | null) => (!s ? "—" : locale === "ar" && s.name_ar ? s.name_ar : s.name_en),
    event: (e: EventInfo) => (locale === "ar" && e.name_ar ? e.name_ar : e.name),
    venue: (e: EventInfo) => (locale === "ar" && e.venue_ar ? e.venue_ar : e.venue),
  }), [locale]);
}

/** Numbers and times inside right-to-left text keep their own direction. */
export function N({ children, className }: { children: React.ReactNode; className?: string }) {
  return <bdi className={className ? `num ${className}` : "num"}>{children}</bdi>;
}

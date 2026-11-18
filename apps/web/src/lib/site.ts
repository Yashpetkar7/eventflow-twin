// The public address a phone can open. The booth kiosk runs on localhost with no network, so a QR code there must
// point at the public site; anywhere else (the public site, a preview) the page's own origin is right.
export const PUBLIC_SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://eventflow-twin-roan.vercel.app").replace(/\/$/, "");

export function publicOrigin(): string {
  if (typeof window === "undefined") return PUBLIC_SITE;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost") ? PUBLIC_SITE : window.location.origin;
}

/** The rider page for one event, station and hour (the link /travel already understands). Nothing about the visitor
 *  is in it: no preferences, no session. */
export function travelLink(event: string, station: string, hour: number, locale: "en" | "ar"): string {
  const p = new URLSearchParams({ event, station, hour: String(Math.max(5, Math.min(23, Math.floor(hour)))), ...(locale === "ar" ? { lang: "ar" } : {}) });
  return `${publicOrigin()}/travel?${p}`;
}

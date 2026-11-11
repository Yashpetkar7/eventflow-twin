"use client";
// Kiosk mode (?kiosk=1): touch-first booth build. Read once; only used in client-only components.
const DEFAULT_IDLE_MS = 60_000;

/** Idle timeout before resetting for the next visitor: 60 s, or ?idle=<seconds> (5–600) for rehearsals and tests. */
export function idleMs(): number {
  if (typeof window === "undefined") return DEFAULT_IDLE_MS;
  const v = Number(new URLSearchParams(window.location.search).get("idle"));
  return Number.isFinite(v) && v >= 5 && v <= 600 ? v * 1000 : DEFAULT_IDLE_MS;
}

export function isKiosk(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("kiosk") === "1";
}

/** Lock the page down for unattended touch use. Returns a cleanup function. */
export function lockDown(): () => void {
  const root = document.documentElement;
  root.dataset.kiosk = "1";
  const noMenu = (e: Event) => e.preventDefault();
  const noPinch = (e: TouchEvent) => { if (e.touches.length > 1 && !(e.target as Element)?.closest?.("[data-map]")) e.preventDefault(); };
  document.addEventListener("contextmenu", noMenu);
  document.addEventListener("touchmove", noPinch, { passive: false });
  return () => {
    delete root.dataset.kiosk;
    document.removeEventListener("contextmenu", noMenu);
    document.removeEventListener("touchmove", noPinch);
  };
}

export async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch { /* kiosk browsers often run full-screen already; ignore */ }
}

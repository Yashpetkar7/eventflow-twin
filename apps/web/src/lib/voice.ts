// Voice input for the kiosk (decision #156). The browser turns speech into text; the text lands in the input field and
// the visitor sends it, so a misheard sentence is never acted on. Where the browser can do it on the device, that is
// used and the booth needs no network; otherwise the browser's own online service is used only while online, and the
// screen says so. With neither, or with ?voice=0, there is no microphone button: the keyboard is always there.
// The transcript is untrusted text like anything typed: the API screens it and never follows it.
import { useCallback, useEffect, useRef, useState } from "react";

interface Rec {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type RecClass = (new () => Rec) & { available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> };
export type VoiceMode = "device" | "online" | "off";
const LANG = { en: "en-GB", ar: "ar-AE" } as const;

function recClass(): RecClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecClass; webkitSpeechRecognition?: RecClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoice(lang: "en" | "ar", onText: (text: string) => void) {
  const [mode, setMode] = useState<VoiceMode>("off");
  const [listening, setListening] = useState(false);
  const [failed, setFailed] = useState(false);
  const rec = useRef<Rec | null>(null);

  useEffect(() => {
    const R = recClass();
    let live = true;
    const decide = async () => {
      if (!R || new URLSearchParams(window.location.search).get("voice") === "0") return "off" as const;
      try { if (R.available && (await R.available({ langs: [LANG[lang]], processLocally: true })) === "available") return "device" as const; } catch { /* older browsers: no on-device check */ }
      return navigator.onLine ? "online" as const : "off" as const;
    };
    void decide().then((m) => { if (live) setMode(m); });
    return () => { live = false; };
  }, [lang]);
  useEffect(() => () => { try { rec.current?.abort(); } catch { /* already stopped */ } }, []);

  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* already stopped */ } }, []);
  const start = useCallback(() => {
    const R = recClass();
    if (!R || mode === "off") return;
    try {
      const r = new R();
      r.lang = LANG[lang]; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      if (mode === "device") r.processLocally = true;
      r.onresult = (e) => { let s = ""; for (let i = 0; i < e.results.length; i++) s += e.results[i][0]?.transcript ?? ""; onText(s.trim()); };
      r.onerror = (e) => { if (e.error !== "aborted" && e.error !== "no-speech") setFailed(true); setListening(false); };
      r.onend = () => setListening(false);
      rec.current = r;
      setFailed(false); setListening(true);
      r.start();
    } catch {
      setFailed(true); setListening(false);
    }
  }, [lang, mode, onText]);

  return { mode, listening, failed, start, stop };
}

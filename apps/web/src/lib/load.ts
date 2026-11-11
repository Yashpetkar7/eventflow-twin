// Load-factor helpers shared by the map, heat strip and inspector.
// Colour is never the only cue: every over-threshold cell also gets a ring/outline and a % label.

export const COMFORT = 0.85;

export type Band = "ok" | "warn" | "risk";

export function band(lf: number): Band {
  if (lf > COMFORT) return "risk";
  if (lf >= 0.6) return "warn";
  return "ok";
}

// RGB versions of the tokens in tokens.css (deck.gl needs arrays).
export const RGB: Record<Band, [number, number, number]> = {
  ok: [63, 143, 107],
  warn: [192, 138, 46],
  risk: [180, 69, 79],
};

/** Smooth colour ramp for the heat strip: pale green → sand → red. */
export function lfColor(lf: number, alpha = 1): string {
  const stops: [number, [number, number, number]][] = [
    [0, [231, 240, 234]],
    [0.6, [214, 190, 140]],
    [0.85, [192, 138, 46]],
    [1.2, [180, 69, 79]],
  ];
  const x = Math.max(0, Math.min(lf, 1.2));
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
  const [x0, c0] = stops[i];
  const [x1, c1] = stops[i + 1];
  const t = (x - x0) / (x1 - x0 || 1);
  const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

export const pct = (lf: number) => `${Math.round(lf * 100)}%`;
export const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

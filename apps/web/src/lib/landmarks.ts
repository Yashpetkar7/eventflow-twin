// Landmarks a visitor can jump to, and the corridor station each one is served by (DOM-side list: no three.js).
export const LANDMARK_KEYS = ["burj", "mall", "fountain", "address", "skyview", "mof", "et", "difc", "dwtc", "zaabeel", "frame", "arena", "canal", "arab"] as const;
export type LandmarkKey = (typeof LANDMARK_KEYS)[number];

/** The nearest modelled station in a straight line. Burj Al Arab has none: it stands 9 km beyond the corridor. */
export const LANDMARK_STATION: Partial<Record<LandmarkKey, string>> = {
  burj: "BKD", mall: "BKD", fountain: "BKD", address: "BKD", skyview: "BKD", mof: "EMT", et: "EMT", difc: "FIC", dwtc: "WTC",
  zaabeel: "MAX", frame: "MAX", arena: "BKD", canal: "BBY",
};

/** Label elements, shared between the DOM layer (creates them) and the canvas (positions them every frame). */
export const labelEls: Record<string, HTMLElement | null> = {};

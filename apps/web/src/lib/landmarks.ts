// Landmarks a visitor can jump to, and the corridor station each one is served by (DOM-side list: no three.js).
export const LANDMARK_KEYS = ["burj", "mall", "mof", "et", "difc", "dwtc", "frame", "canal"] as const;
export type LandmarkKey = (typeof LANDMARK_KEYS)[number];

export const LANDMARK_STATION: Record<LandmarkKey, string> = {
  burj: "BKD", mall: "BKD", mof: "EMT", et: "EMT", difc: "FIC", dwtc: "WTC", frame: "MAX", canal: "BBY",
};

/** Label elements, shared between the DOM layer (creates them) and the canvas (positions them every frame). */
export const labelEls: Record<string, HTMLElement | null> = {};

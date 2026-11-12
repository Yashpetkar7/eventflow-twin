// Day/night curve shared by the 3D sky and the 2D chrome. Kept free of three.js so the page shell stays light.
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 0 by day → 1 at night (dawn 05:30–06:50, dusk 18:20–19:35). */
export const nightFactor = (h: number) => (h < 12 ? 1 - smooth(5.5, 6.8, h) : smooth(18.3, 19.6, h));

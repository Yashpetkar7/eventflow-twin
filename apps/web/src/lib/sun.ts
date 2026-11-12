// Real sun position for the twin's site (docs/13 R2). No three.js here.
// NOAA's low-accuracy formulas: solar declination and equation of time from the fractional year — good to about
// a quarter of a degree, which is far finer than a shadow in the twin.

export const SITE = { lat: 25.2, lon: 55.27, tz: 4 };      // Sheikh Zayed Road corridor, Asia/Dubai (UTC+4, no DST)

/** Elevation above the horizon and azimuth clockwise from north, both in degrees, for a local date and clock hour. */
export function sunPosition(date: string, hour: number, site = SITE): { elevation: number; azimuth: number } {
  const [y, m, d] = date.split("-").map(Number);
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));   // minutes
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const solarMinutes = hour * 60 + eot + 4 * site.lon - 60 * site.tz;          // true solar time
  const ha = ((solarMinutes / 4 - 180) * Math.PI) / 180, lat = (site.lat * Math.PI) / 180;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha));
  const azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  return { elevation: (elevation * 180) / Math.PI, azimuth: ((azimuth * 180) / Math.PI + 360) % 360 };
}

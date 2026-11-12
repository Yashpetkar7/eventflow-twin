// Local frame of the 3D twin (see scripts/scene_frame.py): real metres, corridor along +x, sea side +z.
export interface Frame { lat0: number; lon0: number; m_lat: number; m_lon: number; ux: number; uy: number }

export function project(f: Frame, lat: number, lon: number): [number, number] {
  const e = (lon - f.lon0) * f.m_lon, n = (lat - f.lat0) * f.m_lat;
  return [e * f.ux + n * f.uy, e * f.uy - n * f.ux];
}

/** Unit vector in the local frame for a compass bearing (degrees clockwise from north). */
export function compass(f: Frame, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180, e = Math.sin(a), n = Math.cos(a);
  return [e * f.ux + n * f.uy, e * f.uy - n * f.ux];
}

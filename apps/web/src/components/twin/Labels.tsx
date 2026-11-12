"use client";
// Positions the HTML labels (created by components/LabelLayer.tsx) over the canvas every frame, straight to the DOM.
// Labels never sit on top of the HUD, KPI chips or the bottom controls: they step aside or hide.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { fmtPct, useLocale } from "@/lib/i18n";
import { labelEls as els } from "@/lib/landmarks";
import { lfAt, useTwin } from "@/lib/store";
import type { StationPlace } from "./Metro";
import { live, type LandmarkSpot } from "./sceneData";

const ALWAYS = new Set(["burj", "mof"]);           // the two landmark labels shown in the wide views

type Box = [number, number, number, number];       // centre x, centre y, width, height (px, in the view)

export function LabelProjector({ places, spots }: { places: StationPlace[]; spots: LandmarkSpot[] }) {
  const { camera, size, gl } = useThree();
  const { locale } = useLocale();
  const v = useRef(new THREE.Vector3());
  const last = useRef<Record<string, string>>({});
  const dims = useRef<Record<string, [number, number]>>({});
  const blocked = useRef<{ at: number; boxes: Box[] }>({ at: -1, boxes: [] });
  const scenario = useTwin((s) => s.forecast?.run_id);
  useEffect(() => { last.current = {}; dims.current = {}; blocked.current.at = -1; }, [locale, scenario, size.width, size.height]);

  useFrame((state) => {
    const s = useTwin.getState();
    if (!s.layers.labels) return;
    // overlay panels (HUD, KPI chips, legend, camera bar, map controls): re-measured twice a second
    if (state.clock.elapsedTime - blocked.current.at > 0.5) {
      const host = gl.domElement.closest(".view");
      const hr = host?.getBoundingClientRect();
      blocked.current.boxes = hr ? [...host!.querySelectorAll<HTMLElement>("[data-overlay]")].map((el) => {
        const r = el.getBoundingClientRect();
        return [r.left - hr.left + r.width / 2, r.top - hr.top + r.height / 2, r.width, r.height] as Box;
      }).filter((b) => b[2] > 0) : [];
      blocked.current.at = state.clock.elapsedTime;
    }
    const hit = (list: Box[], x: number, y: number, w: number, h: number, pad: number) => list.some((b) => Math.abs(b[0] - x) < (b[2] + w) / 2 + pad && Math.abs(b[1] - y) < (b[3] + h) / 2 + pad);
    const placed: Box[] = [];
    const place = (key: string, x: number, y: number, z: number, cls?: string) => {
      const el = els[key];
      if (!el) return;
      v.current.set(x, y, z).project(camera);
      const p = v.current;
      let off = p.z > 1 || p.x < -1.15 || p.x > 1.15 || p.y < -1.2 || p.y > 1.2;
      let sx = (p.x + 1) / 2 * size.width, sy = (1 - p.y) / 2 * size.height;
      if (!off) {
        const w = (dims.current[key] ??= [el.offsetWidth || 120, el.offsetHeight || 24])[0], h = dims.current[key][1];
        sx = Math.max(w / 2 + 6, Math.min(size.width - w / 2 - 6, sx));          // keep the whole label inside the view
        sy = Math.max(h + 6, sy);
        for (let n = 0; n < 6 && hit(placed, sx, sy - h / 2, w, h, 3); n++) sy -= h + 4;   // step up past other labels
        if (hit(blocked.current.boxes, sx, sy - h / 2, w, h, 2)) off = true;        // never over the HUD or the controls
        else placed.push([sx, sy - h / 2, w, h]);
      }
      const tr = off ? "translate(-9999px,-9999px)" : `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-100%)`;
      if (last.current[`${key}t`] !== tr) { el.style.transform = tr; last.current[`${key}t`] = tr; }
      if (cls !== undefined && last.current[`${key}c`] !== cls) { el.className = cls; last.current[`${key}c`] = cls; }
    };
    const thr = s.cur?.thr ?? s.threshold;
    for (const p of places) {
      const lf = lfAt(s.cur, p.id, s.time);
      place(p.id, p.x, live.columnTop[p.id] ?? 160, p.z, `tag${lf > thr ? " over" : ""}${p.id === s.selected ? " sel" : ""}`);
      const txt = fmtPct(locale, lf) + (lf > thr ? " ▲" : "");
      if (last.current[`${p.id}p`] !== txt) {
        const span = els[p.id]?.querySelector("[data-pct]");
        if (span) span.textContent = txt;
        last.current[`${p.id}p`] = txt;
        delete dims.current[p.id];                    // the label's width changed with its text: measure it again
      }
    }
    const near = live.camDist < 4200;                 // closer views name every landmark
    for (const l of spots) {
      const on = near || ALWAYS.has(l.key) || s.focus === l.key;
      place(`lm_${l.key}`, l.x, on ? l.h + 22 : -1e6, l.z, `tag lm${s.focus === l.key ? " sel" : ""}`);
    }
    if (live.venueOn) place("venue", live.venue.x, 960, live.venue.z);
    else place("venue", 0, -1e6, 0);
  });
  return null;
}

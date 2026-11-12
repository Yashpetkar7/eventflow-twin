"use client";
// HTML labels over the canvas (crisp text, correct Arabic shaping): stations with their live load, two
// landmarks and the event venue. Positions are projected every frame and written straight to the DOM.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTranslations } from "next-intl";
import * as THREE from "three";
import { fmtPct, useFmt, useLocale } from "@/lib/i18n";
import { lfAt, useTwin } from "@/lib/store";
import type { StationPlace } from "./Metro";
import { live, type SceneJson } from "./sceneData";

const els: Record<string, HTMLElement | null> = {};

export function LabelLayer() {
  const t = useTranslations();
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const event = useTwin((s) => s.forecast?.event);
  const show = useTwin((s) => s.layers.labels);
  const landmarks = useTwin((s) => s.layers.landmarks);
  const select = useTwin((s) => s.select);
  const eventName = !event ? "" : event.id === "custom" ? t("custom") : f.event(event);
  return (
    <div className="labels" hidden={!show}>
      {stations.map((s) => (
        <button key={s.id} type="button" className="tag" ref={(el) => { els[s.id] = el; }} onClick={() => select(s.id, { tab: true, fly: true })}>
          <b>{f.station(s)}</b> · <bdi className="num" data-pct />
        </button>
      ))}
      <div className="tag lm" ref={(el) => { els.burj = el; }} hidden={!landmarks}>{t("lm.burj")}</div>
      <div className="tag lm" ref={(el) => { els.mof = el; }} hidden={!landmarks}>{t("lm.mof")}</div>
      <div className="tag lm" ref={(el) => { els.venue = el; }}>{t("lm.venue", { name: eventName })}</div>
    </div>
  );
}

export function LabelProjector({ places, data }: { places: StationPlace[]; data: SceneJson }) {
  const { camera, size } = useThree();
  const { locale } = useLocale();
  const v = useRef(new THREE.Vector3());
  const last = useRef<Record<string, string>>({});
  const dims = useRef<Record<string, [number, number]>>({});
  const scenario = useTwin((s) => s.forecast?.run_id);
  useEffect(() => { last.current = {}; dims.current = {}; }, [locale, scenario, size.width]);

  useFrame(() => {
    const s = useTwin.getState();
    if (!s.layers.labels) return;
    const boxes: [number, number, number, number][] = [];       // placed labels: later ones step up to avoid overlap
    const place = (key: string, x: number, y: number, z: number, cls?: string) => {
      const el = els[key];
      if (!el) return;
      v.current.set(x, y, z).project(camera);
      const p = v.current;
      const off = p.z > 1 || p.x < -1.15 || p.x > 1.15 || p.y < -1.2 || p.y > 1.2;
      let sx = (p.x + 1) / 2 * size.width;
      let sy = (1 - p.y) / 2 * size.height;
      if (!off) {
        const w = (dims.current[key] ??= [el.offsetWidth || 120, el.offsetHeight || 24])[0], h = dims.current[key][1];
        sx = Math.max(w / 2 + 6, Math.min(size.width - w / 2 - 6, sx));          // keep the whole label inside the view
        sy = Math.max(h + 6, sy);
        for (let n = 0; n < 6 && boxes.some((b) => Math.abs(b[0] - sx) < (b[2] + w) / 2 + 4 && Math.abs(b[1] - sy) < (b[3] + h) / 2 + 2); n++) sy -= h + 4;
        boxes.push([sx, sy, w, h]);
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
      }
    }
    const lm = data.landmarks;
    if (lm.burj) place("burj", lm.burj.x, 850, lm.burj.z);
    else place("burj", 0, -1e6, 0);
    if (lm.mof) place("mof", lm.mof.x, 118, lm.mof.z);
    if (live.venueOn) place("venue", live.venue.x, 960, live.venue.z);
    else place("venue", 0, -1e6, 0);
  });
  return null;
}

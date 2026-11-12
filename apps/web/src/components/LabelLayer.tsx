"use client";
// HTML labels over the canvas (crisp text, correct Arabic shaping): stations with their live load, tappable
// landmarks and the event venue. The canvas positions them (twin/Labels.tsx); this file has no three.js in it.
import { useTranslations } from "next-intl";
import { useFmt } from "@/lib/i18n";
import { LANDMARK_KEYS, labelEls as els } from "@/lib/landmarks";
import { useTwin } from "@/lib/store";

export function LabelLayer() {
  const t = useTranslations();
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const event = useTwin((s) => s.forecast?.event);
  const show = useTwin((s) => s.layers.labels);
  const landmarks = useTwin((s) => s.layers.landmarks);
  const select = useTwin((s) => s.select);
  const focusLandmark = useTwin((s) => s.focusLandmark);
  const eventName = !event ? "" : event.id === "custom" ? t("custom") : f.event(event);
  return (
    <div className="labels" hidden={!show}>
      {stations.map((s) => (
        <button key={s.id} type="button" className="tag" ref={(el) => { els[s.id] = el; }} onClick={() => select(s.id, { tab: true, fly: true })}>
          <b>{f.station(s)}</b> · <bdi className="num" data-pct />
        </button>
      ))}
      {LANDMARK_KEYS.map((k) => (
        <button key={k} type="button" className="tag lm" hidden={!landmarks} ref={(el) => { els[`lm_${k}`] = el; }} onClick={() => focusLandmark(k)}>{t(`lmName.${k}`)}</button>
      ))}
      <div className="tag lm venue" ref={(el) => { els.venue = el; }}>{t("lm.venue", { name: eventName })}</div>
    </div>
  );
}

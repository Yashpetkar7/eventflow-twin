"use client";
// "Loading the 3D city… 6/16": shown while the realism scene streams its map sections in (a first visit on the public
// link downloads about 15 MB), so a half-built city never looks like a broken page. Reads the progress the scene
// publishes on <html data-scene-v2="a/b">; gone when every section is in, or after 90 s if the scene could not load.
import { useEffect, useState } from "react";
import { SCENE_V2 } from "@/lib/manifest";

export function SceneProgress({ text }: { text: string }) {
  const [p, setP] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!SCENE_V2) return;
    const t0 = Date.now();
    const iv = setInterval(() => {
      const [a, b] = (document.documentElement.dataset.sceneV2 ?? "0/0").split("/").map(Number);
      const done = (b > 0 && a >= b) || Date.now() - t0 > 90_000;
      setP(done ? null : [a, b]);
      if (done) clearInterval(iv);
    }, 400);
    return () => clearInterval(iv);
  }, []);
  if (!p) return null;
  return (
    <div className="sceneprog" role="status" data-testid="scene-progress">
      <span>{text}{p[1] > 0 && <b> {p[0]}/{p[1]}</b>}</span>
      <i style={{ width: `${p[1] > 0 ? (p[0] / p[1]) * 100 : 4}%` }} />
    </div>
  );
}

# 13 — Realism pass for the 3D twin (Fable 5.2) · owner: Atharva

Written Thu 12 Nov 2026. Goal: the Dubai twin should stop looking like Lego blocks and read as a real city, like the
reference <https://mumbai-3d.easemyhood.workers.dev> — while staying offline, at 60 fps, with the crowd data on top.

**Owner:** Atharva, running **Claude Code with Fable 5.2** (`claude --model claude-fable-5-2`, or `/model` inside
Claude Code) for R1–R5. R6 is checking work; Opus 5.5 is enough there.
**Order:** R1 → R2 → R3 → R4 → R5 → R6 (→ R7, added 13 Nov), one Claude Code session each, one branch and one PR each (`b/realism-r1` …).
**Deadline:** everything merged by **Mon 16 Nov evening**; freeze is Tue 17 at 12:00. If it runs late, stop after the
last merged prompt — each one is useful on its own, and the new scene stays behind `?scene=v2` until R6 says it is safe.

## 1. Why the reference looks real (what we found by reading it)
It is plain three.js — no Blender city, no game engine, no Google 3D Tiles. The realism comes from open data + shaders:

| Reference (Mumbai) | Our Dubai today |
|---|---|
| Ground = Sentinel-2 cloud-free satellite median (10 m) | Painted land-use texture, flat colours |
| ~594,000 buildings from Overture Maps; heights from Google Open Buildings + a tallest-towers list | 11,196 OSM buildings, **9,724 heights estimated** |
| Roof colour sampled from the satellite image per building | One colour per type |
| Facade shader per building type: window LOD (windows → stripes → mean tone), balconies, parapets, tanks, rooftop boxes | Simple window grid on uniform boxes |
| Haze injected into every material, real sun position, sky, ACES, bloom | Generic sky and fog |
| Sea shader with six wave bands, glint, roughness | Flat shiny blue plane |
| Baked ground AO; trees/mangroves from ESA WorldCover; ~32 × 48 km region | No contact shadows, few trees, 7.9 × 3.4 km strip |
| A few hand-built landmarks | Extruded footprints for landmarks |

**Blender's job (R4 and R5 only):** the landmarks people recognise (Burj Khalifa, Emirates Towers, Museum of the
Future, the Trade Centre tower), a Dubai Metro station, the viaduct, a train and palm trees. The rest of the city comes
from data and shaders — hand-modelling 11,000+ buildings is not realistic.

**Not used:** Google Photorealistic 3D Tiles — the most photographic option, but Google's terms forbid caching for
offline use, and the booth must run without internet.

**Known limits:** Google Open Buildings 2.5D does not cover the UAE, so Dubai heights are a mix of OSM, Overture,
3D-GloBFP and a checked list of named towers; the rest stay labelled *estimated*. Sentinel-2 is 10 m per pixel: sharp
from the overview, soft up close — R2 adds procedural ground detail for that.

## 2. Set up once (about 20 minutes)
1. `git checkout main && git pull`, then the normal start (`docs/12_TEAM_TASKS.md` §1). The UI tests need Google Chrome.
2. **Blender** (4.2 or newer) on your laptop, plus the MCP add-on: <https://github.com/ahujasid/blender-mcp> — install
   `addon.py` in Blender (Edit → Preferences → Add-ons → Install), then in Claude Code: `claude mcp add blender uvx blender-mcp`
   (needs `uv`). Before R4: open Blender, press **N** in the 3D view → **BlenderMCP** tab → **Connect / Start server**
   (port 9876). Check with `claude mcp list`. Leave the Poly Haven option off unless you need an HDRI.
3. No accounts are needed: Overture (public GeoParquet), Sentinel-2 via Microsoft Planetary Computer, ESA WorldCover,
   Copernicus DEM (AWS open data) and 3D-GloBFP (Zenodo) are free downloads. Downloads go to `data/raw/realism/`
   (git-ignored) — expect a few GB.
4. Windows: use `python tasks.py <task>` instead of `make`; Blender MCP works the same.

## 3. How to run each prompt
Start a fresh Claude Code session with Fable 5.2, paste **the common rules (§4) followed by one prompt (§5)**, and let
it run to the end. Check its screenshots yourself in the browser before opening the PR. Post the before/after pair in
the team chat. Krishna or Yash reviews; merge when CI is green.

## 4. Common rules — paste at the top of every prompt
```text
COMMON RULES — EventFlow Twin realism pass (repo: eventflow-twin, work on a new branch b/realism-rN from main, PR into main)
- Read CLAUDE.md, docs/13_REALISM_FABLE_TASKS.md, apps/web/README.md, scripts/scene_frame.py, scripts/build_scene.py and apps/web/src/components/twin/*.tsx first.
- Visual target: https://mumbai-3d.easemyhood.workers.dev — open it in the browser, study the look (ground, facades, haze, water, landmarks). Use it ONLY as a visual reference: do not copy its code, shaders or data files; re-implement the techniques yourself.
- Hard rules: runs fully offline (everything baked into apps/web/public/, zero requests outside localhost); 60 fps at 1920×1080 on a recent laptop, ≥ 50 fps floor, the existing quality tiers still step down; no file > 15 MB in apps/web/public, total apps/web/public/geo ≤ 60 MB, never commit raw downloads (data/raw is git-ignored); no RTA logo or any brand logo on buildings, taxis or signs; the crowd/station overlays must stay readable on top of the city.
- Every dataset gets a provenance row (source, licence, date, count) in docs/metrics.md AND in the in-app About/credits panel. Estimated values stay labelled as estimated.
- Keep the Playwright tests (apps/web/tests/ui.spec.ts) and pytest green; add tests for what you add. Record non-trivial choices in docs/09_DECISIONS.md.
- After each visible change: screenshots of the same 5 camera presets at 10:00, 17:30 and 21:30, before vs after, into eval/results/ui/realism/, compared side by side with the reference site. Show them to me in the browser.
- Commit in small steps; open a pull request into main (do not push to main directly). Stop and tell me if a rule above cannot be met.
```

## 4b. The visitor kiosk shares your 3D — rules so the two never conflict (added 12 Nov, evening)
The booth now runs a separate **visitor kiosk** at `?kiosk=1` (`apps/web/src/components/kiosk/`, `src/app/kiosk.css`,
owner Krishna/Claude). It mounts the **same** `<TwinCanvas />` and `<LabelLayer />` as the workspace, so everything you
build inside the 3D scene appears in the kiosk automatically — `?kiosk=1&scene=v2` already shows your ring.
Paste these lines into the COMMON RULES block of every R-prompt (they are hard rules):

```text
KIOSK RULES (docs/13 §4b):
- Put every visual change INSIDE the 3D scene (apps/web/src/components/twin/*, scene data, shaders). Do not add new
  visible overlays only in Stage.tsx: the kiosk does not mount Stage.tsx. If you need an HTML overlay (legend, credits),
  make it a small component in apps/web/src/components/ with a `compact` prop, mount it in Stage.tsx, and tell Krishna —
  the kiosk team adds it to the kiosk.
- Do not edit apps/web/src/components/kiosk/*, apps/web/src/app/kiosk.css or the kiosk branch in Root.tsx.
- Keep these working (the kiosk calls them): store fields time, playing, selected, cam, sceneReady, glFailed, ready,
  base, cur, breaks, stations, events, scenario; actions setTime, setPlaying, setCam("overview"|"close"|"orbit"),
  select(id), selectEvent(id), patchScenario, runAgents, decide, clearPlans. Do not rename the label DOM
  (.labels, .tag, .tag.lm, .tag.venue, [data-pct]) — the kiosk styles and hides them.
- Camera presets must frame the corridor at ANY canvas aspect: in the kiosk the 3D view is the left ~67 % of a 1920×1080
  screen (about 1288×1080) during the steps and the full screen on the attract loop (slow "orbit" at 17:30).
- Credits: keep public/geo/v2/manifest.json → provenance[].source (name first, then details after a comma) and .licence
  filled; the kiosk footer shows the short source names directly (derived / internal rows are skipped).
- Before every PR, run BOTH:
    cd apps/web && npx playwright test                                   # workspace + kiosk (v1)
    cd apps/web && EFT_SCENE=v2 npx playwright test tests/kiosk.spec.ts  # kiosk on your scene
  and attach eval/results/ui/kiosk_v2/*.png to the PR. 50 fps floor applies to ?kiosk=1&scene=v2 too.
- **Since 12 Nov (decision #102) the kiosk shows v2 by default at quality tier 1**; `?kiosk=1&scene=v1` shows the corridor scene. The workspace still needs `?scene=v2`.
```

## 5. The prompts

### R1 — Real data bake (Fable 5.2)
```text
Task: replace our guessed city with real open data, baked offline.
1. Widen the scene: keep the corridor (scripts/scene_frame.py EXTENT) at full detail and add a context ring of about 20 km × 20 km around it (Downtown, Business Bay, DIFC, Za'abeel, the Creek, Jumeirah coast, the Gulf) at lower detail, loaded in chunks.
2. Buildings: Overture Maps buildings (latest release, e.g. 2026-10-21.0) for the bbox via the overturemaps CLI or DuckDB on the public GeoParquet. Height priority: OSM height → OSM building:levels × 3.3 m → Overture height/num_floors → 3D-GloBFP (Zenodo, Asia record; find the UAE tile in world_grid.shp) → config/landmark_heights.yaml (named towers with heights and a source URL each, e.g. Wikipedia "List of tallest buildings in Dubai") → seeded estimate (flagged estimated=true). Report the count per source.
3. Ground: Sentinel-2 L2A cloud-free median for 13 Oct–30 Nov 2025 (GITEX period) from Microsoft Planetary Computer STAC, 10 m, true colour, colour-graded to a warm desert tone like the reference; chunked JPEG/KTX2 tiles + one low-res overview.
4. Masks: ESA WorldCover 2021 (trees, water, bare/sand, built) and Copernicus DEM GLO-30 resampled; water outline from OSM/Overture.
5. Per building: roof colour sampled from the satellite image under the footprint; a type class (glass tower, residential mid-rise, villa, mall/low-rise, industrial/warehouse, mosque, stadium) from Overture/OSM tags and size.
6. Bake ambient occlusion from the footprints into a ground AO texture.
Write scripts/fetch_realism_data.py (downloads into data/raw/realism/) and extend scripts/build_scene.py to emit a chunked manifest under apps/web/public/geo/. Done when: `python scripts/build_scene.py` reproduces the bake from data/raw, the counts table is in docs/metrics.md, and the old scene still loads while the new one is behind ?scene=v2.
```

### R2 — Light, atmosphere, ground and sea (Fable 5.2)
```text
Task: make the light and the air look like Dubai, using the R1 bake (behind ?scene=v2).
- Real sun position for 25.20 N, 55.27 E on the scenario date and clock time (solar declination + equation of time); drive the sky, the directional light, colour temperature and shadow direction from it; golden hour and night must look right.
- Environment map from the sky (PMREM) so glass and water reflect the sky.
- Aerial perspective: inject one haze function into every material (onBeforeCompile): density rising with distance, warm haze towards the sun, dusty desert tint by day, darker at night. Distant towers fade like the reference.
- Tone mapping: ACES (or AgX if it looks better — show both), correct exposure per time of day, bloom only for night lights.
- Ground shader: satellite colour + baked AO + mask-driven detail noise (sand ripple on bare land, grass/tree texture in parks, darker asphalt where roads are) so close-ups are not blurry; road ribbons with lane markings.
- Sea (Arabian Gulf) and Dubai Water Canal/Creek: multi-band wave normals that fade with distance, Fresnel, sun glint, shallow turquoise near the coast from distance-to-shore, soft shore foam.
- Shadows: cascaded shadow maps across the corridor; keep the quality tiers.
Done when: the before/after screenshots at 10:00 / 17:30 / 21:30 clearly show haze, a believable sea, and ground with real texture; fps budget met.
```

### R3 — Buildings that stop looking like Lego (Fable 5.2)
```text
Task: a procedural building system per type, like the reference, from the R1 classes (behind ?scene=v2).
- Geometry in a web worker, per chunk: footprint extrusion with podium + tower split for tall buildings (setbacks above the podium), parapets, roof shapes (flat, pitched for villas), rooftop plant boxes, AC units, water tanks, helipads on towers > 150 m, crowns on the tallest.
- Facade shader per type: storey height and window grid from building height; glass curtain wall (reflects the env map, slight blue-green tint, mullions) for towers; beige/sand concrete with balconies and window bands for residential; blank walls + loading doors for warehouses; screen patterns on some low-rises; per-building colour variation from a seed. Level of detail: single windows → column stripes → mean tone with distance (no shimmer).
- Roofs use the satellite-sampled colour from R1.
- Night: random lit windows (warmer in homes, cooler in offices), lit crowns on towers, streetlight glow on roads.
- Contact shadows at the base (from the AO bake).
Done when: the close-up preset on Emirates Towers / World Trade Centre and the overview both read as a real city in screenshots; draw calls and fps in budget.
```

### R4 — Hero landmarks and metro in Blender (Fable 5.2 + Blender MCP)
```text
Task: hand-model the landmarks visitors recognise, in Blender via the Blender MCP. Blender is running with the MCP server started; check the connection with get_objects_summary first and inspect the scene before changing anything.
Models (stylised but accurate in shape and proportion, from public dimensions; no logos, signage or calligraphy text):
  Burj Khalifa (828 m, Y-shaped setbacks, spire), Jumeirah Emirates Towers (two triangular towers, 355 m / 309 m), Museum of the Future (torus on a green mound, facade pattern as a texture), Dubai World Trade Centre / Sheikh Rashid Tower, Dubai Frame (if inside the context ring), one Dubai Metro Red Line elevated station (shell-shaped roof) used as the template for the six corridor stations, an elevated viaduct segment, and a 5-car metro train.
For each: clean low-poly mesh (budget: Burj Khalifa ≤ 60k triangles, others ≤ 25k, station ≤ 15k, train ≤ 8k), PBR materials (glass, steel, concrete), baked AO, an LOD1 at about 25 %, export glTF with meshopt or Draco + KTX2 textures to apps/web/public/models/. Render a Blender preview of each to eval/results/ui/realism/blender/ and show me before exporting.
Place them by lat/lon through scripts/scene_frame.py, hide the extruded footprint each one replaces (by building id), keep the station markers and labels on top. Update Landmarks.tsx and the landmark focus buttons. Note in docs/09_DECISIONS.md that these are approximations, not survey models.
```

### R5 — Life and detail (Fable 5.2, Blender for the palms)
```text
Task: the small things that sell realism, all instanced and cheap (behind ?scene=v2).
- Date palms along Sheikh Zayed Road medians and in parks (OSM natural=tree + WorldCover tree mask), 3–4 palm variants made in Blender via the MCP (≤ 1.5k triangles each), wind sway in the vertex shader.
- Traffic: instanced cars, taxis (cream body with coloured roof, no logos), buses along the road ribbons, density following the existing road-pressure proxy; headlights and tail lights at night.
- Metro trains from R4 running on the viaduct on the GTFS timetable we already use.
- Streetlights (instanced, emissive at night), road markings, pedestrian bridges near stations where OSM has them.
- The crowd overlay stays the hero: check it reads clearly over the new city at every time of day; adjust overlay colours or outlines if needed.
Done when: the guided demo runs end to end with all of this on, fps budget met, and the quality tier turns the extras off first.
```

### R6 — Verify and switch on (Opus 5.5 is enough)
```text
Task: prove the realism pass is booth-ready and decide whether ?scene=v2 becomes the default.
- Run all Playwright tests, pytest, `python -m eval.gate`, `npx tsc --noEmit`, eslint; fix failures.
- Measure: fps per camera preset at 1920×1080, a 30-minute soak (heap growth ≤ 10 %), the offline network check (0 requests outside localhost), total size of apps/web/public and the largest file; run `vercel dev --local` (docs/DEPLOY.md) to confirm the hosted build still works.
- `python scripts/ui_metrics.py` → docs/metrics.md; the in-app credits panel lists every dataset.
- Retake the final screenshots (`node apps/web/tests/final_shots.mjs`) for the poster.
- Make v2 the default only if every check passes; otherwise keep v1 as default and list exactly what blocks v2.
Report what changed, the numbers, and anything not verified.
```

### R7 — Frame rate at full quality (Fable 5.2) — done 13 Nov, decision #103
After R6 the kiosk had to be held at quality tier 1 (#102). R7 makes the scene cheaper to draw without changing what is
drawn: the shadow map is redrawn only when the sun, the view or a caster changes; palms and cars have levels of detail;
the ground is drawn last. Numbers: `docs/metrics.md` (R7) and `eval/results/ui/realism_r7/`. Each change has a switch
(`apps/web/src/components/twin/perf.ts`): `?scene=v2&r7off=shadow,palms,cars,order`, and `&r7on=tiles` for the optional
building tiles.

**R7 was measured on a MacBook, whose GPU is much faster than the booth laptop's, so the kiosk is still held at tier 1.**

#### To switch the kiosk to tier 0 (Atharva, on the Windows booth laptop)
> **Update 13 Nov, decision #108:** the kiosk now starts at tier 0 everywhere and steps down by itself under 50 fps, so
> nothing has to be switched by hand. Still run the measurement below and report the tier it ends on and the fps; skip
> the `MIN_TIER` edit (use the build as it is).

Mains power, OneDrive paused, every other browser window and 3D page closed.
```text
git checkout main && git pull
# 1. apps/web/src/lib/manifest.ts — one line, temporarily:
#      export const MIN_TIER: 0 | 1 = SCENE_V2 && VISITOR_KIOSK ? 1 : 0;      becomes      export const MIN_TIER: 0 | 1 = 0;
python tasks.py api                                   # terminal 1, leave it running
cd apps/web && npm run build && npm run start -- -p 3100        # terminal 2, leave it running
# terminal 3, in apps/web — run the first line FIVE times:
node tests/kiosk_fps.mjs http://localhost:3100 v2 realism_r7/kiosk_fps_tier0_windows.json
node tests/r7_fps.mjs windows_after http://localhost:3100
set EFT_WEB_PORT=3100&& npx playwright test tests/ui.spec.ts -g "realism"      # cmd; in PowerShell: $env:EFT_WEB_PORT=3100; npx playwright test …
```
- **Pass** = all five kiosk lines print `tier 0` and `min` ≥ 55, and both "realism" tests pass (50 fps floor on every preset).
  Then keep the `MIN_TIER` line at 0, update its comment and the test "kiosk: the realism scene is its default, held at
  quality tier 1 …" in `apps/web/tests/kiosk.spec.ts` (it expects tier 1), add one decision entry with the five numbers, and
  open a PR with the two new files from `eval/results/ui/realism_r7/`. The automatic step-down under 40 fps stays.
- **Not passed** = `git checkout apps/web/src/lib/manifest.ts`, the kiosk stays at tier 1, and send Krishna the two result
  files. To see which change matters on that laptop, run for example
  `node tests/r7_fps.mjs windows_no_shadow_cache http://localhost:3100 "r7off=shadow"` (also `r7off=palms`, `r7off=cars`,
  `r7off=order`, and `r7on=tiles`, which was neutral on the MacBook but may help an Intel GPU).

### R8–R10 — status on 13 Nov (decision #114)
**Done on `k/realism-r8-r10` (shaders and overlays, no Blender, no new data):** rooms behind the windows, a curtain wall
on the landmark towers with the Burj Khalifa's lights after dark, drifting cloud shadows, a vignette, lamp pools on
Sheikh Zayed Road, figures at the station entrances driven by the simulator, larger kiosk labels. Before and after:
`node apps/web/tests/r10_shots.mjs <label> <base url>` → `eval/results/ui/realism_r10/`.

**Still open — needs a laptop with Blender (Atharva):**
```text
R8 — landmark geometry. Read CLAUDE.md, sections 4 and 4b above, R4, scripts/blender/build_models.py and
apps/web/src/components/twin/Landmarks.tsx. Branch b/realism-r8-landmarks from main.
Rebuild in scripts/blender/build_models.py (headless Blender): Burj Khalifa (finer setbacks, vertical fins, podium),
Emirates Towers (crown slats, facade bands, podium), Trade Centre tower (deep honeycomb, crown), Dubai Frame (lattice).
Add: Dubai Mall block with the Burj lake and a fountain ring, DIFC Gate, 10 correct silhouettes for the tallest towers
between Trade Centre and Business Bay (heights and a source each in config/landmark_heights.yaml).
Up to 25k triangles each (Burj Khalifa 60k), ambient occlusion in the vertex colours as now, LOD1 at 25 %. Keep the
material slot names: the web app's curtain wall (facade.ts, curtainWall) already draws storeys and lit floors on the
"glass" slot, so model the shape, not the windows. No logos, signage or calligraphy. Hide the footprints replaced.
Done when: node tests/r10_shots.mjs shows them at 10:00, 17:30 and 21:30, r7_fps.mjs loses no more than 5 %, all
Playwright tests pass, and a decision entry says these are approximations. Pull request to main; no deploy.
```
**Still open — needs the raw OpenStreetMap extract (`python tasks.py osm`):**
```text
R9b — street level. Read sections 4 and 4b above, R5, scripts/realism_bake.py and atmosphere.ts (groundMaterial).
Branch b/realism-r9-streets from main. Inside the corridor only (about 400 m either side of Sheikh Zayed Road and
around the six stations): bake pavements, kerbs, medians, plots and car parks from OpenStreetMap polygons into a
ground detail atlas at about 0.5 m per pixel and blend it in groundMaterial where the camera is close; crossings and
bus bays; station plazas; instanced parked cars. All of it off at quality tier 1. The figures at the stations exist
already (Live.tsx, Waiting): put the plazas under them.
Done when: before and after pictures, r7_fps.mjs on the booth laptop at or above today's kiosk median, the offline
check still at 0 outside requests, all Playwright tests pass. Pull request to main; no deploy.
```

## 6. Hand-offs
- **Yash:** after R6, retake C6 (`node apps/web/tests/final_shots.mjs`) — and C4 (touch monitor) must be re-checked on the
  new scene, because fps on the monitor is what matters at the booth.
- **Krishna:** poster images and, if the nomination has not gone out yet, regenerate it with
  `python submission/tools/fill_template.py <draft.pdf> submission/EventFlow_Twin_RTA_Nomination_v2_DRAFT.pdf`.
- **Atharva's other tasks** (`docs/12_TEAM_TASKS.md`): the gold-set review is about an hour; the live Claude run waits
  for the API key anyway. Fit them around R1–R6.

## Sources
- Reference: <https://mumbai-3d.easemyhood.workers.dev> (About panel: Overture 2026-10-21.0, Copernicus DEM GLO-30,
  Sentinel-2 L2A median, Google Open Buildings 2.5D, ESA WorldCover 2021, Wikipedia tallest buildings).
- Google Open Buildings 2.5D coverage (Africa, South/South-East Asia, Latin America):
  <https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1>
- Overture buildings: <https://docs.overturemaps.org/guides/buildings>
- 3D-GloBFP: <https://essd.copernicus.org/articles/16/5357/2024/> · <https://zenodo.org/records/15487006>
- Google Map Tiles API policies (no offline caching): <https://developers.google.com/maps/documentation/tile/policies>
- Blender MCP: <https://github.com/ahujasid/blender-mcp>

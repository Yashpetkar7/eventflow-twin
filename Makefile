PY ?= python3
# Windows: use `python tasks.py <target>` (same targets, no make needed).
.PHONY: synth ingest features baseline train api web eval eval-fast gate demo test osm scene cache ui-test

synth:      ; $(PY) scripts/synth.py
ingest:     ; $(PY) scripts/ingest.py          # implemented in Phase 1
features:   ; @echo "implemented in Phase 1-2"
baseline:   ; $(PY) scripts/baseline.py
train:      ; $(PY) scripts/baseline.py --model lgbm
api:        ; $(PY) -m uvicorn apps.api.eventflow.main:app --reload --port 8000
web:        ; cd apps/web && npm run dev
eval-fast:  ; $(PY) scripts/baseline.py --fast && $(PY) -m eval.suites.simulator
eval:       ; $(PY) scripts/baseline.py && $(PY) -m eval.suites.simulator && $(PY) -m pytest -q
gate:       ; $(PY) -m eval.gate --thresholds eval/thresholds.yaml
demo:       ; $(PY) tasks.py demo              # offline cache + API + production web build, kiosk URL printed
osm:        ; $(PY) scripts/fetch_osm_corridor.py   # one-time, needs internet
scene:      ; $(PY) scripts/build_scene.py          # bake the offline 3D scene
cache:      ; $(PY) scripts/build_demo_cache.py
ui-test:    ; cd apps/web && npx playwright test    # screenshots → eval/results/ui, fps → eval/results/ui/fps.json
test:       ; $(PY) -m pytest -q

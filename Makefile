PY ?= python3
.PHONY: synth ingest features baseline train api web eval eval-fast gate demo test

synth:      ; $(PY) scripts/synth.py
ingest:     ; $(PY) scripts/ingest.py          # implemented in Phase 1
features:   ; @echo "implemented in Phase 1-2"
baseline:   ; $(PY) scripts/baseline.py
train:      ; $(PY) scripts/baseline.py --model lgbm
api:        ; uvicorn apps.api.eventflow.main:app --reload --port 8000
web:        ; cd apps/web && npm run dev
eval-fast:  ; $(PY) scripts/baseline.py --fast
eval:       ; $(PY) scripts/baseline.py && $(PY) -m pytest -q
gate:       ; $(PY) -m eval.gate --thresholds eval/thresholds.yaml
demo:       ; @echo "implemented in Phase 6 (API + web kiosk, DEMO_MODE=offline)"
test:       ; $(PY) -m pytest -q

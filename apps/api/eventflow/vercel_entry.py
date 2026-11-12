"""ASGI entrypoint for Vercel (see vercel.json and docs/DEPLOY.md).

Vercel routes https://<site>/api/* to this service and passes the full path, so the API is mounted under /api
(and also at / so a bare deployment of this service still answers).

On Vercel (VERCEL=1) the public-demo defaults apply unless set explicitly in the project's environment variables:
  EVENTFLOW_DATA_DIR=/tmp/eventflow   instances share no disk; the decision log and new plan-cache entries are temporary
  EVENTFLOW_STORAGE=ephemeral         the UI tells visitors their decisions are kept for the session only
  EVENTFLOW_RATE_LIMIT=60             POST requests per minute per client
  DEMO_MODE=offline                   plans come from the deterministic planner / shipped cache
They are set before the API module is imported, because it reads them at import time.
"""
import os

if os.environ.get("VERCEL") == "1":
    for key, value in {"EVENTFLOW_DATA_DIR": "/tmp/eventflow", "EVENTFLOW_STORAGE": "ephemeral",
                       "EVENTFLOW_RATE_LIMIT": "60", "DEMO_MODE": "offline"}.items():
        os.environ.setdefault(key, value)

from fastapi import FastAPI  # noqa: E402

from .main import app as api  # noqa: E402

app = FastAPI(title="EventFlow Twin", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)
app.mount("/", api)

# Vercel Live Demo (Roadmap Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put EventFlow Twin on one public URL (Next.js at `/`, FastAPI at `/api`) without breaking the offline booth build.

**Architecture:** The API becomes stateless: a request that names a forecast run also carries the parameters that produced it, so any serverless instance can rebuild the run (run ids are already deterministic hashes). Writable state (decision log, plan cache) moves behind one environment variable. One Vercel project deploys both parts with Vercel Services; the web app calls the API on the same origin.

**Tech Stack:** FastAPI + Pydantic v2 (Python 3.12+ on Vercel), Next.js 16, zustand, Playwright, Vercel Services (beta, all plans), Vercel CLI.

## Global Constraints

- The booth path must keep working unchanged: `python tasks.py demo`, `make ui-test` (16 tests) and `python -m pytest -q` (74 tests) stay green after every task.
- Numbers come only from the API; the UI adds no arithmetic.
- Contract changes bump `CONTRACT_VERSION` in `apps/api/eventflow/schemas.py`, then `python tasks.py contract`, then one entry in `docs/09_DECISIONS.md`.
- No secrets in the repo. No RTA logo. Public pages say "research prototype", "synthetic baseline", "not an RTA system".
- Vercel facts used here were read on 12 Nov 2026 (docs dated Aug 2026): Python 3.12 / 3.13 / 3.14; 500 MB Python bundle; 300 s max duration on Hobby; request and response bodies ≤ 4.5 MB; Services are **beta**. Re-read `https://vercel.com/docs/services` if a step behaves differently.
- A production deploy (`vercel deploy --prod`) publishes the site: do it only after Krishna confirms in chat.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/eventflow/schemas.py` (modify) | `SimulateRequest.forecast`, `AgentPlanRequest.forecast`; contract 1.6.0 |
| `apps/api/eventflow/main.py` (modify) | `build_run`, stateless `get_run`, data directory from env, rate limit, `storage` in `/healthz` |
| `apps/api/eventflow/ratelimit.py` (create) | Sliding-window limiter (pure, unit-tested) |
| `apps/api/eventflow/vercel_entry.py` (create) | ASGI app that serves the API under `/api` and `/` |
| `apps/api/eventflow/agents/planner.py` (modify) | Plan cache: read shipped cache, write to the data directory |
| `tests/test_stateless.py` (create) | Cold-instance, mismatch, storage, rate-limit, entrypoint tests |
| `apps/web/src/lib/requests.ts`, `store.ts`, `api.ts` (modify) | Send the forecast spec with every simulate / plan call; read `storage` |
| `apps/web/scripts/snapshot.mjs` (modify) | Same request bodies as the app |
| `apps/web/src/components/Root.tsx`, `ReportTab.tsx`, `src/messages/*.json`, `src/app/robots.ts` (modify/create) | Public-demo banner, "kept for this session only" note, no indexing |
| `apps/web/playwright.config.ts` (modify) | Run against a remote URL when `EFT_BASE_URL` is set |
| `vercel.json`, `.vercelignore`, `pyproject.toml` (create) | Services, routing, runtime-only Python dependencies |
| `scripts/smoke_live.py` (create) | End-to-end check of a deployed URL |
| `docs/DEPLOY.md` (create), `docs/09_DECISIONS.md` (modify) | How to deploy; decisions |

---

### Task 1: Stateless forecast runs

**Files:**
- Modify: `apps/api/eventflow/schemas.py`, `apps/api/eventflow/main.py`
- Test: `tests/test_stateless.py`

**Interfaces:**
- Consumes: `build_forecast(event_id, date, weekday, attendance, end, *, weather, exit_sigma_min, custom) -> dict` from `forecast.py`; `ForecastRequest` from `schemas.py`.
- Produces: `main.build_run(req: ForecastRequest) -> dict`; `main.get_run(run_id: str, spec: ForecastRequest | None = None) -> dict` (404 unknown id without spec, 409 spec does not hash to the id); request field `forecast` on `SimulateRequest` and `AgentPlanRequest`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_stateless.py`:

```python
"""Serverless readiness: any instance can serve any request (docs/11_MVP_ROADMAP.md, Phase 1)."""
import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main

SPEC = {"event_id": "dfw2026_d1", "attendance": 30000}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "decisions_log.jsonl")
    return TestClient(main.app)


def test_simulate_rebuilds_the_run_on_a_cold_instance(client):
    fc = client.post("/forecast", json=SPEC).json()
    warm = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    main._RUNS.clear()                                   # another instance: nothing in memory
    assert client.post("/simulate", json={"forecast_run_id": fc["run_id"]}).status_code == 404
    cold = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "scope": "corridor", "forecast": SPEC})
    assert cold.status_code == 200, cold.text
    assert cold.json()["summary"] == warm["summary"] and cold.json()["run_id"] == warm["run_id"]


def test_forecast_spec_must_match_the_run_id(client):
    fc = client.post("/forecast", json=SPEC).json()
    main._RUNS.clear()
    r = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": {"event_id": "gitex2025_d1"}})
    assert r.status_code == 409 and "does not match" in r.json()["detail"]


def test_agent_plan_on_a_cold_instance(client, tmp_path, monkeypatch):
    from apps.api.eventflow.agents import planner
    monkeypatch.setattr(planner, "CACHE", tmp_path / "cache")
    fc = client.post("/forecast", json={**SPEC, "attendance": 40000}).json()
    main._RUNS.clear()
    r = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor",
                                         "forecast": {**SPEC, "attendance": 40000}})
    assert r.status_code == 200 and r.json()["verify"]["all_matched"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_stateless.py -q`
Expected: 3 failed — the cold simulate returns 404 (and Pydantic ignores the unknown `forecast` field).

- [ ] **Step 3: Add the request field**

In `apps/api/eventflow/schemas.py`, change the version line and add one field to each request model:

```python
CONTRACT_VERSION = "1.6.0"   # 1.6.0: stateless runs — SimulateRequest.forecast / AgentPlanRequest.forecast rebuild a run on any instance · (keep the existing history after this)
```

```python
class SimulateRequest(BaseModel):
    forecast_run_id: str
    forecast: ForecastRequest | None = Field(
        None, description="The request that produced forecast_run_id. Lets an instance that has never seen the run rebuild it.")
    interventions: list[Intervention] = Field(default_factory=list)
    # … existing fields unchanged
```

```python
class AgentPlanRequest(BaseModel):
    forecast_run_id: str
    forecast: ForecastRequest | None = Field(None, description="As in SimulateRequest.forecast")
    # … existing fields unchanged
```

- [ ] **Step 4: Make `get_run` rebuild**

In `apps/api/eventflow/main.py` replace `get_run` and the body of `forecast`, and pass the spec through:

```python
def build_run(req: ForecastRequest) -> dict:
    """One place that turns a forecast request into a run (shared by /forecast and cold-instance rebuilds)."""
    try:
        return build_forecast(req.event_id, req.date, req.weekday, req.attendance, req.end_time,
                              weather=req.weather, exit_sigma_min=req.exit_sigma_min,
                              custom=req.custom_event.model_dump() if req.custom_event else None)
    except KeyError as e:
        raise HTTPException(404, f"Unknown event or station {e}")
    except ValueError as e:     # bad date string
        raise HTTPException(422, str(e))


def get_run(run_id: str, spec: ForecastRequest | None = None) -> dict:
    """The forecast run for `run_id`. Run ids are deterministic hashes of the request, so an instance that has
    never seen the run rebuilds it from `spec` and checks that it hashes to the same id."""
    run = _RUNS.get(run_id)
    if run is None and spec is not None:
        run = build_run(spec)
        if run["run_id"] != run_id:
            raise HTTPException(409, f"forecast does not match forecast_run_id '{run_id}' (it produces '{run['run_id']}')")
        _remember(run)
    if run is None:
        raise HTTPException(404, f"Unknown forecast_run_id '{run_id}'. Send `forecast` with the request, or POST /forecast again.")
    return run


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    run = build_run(req)
    _remember(run)
    return {**{k: v for k, v in run.items() if k != "demand"},
            "source": {"tool": "forecast", "run_id": run["run_id"]}}
```

```python
@app.post("/simulate", response_model=SimulateResponse)
def simulate_ep(req: SimulateRequest):
    get_run(req.forecast_run_id, req.forecast)          # rebuild first if this instance is cold
    return run_simulation(req.forecast_run_id, req.interventions, req.detail, req.threshold, req.scope)


@app.post("/agent/plan", response_model=AgentPlanResponse)
def agent_plan(req: AgentPlanRequest):
    from .agents.planner import make_plan
    run = get_run(req.forecast_run_id, req.forecast)
    plan = make_plan(run, req, run_simulation)
    with _LOCK:
        _PLANS[plan["plan_id"]] = plan
    return plan
```

- [ ] **Step 5: Run all API tests**

Run: `python -m pytest -q`
Expected: 77 passed (74 existing + 3 new). `tests/test_contract.py` fails until Step 6 — that is expected here.

- [ ] **Step 6: Re-export the contract**

Run: `python tasks.py contract && python -m pytest -q`
Expected: `contract 1.6.0: openapi.json + 12 fixtures`, then all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/eventflow/schemas.py apps/api/eventflow/main.py tests/test_stateless.py contract apps/web/src/lib/api-types.ts
git commit -m "api 1.6.0: stateless forecast runs (rebuild from the request on a cold instance)"
```

---

### Task 2: The web app sends the forecast spec

**Files:**
- Modify: `apps/web/src/lib/requests.ts`, `apps/web/src/lib/store.ts`, `apps/web/scripts/snapshot.mjs`
- Test: `apps/web/tests/ui.spec.ts`

**Interfaces:**
- Consumes: request field `forecast` (Task 1).
- Produces: `simulateBody(runId, interventions, threshold, forecast)` and `planBody(runId, applied, threshold, priority, locale, forecast)`; store field `forecastReq: ForecastRequest | null` (the body that produced `forecast`).

- [ ] **Step 1: Write the failing test**

Add to `apps/web/tests/ui.spec.ts`:

```ts
test("every simulate and plan request carries the forecast spec (stateless API)", async ({ page }) => {
  const bodies: { url: string; body: { forecast?: unknown } }[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/(simulate|agent\/plan)$/.test(r.url())) bodies.push({ url: r.url(), body: r.postDataJSON() }); });
  await open(page);
  await page.getByRole("button", { name: "Hot day" }).click();
  await idle(page);
  await page.getByRole("tab", { name: /AI plan/ }).click();
  await page.getByRole("button", { name: "Plan with AI agents" }).click();
  await expect(page.locator(".opt")).toHaveCount(3, { timeout: 20_000 });
  expect(bodies.length).toBeGreaterThan(2);
  for (const b of bodies) expect(b.body.forecast, b.url).toBeTruthy();
  expect(bodies.at(-1)!.body.forecast).toMatchObject({ weather: "hot" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx playwright test --grep "carries the forecast spec"`
Expected: FAIL — `b.body.forecast` is undefined.

- [ ] **Step 3: Extend the request builders**

In `apps/web/src/lib/requests.ts` replace the two builders:

```ts
export function simulateBody(runId: string, interventions: unknown[], threshold: number, forecast: S["ForecastRequest"]): S["SimulateRequest"] {
  return { forecast_run_id: runId, forecast, interventions, detail: true, threshold, scope: "corridor" } as S["SimulateRequest"];
}

export function planBody(runId: string, applied: unknown[], threshold: number, priority: Priority, locale: "en" | "ar", forecast: S["ForecastRequest"]): S["AgentPlanRequest"] {
  return { forecast_run_id: runId, forecast, locale, threshold, scope: "corridor", priority, applied } as S["AgentPlanRequest"];
}
```

- [ ] **Step 4: Keep the spec next to the forecast in the store**

In `apps/web/src/lib/store.ts`:
- add to `State`: `forecastReq: ForecastRequest | null;` (import the type from `./api`), initial value `null`;
- in `refresh`, build the body once and store it with the response:

```ts
const s = get();
const spec = opts.forecast || !s.forecast || !s.forecastReq ? forecastBody(s.scenario) : s.forecastReq;
const fc = opts.forecast || !s.forecast ? await api.forecast(spec, signal) : s.forecast;
// …
const patch: Partial<State> = { forecast: fc, forecastReq: spec, base, cur, flows, /* unchanged fields */ };
```

- pass the spec at every call site (five of them: two in `refresh`, one each in `schedulePreview`, `applyPlan`, `runAgents`), for example:

```ts
api.simulate(simulateBody(fc.run_id, [], get().threshold, spec), signal)
api.simulate(simulateBody(s.forecast.run_id, all, s.threshold, s.forecastReq!), previewAbort.signal)
planBody(s.forecast.run_id, mergeInterventions(s.applied.map((a) => a.ivs)), s.threshold, s.priority, locale, s.forecastReq!)
```

Add `export type ForecastRequest = S["ForecastRequest"];` to `apps/web/src/lib/api.ts` if it is not already exported.

- [ ] **Step 5: Same bodies in the snapshot script**

In `apps/web/scripts/snapshot.mjs`, keep the forecast body in a variable and pass it on:

```js
const spec = forecastBody({ eventId: ev.id, attendance: null, exitSigma: null, weather, custom });
const fc = await record("/forecast", spec);
await record("/simulate", simulateBody(fc.run_id, [], THR, spec));
// …
const plan = await record("/agent/plan", planBody(fc.run_id, [], THR, "balanced", locale, spec));
if (locale === "en" && plan.options[0]) await record("/simulate", simulateBody(fc.run_id, plan.options[0].interventions, THR, spec));
```

Run: `cd apps/web && npm run snapshot` (API running). Expected: `snapshot: 31 responses → public/cache/`.

- [ ] **Step 6: Run the UI tests**

Run: `cd apps/web && npx tsc --noEmit && npx playwright test`
Expected: 17 passed (16 existing + 1 new), including "API down: saved results keep the twin alive".

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib apps/web/scripts/snapshot.mjs apps/web/public/cache apps/web/tests/ui.spec.ts
git commit -m "web: send the forecast spec with every simulate and plan request"
```

---

### Task 3: Writable state behind one setting

**Files:**
- Modify: `apps/api/eventflow/main.py`, `apps/api/eventflow/agents/planner.py`, `apps/web/src/lib/api.ts`, `apps/web/src/components/ReportTab.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/ar.json`
- Test: `tests/test_stateless.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: environment variables `EVENTFLOW_DATA_DIR` (directory for the decision log and plan cache; default `<repo>/data`) and `EVENTFLOW_STORAGE` (`persistent` default, `ephemeral` on Vercel); `GET /healthz` → `{"ok": true, "contract": "...", "storage": "persistent" | "ephemeral"}`; `planner.CACHE_WRITE`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_stateless.py`:

```python
def test_healthz_reports_storage(client, monkeypatch):
    assert client.get("/healthz").json()["storage"] == "persistent"
    monkeypatch.setenv("EVENTFLOW_STORAGE", "ephemeral")
    assert client.get("/healthz").json()["storage"] == "ephemeral"


def test_plan_cache_reads_shipped_and_writes_to_data_dir(client, tmp_path, monkeypatch):
    from apps.api.eventflow.agents import planner
    shipped, writable = tmp_path / "shipped", tmp_path / "writable"
    monkeypatch.setattr(planner, "CACHE", shipped)
    monkeypatch.setattr(planner, "CACHE_WRITE", writable)
    monkeypatch.setenv("DEMO_MODE", "offline")
    fc = client.post("/forecast", json={**SPEC, "attendance": 40000}).json()
    first = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    assert not first["cached"] and list(writable.glob("plan_*.json")) and not shipped.exists()
    again = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    assert again["cached"] and again["options"] == first["options"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_stateless.py -q`
Expected: 2 failed (`KeyError: 'storage'`; `AttributeError: … has no attribute 'CACHE_WRITE'`).

- [ ] **Step 3: Data directory and storage flag in the API**

In `apps/api/eventflow/main.py` (add `import os`):

```python
# Writable state. Laptop / booth: <repo>/data (kept between runs). Serverless: a temp directory per instance —
# set EVENTFLOW_DATA_DIR=/tmp/eventflow and EVENTFLOW_STORAGE=ephemeral so the UI can say so.
DATA_DIR = Path(os.environ.get("EVENTFLOW_DATA_DIR") or ROOT / "data")
DECISIONS_LOG = DATA_DIR / "processed/decisions_log.jsonl"


@app.get("/healthz")
def healthz():
    return {"ok": True, "contract": CONTRACT_VERSION, "storage": os.environ.get("EVENTFLOW_STORAGE", "persistent")}
```

- [ ] **Step 4: Plan cache reads shipped entries, writes to the data directory**

In `apps/api/eventflow/agents/planner.py`:

```python
CACHE = ROOT / "data/demo_cache"                                        # shipped with the build (read)
CACHE_WRITE = Path(os.environ.get("EVENTFLOW_DATA_DIR") or ROOT / "data") / "demo_cache"   # new entries (write)
```

(add `from pathlib import Path`), and in `make_plan` replace the cache lookup and the write:

```python
    name = f"{plan_id}.json"
    offline = os.environ.get("DEMO_MODE", "offline") == "offline"
    if offline:
        for folder in (CACHE_WRITE, CACHE):
            try:
                return {**json.loads((folder / name).read_text(encoding="utf-8")), "cached": True}
            except (OSError, json.JSONDecodeError):
                continue                    # missing or torn entry: try the next folder, else recompute
```

```python
    try:
        CACHE_WRITE.mkdir(parents=True, exist_ok=True)
        (CACHE_WRITE / name).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass                                # read-only filesystem: the plan is still returned
```

Existing tests monkeypatch `planner.CACHE` only; update `tests/test_api.py::test_agent_plan_numbers_come_from_the_simulator` and `::test_agent_plan_without_hotspot_recommends_nothing` to also set `monkeypatch.setattr(planner, "CACHE_WRITE", tmp_path / "cache")`, and `scripts/build_demo_cache.py` needs no change (it writes to the default folder, which is the shipped one on a laptop).

- [ ] **Step 5: Tell the visitor when decisions are not kept**

`apps/web/src/lib/api.ts`: `health: () => call<{ ok: boolean; contract: string; storage?: "persistent" | "ephemeral" }>("/healthz", undefined, { cache: false }),`

`apps/web/src/messages/en.json`, inside `"report"`: `"ephemeral": "Public demo: decisions are kept for this session only, not stored."`
`apps/web/src/messages/ar.json`, inside `"report"`: `"ephemeral": "عرض عام: تُحفظ القرارات لهذه الجلسة فقط ولا تُخزَّن."`

`apps/web/src/components/ReportTab.tsx`, next to the evidence state:

```tsx
const [storage, setStorage] = useState<string | undefined>();
useEffect(() => { api.health().then((h) => setStorage(h.storage)).catch(() => {}); }, []);
// … under the decision log list:
{storage === "ephemeral" && <div className="note" style={{ marginTop: 6 }}>{t("report.ephemeral")}</div>}
```

- [ ] **Step 6: Run everything**

Run: `python -m pytest -q && cd apps/web && npx tsc --noEmit && npx playwright test --grep "demo flow|guided demo"`
Expected: 79 passed; 2 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api tests apps/web/src
git commit -m "api: writable state behind EVENTFLOW_DATA_DIR; healthz reports storage; UI says when decisions are not kept"
```

---

### Task 4: Rate limit for the public API

**Files:**
- Create: `apps/api/eventflow/ratelimit.py`
- Modify: `apps/api/eventflow/main.py`
- Test: `tests/test_stateless.py`

**Interfaces:**
- Produces: `RateLimit(per_minute: int).allow(key: str, now: float) -> bool`; environment variable `EVENTFLOW_RATE_LIMIT` (POST requests per minute per client; unset = no limit, the booth default).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_stateless.py`:

```python
def test_rate_limit_sliding_window():
    from apps.api.eventflow.ratelimit import RateLimit
    rl = RateLimit(per_minute=3)
    assert [rl.allow("a", t) for t in (0, 1, 2, 3)] == [True, True, True, False]
    assert rl.allow("b", 3)                    # another client is not affected
    assert rl.allow("a", 61.5)                 # the first hits have left the window
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_stateless.py::test_rate_limit_sliding_window -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.eventflow.ratelimit'`.

- [ ] **Step 3: Implement**

Create `apps/api/eventflow/ratelimit.py`:

```python
"""Sliding-window request limiter for the public demo. Per instance, in memory: a courtesy limit that keeps one
visitor from hammering the planner, not a security boundary (use the platform firewall for that)."""
from __future__ import annotations

from collections import deque


class RateLimit:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float) -> bool:
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] >= 60.0:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        if len(self._hits) > 5000:             # bounded memory: forget idle clients
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] >= 60.0]:
                del self._hits[k]
        return True
```

In `apps/api/eventflow/main.py` (add `import time`), after the CORS middleware:

```python
_LIMIT = RateLimit(int(os.environ["EVENTFLOW_RATE_LIMIT"])) if os.environ.get("EVENTFLOW_RATE_LIMIT") else None


@app.middleware("http")
async def _rate_limit(request: Request, call_next):
    if _LIMIT is not None and request.method == "POST":
        client = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown")).split(",")[0].strip()
        if not _LIMIT.allow(client, time.monotonic()):
            return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again in a minute."})
    return await call_next(request)
```

with `from .ratelimit import RateLimit` in the imports.

- [ ] **Step 4: Run the tests**

Run: `python -m pytest -q`
Expected: 80 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/eventflow/ratelimit.py apps/api/eventflow/main.py tests/test_stateless.py
git commit -m "api: optional per-client rate limit for the public demo"
```

---

### Task 5: Vercel entrypoint, services and public-demo chrome

**Files:**
- Create: `apps/api/eventflow/vercel_entry.py`, `vercel.json`, `.vercelignore`, `pyproject.toml`, `apps/web/src/app/robots.ts`
- Modify: `apps/web/src/components/Root.tsx`, `apps/web/src/messages/en.json`, `apps/web/src/messages/ar.json`, `apps/web/playwright.config.ts`
- Test: `tests/test_stateless.py`

**Interfaces:**
- Consumes: `main.app`.
- Produces: `apps.api.eventflow.vercel_entry:app` (serves every API route under both `/api/...` and `/...`); build-time web variables `NEXT_PUBLIC_API_URL=/api`, `NEXT_PUBLIC_PUBLIC_DEMO=1`; Playwright variable `EFT_BASE_URL`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_stateless.py`:

```python
def test_vercel_entry_serves_the_api_with_and_without_the_prefix():
    from apps.api.eventflow.vercel_entry import app
    c = TestClient(app)
    assert c.get("/api/healthz").json()["ok"] and c.get("/healthz").json()["ok"]
    assert len(c.get("/api/stations").json()) == len(c.get("/stations").json()) > 6
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_stateless.py::test_vercel_entry_serves_the_api_with_and_without_the_prefix -q`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Entrypoint**

Create `apps/api/eventflow/vercel_entry.py`:

```python
"""ASGI entrypoint for Vercel. The platform routes https://<site>/api/* to this service; whether it forwards the
path with or without the /api prefix is a routing setting, so the API is mounted at both."""
from fastapi import FastAPI

from .main import app as api

app = FastAPI(title="EventFlow Twin", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)
app.mount("/", api)
```

Run: `python -m pytest -q` → Expected: 81 passed.

- [ ] **Step 4: Runtime-only dependencies and project files**

Create `pyproject.toml` (the hosted API does not need LightGBM, scikit-learn or pytest; the laptop keeps using `requirements.txt`):

```toml
[project]
name = "eventflow-twin-api"
version = "1.6.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi==0.162.4",
    "pydantic==2.14.3",
    "numpy==2.4.6",
    "pandas==3.1.1",
    "pyarrow==26.0.1",
    "PyYAML==6.0.3",
]

[tool.vercel]
entrypoint = "apps.api.eventflow.vercel_entry:app"
```

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "web": { "root": "apps/web/" },
    "api": { "root": "./", "entrypoint": "apps.api.eventflow.vercel_entry:app" }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "api" } },
    { "source": "/(.*)", "destination": { "service": "web" } }
  ]
}
```

Create `.vercelignore` (keeps the Python bundle small; none of these are read at run time):

```
.venv
.git
data/raw
data/processed
submission
exhibit
tests
eval/results/ui
eval/proofs
apps/web/node_modules
apps/web/.next
apps/web/tests
apps/web/reference
docs
*.zip
```

- [ ] **Step 5: Public-demo banner and no indexing**

`apps/web/src/messages/en.json`: `"publicDemo": "Public research demo by SP Jain students. Baseline demand is synthetic and scenario values are assumptions. Not an RTA system and not endorsed by RTA."`
`apps/web/src/messages/ar.json`: `"publicDemo": "عرض بحثي عام من طلاب إس بي جين. الطلب الأساسي تجريبي وقيم السيناريو افتراضية. ليس نظامًا تابعًا للهيئة ولا معتمدًا منها."`

`apps/web/src/components/Root.tsx`, above the API banner:

```tsx
{process.env.NEXT_PUBLIC_PUBLIC_DEMO === "1" && <div className="banner" role="note">{t("publicDemo")}</div>}
```

Create `apps/web/src/app/robots.ts`:

```ts
import type { MetadataRoute } from "next";

// The public demo is a research prototype: keep it out of search results.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
```

- [ ] **Step 6: Let Playwright target a deployed URL**

In `apps/web/playwright.config.ts`:

```ts
const remote = process.env.EFT_BASE_URL;          // e.g. a Vercel preview URL
export default defineConfig({
  // … unchanged
  use: { baseURL: remote ?? "http://localhost:3000", /* unchanged */ },
  webServer: remote ? undefined : [ /* the two local servers, unchanged */ ],
});
```

- [ ] **Step 7: Verify the services locally**

Run (needs the Vercel CLI: `npm i -g vercel`): `NEXT_PUBLIC_API_URL=/api vercel dev --local`
Then: `curl -s http://localhost:3000/api/healthz` → Expected: `{"ok":true,"contract":"1.6.0","storage":"persistent"}`
and open `http://localhost:3000` → the twin loads with live numbers.
If the build log shows Vercel installing `requirements.txt` instead of `pyproject.toml`, add `"installCommand": "pip install ."` to the `api` service and repeat. If the API answers 404 under `/api`, read `https://vercel.com/docs/services/routing` and adjust the rewrite — the entrypoint already accepts both path forms.

- [ ] **Step 8: Run both test suites and commit**

Run: `python -m pytest -q && cd apps/web && npx tsc --noEmit && npx eslint src tests scripts && npx playwright test`
Expected: 81 passed; lint clean; 17 passed.

```bash
git add apps/api/eventflow/vercel_entry.py vercel.json .vercelignore pyproject.toml apps/web tests/test_stateless.py
git commit -m "deploy: Vercel services (Next.js + FastAPI on one origin), public-demo banner, no indexing"
```

---

### Task 6: Preview deploy, smoke test, documentation

**Files:**
- Create: `scripts/smoke_live.py`, `docs/DEPLOY.md`
- Modify: `docs/09_DECISIONS.md`, `tasks.py`

**Interfaces:**
- Consumes: the deployed URL.
- Produces: `python scripts/smoke_live.py <base-url>` → exit code 0 and a one-line summary; `python tasks.py smoke <base-url>`.

- [ ] **Step 1: Write the smoke test**

Create `scripts/smoke_live.py`:

```python
"""End-to-end check of a deployed EventFlow Twin (standard library only).

    python scripts/smoke_live.py https://<deployment>.vercel.app

Walks the demo flow through the public API: forecast → simulate (sending the forecast spec, as a cold instance
needs) → agent plan → decision. Exits non-zero on the first failure."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def call(base: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "eventflow-smoke/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"FAIL {path}: HTTP {e.code} {e.read()[:300]!r}")


def main() -> None:
    base = sys.argv[1].rstrip("/") + "/api"
    health = call(base, "/healthz")
    assert health["ok"], health
    events = call(base, "/events")
    spec = {"event_id": events[0]["id"], "weather": "hot"}
    fc = call(base, "/forecast", spec)
    sim = call(base, "/simulate", {"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor", "detail": True})
    assert len(sim["hourly"]) == 6 * 24 and sim["source"]["tool"] == "simulate", "simulate shape"
    plan = call(base, "/agent/plan", {"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor"})
    assert plan["verify"]["all_matched"], "number verification failed"
    if plan["options"]:
        top = plan["options"][0]
        after = call(base, "/simulate", {"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor",
                                         "interventions": top["interventions"]})
        assert after["summary"] == top["summary"], "plan numbers differ from a fresh simulation"
        dec = call(base, "/decisions", {"plan_id": plan["plan_id"], "option_rank": 1, "decision": "reject", "user": "smoke-test",
                                        "option_title": top["title"], "forecast_run_id": fc["run_id"]})
        assert dec["logged"], dec
    print(f"OK {base}: contract {health['contract']}, storage {health.get('storage')}, "
          f"{len(events)} events, {len(plan['options'])} plan options, is_synthetic={fc['is_synthetic']}")


if __name__ == "__main__":
    main()
```

Add to `TASKS` in `tasks.py`: `"smoke": ("End-to-end check of a deployed URL: python tasks.py smoke https://…", [[PY, "scripts/smoke_live.py"]]),`

- [ ] **Step 2: Check the script against the laptop**

Run (API on :8000 behind the web dev server is not `/api`-prefixed, so start the Vercel entrypoint): `python -m uvicorn apps.api.eventflow.vercel_entry:app --port 8010 & sleep 2; python scripts/smoke_live.py http://localhost:8010; kill %1`
Expected: `OK http://localhost:8010/api: contract 1.6.0, storage persistent, 3 events, 3 plan options, is_synthetic=True`

- [ ] **Step 3: Preview deployment**

```bash
vercel link                       # choose the team and create project "eventflow-twin"
vercel env add NEXT_PUBLIC_API_URL preview       # value: /api
vercel env add NEXT_PUBLIC_PUBLIC_DEMO preview   # value: 1
vercel env add EVENTFLOW_DATA_DIR preview        # value: /tmp/eventflow
vercel env add EVENTFLOW_STORAGE preview         # value: ephemeral
vercel env add EVENTFLOW_RATE_LIMIT preview      # value: 60
vercel env add DEMO_MODE preview                 # value: offline
vercel deploy                     # prints the preview URL
```

Expected: a URL like `https://eventflow-twin-<hash>.vercel.app`. In the build output check the API function size is under 500 MB.

- [ ] **Step 4: Prove it works end to end on the preview**

```bash
python scripts/smoke_live.py https://<preview-url>
cd apps/web && EFT_BASE_URL=https://<preview-url> npx playwright test --grep "demo flow|workspace EN, day|landmarks|carries the forecast spec"
```

Expected: `OK …`; 4 passed. (The decision-log count assertions in other tests assume one persistent API and are not part of this check.)

- [ ] **Step 5: Document**

Create `docs/DEPLOY.md` with: the six environment variables and their values for Preview and Production; the three commands above; how to roll back (`vercel rollback`); what is different from the booth build (decisions per instance, rate limit, banner, no indexing); and the line "Production deploys need Krishna's go-ahead".

Append to `docs/09_DECISIONS.md`:

```markdown
| 64 | 2026-11-13 | Hosted demo on Vercel Services (beta): Next.js at `/`, FastAPI at `/api`, one project. The API is stateless — `/simulate` and `/agent/plan` carry the forecast request and any instance rebuilds the run (contract 1.6.0) | Serverless instances share no memory; run ids were already deterministic hashes, so the rebuild is verifiable (409 on mismatch) | A separate always-on API host; a database for runs |
| 65 | 2026-11-13 | On the hosted demo, decisions and the plan cache live in a per-instance temp directory (`EVENTFLOW_STORAGE=ephemeral`) and the UI says so; durable storage arrives with Postgres in roadmap Phase 5 | Honest about what the public demo keeps; no database needed to show the product | Pretend the log persists |
```

- [ ] **Step 6: Commit and open a pull request**

```bash
git add scripts/smoke_live.py tasks.py docs/DEPLOY.md docs/09_DECISIONS.md
git commit -m "deploy: smoke test for a live URL, deployment guide, decisions #64-#65"
```

- [ ] **Step 7: Production (only after Krishna confirms in chat)**

```bash
vercel env add NEXT_PUBLIC_API_URL production    # repeat the six variables for production
vercel deploy --prod
python scripts/smoke_live.py https://<production-url>
```

Expected: `OK …`. Share the URL with Dr. Rachit only after the smoke test passes.

---

## Self-review

- **Spec coverage:** stateless API (Tasks 1–2), writable state (Task 3), guardrails (Tasks 4–5), one project on one URL (Task 5), proof and documentation (Task 6). The roadmap's Phase 1 check — smoke script and Playwright against the preview — is Task 6, Step 4.
- **Names used across tasks:** `build_run`, `get_run(run_id, spec)`, `forecast` (request field), `forecastReq` (store), `simulateBody(runId, interventions, threshold, forecast)`, `planBody(…, locale, forecast)`, `CACHE` / `CACHE_WRITE`, `EVENTFLOW_DATA_DIR`, `EVENTFLOW_STORAGE`, `EVENTFLOW_RATE_LIMIT`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_PUBLIC_DEMO`, `EFT_BASE_URL` — each is defined in the task that first uses it.
- **Known unknowns, each with a check in the plan:** which dependency file Vercel installs when both `pyproject.toml` and `requirements.txt` exist, and whether Services forward the `/api` prefix (Task 5, Step 7). Both have a stated fallback.

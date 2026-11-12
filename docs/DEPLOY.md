# Deploying the public demo (Vercel)

One Vercel project serves both parts on one domain (Vercel Services, beta):
`/` → the Next.js app in `apps/web`, `/api/*` → the FastAPI app (`apps/api/eventflow/vercel_entry.py`).
The booth build (`python tasks.py demo`, offline) is unaffected by anything here.

**Production deploys need Krishna's go-ahead** (it publishes the site). Previews are fine for testing.

## What is different from the laptop
| | Laptop / booth | Hosted demo |
|---|---|---|
| API address | `http://localhost:8000` | same origin, `/api` (chosen automatically when the page is not on localhost) |
| Decision log, new plan-cache entries | `data/` (kept) | `/tmp/eventflow` per instance (**not kept**; the Report tab says so) |
| Rate limit | none | 60 POST requests / minute / client |
| Banner | none | "Public research demo … not an RTA system" |
| Search engines | — | `robots.txt` disallows everything |
| Planner | offline deterministic planner | the same |

All hosted defaults are set by `vercel_entry.py` when `VERCEL=1`, so **no environment variables are required**.
Override any of them in Project → Settings → Environment Variables:
`EVENTFLOW_DATA_DIR`, `EVENTFLOW_STORAGE`, `EVENTFLOW_RATE_LIMIT`, `DEMO_MODE`, and for the web app
`NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_PUBLIC_DEMO`.

## Turning on Claude (optional)
The planner stays offline and deterministic unless all of these are set (Project → Settings → Environment Variables,
or `.env` on a laptop — never commit them):
`DEMO_MODE=live`, `LLM_MODEL=claude-opus-5-5`, `ANTHROPIC_API_KEY=<key with a monthly spend cap>`.
Then Claude proposes extra plans and writes the explanations; the simulator still computes every number and any
text with an untraceable number falls back to the template (docs/09 #71). Before switching it on for the public link,
run `python tasks.py eval-fast && python tasks.py gate` with the same variables so the agents and red-team suites
measure the Claude path. `LLM_FALLBACKS=off` disables the server-side refusal fallback if the API rejects it.

## First deploy (about 10 minutes)
```bash
npm i -g vercel                      # or pnpm add -g vercel; CLI 60+ (services support)
vercel login
vercel link                          # in the repo root; create project "eventflow-twin"
vercel dev --local                   # optional: both services on http://localhost:3000
vercel deploy                        # preview → prints https://eventflow-twin-<hash>.vercel.app
python tasks.py smoke https://<preview-url>
```
Expected: `OK https://…: contract 1.6.0, storage ephemeral, 3 events, 3 plan options, numbers verified, is_synthetic=True`.

Then the browser checks against the preview:
```bash
cd apps/web
EFT_BASE_URL=https://<preview-url> npx playwright test --grep "workspace EN, day|landmarks|demo flow|carries the forecast spec"
```
(The other UI tests assume one persistent local API and are not part of this check.)

If the project uses Vercel **Deployment Protection** on previews (the default for new projects), open the preview
in a browser where you are logged in to Vercel, or create a protection-bypass token for the smoke test.

## Production (only after the go-ahead)
```bash
vercel deploy --prod
python tasks.py smoke https://<production-url>
```
Share the link only after the smoke test prints `OK`. Roll back with `vercel rollback`.

## Deploys from GitHub
Connecting the GitHub repo in the Vercel dashboard gives a preview per pull request and production on `main`.
Decide that together first (production on every merge to `main` is a publishing decision).

## If the build fails
| Symptom | Fix |
|---|---|
| Python function over 500 MB | Set `VERCEL_ANALYZE_BUILD_OUTPUT=1`, redeploy, read the largest files; extend `.vercelignore` |
| `ModuleNotFoundError` at runtime | The hosted dependencies are in `pyproject.toml` (not `requirements.txt`); add the package there |
| API answers 404 for `/api/...` | `vercel.json` must route `/api/(.*)` to the `api` service *before* the catch-all; the entrypoint serves both `/api/x` and `/x` |
| Page loads but shows "planning service is not reachable" | Open `/api/healthz` on the same domain; if it fails, read the function logs in the Vercel dashboard |

Measured on 12 Nov 2026: the hosted dependency set installs to 208 MB on Python 3.12 (limit 500 MB), and
`vercel dev --local` (CLI 60.0.0) serves both services on one origin with the smoke test passing.

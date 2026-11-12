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

## Turning on the live language model (optional)
The planner stays offline and deterministic unless these are set (Project → Settings → Environment Variables,
or `.env` on a laptop — never commit them). **Our key is OpenAI and Yash holds it** (live test steps:
`docs/12_TEAM_TASKS.md` §0); the public site stays offline unless Krishna decides otherwise:
`DEMO_MODE=live`, `LLM_MODEL=gpt-5` (or whichever GPT-5 model id the key can use), `OPENAI_API_KEY=<key with a
monthly budget limit set in the OpenAI dashboard>`. The provider is taken from the model id (`claude-*` → Anthropic,
anything else → OpenAI) or from `LLM_PROVIDER=openai|anthropic`. Claude works the same way with
`LLM_MODEL=claude-opus-5-5` and `ANTHROPIC_API_KEY`.
Then the model proposes extra plans and writes the explanations; the simulator still computes every number and any
text with an untraceable number falls back to the template (docs/09 #71, #72). Before switching it on for the public
link, run `python tasks.py eval-fast && python tasks.py gate` with the same variables so the agents and red-team
suites measure the live path, and note cost and latency. OpenAI: `LLM_REASONING=off` for a model without reasoning
effort. Claude: `LLM_FALLBACKS=off` disables the server-side refusal fallback if the API rejects it.

## Status (12 Nov 2026)
Vercel project **`eventflow-twin`** (account krishnamathur008-1499) exists and the first deploy is live at
**https://eventflow-twin.vercel.app**. ⚠️ Vercel assigns a project's *first* deployment to production, so this URL is
public (the per-deployment hash URLs are behind Vercel login). It has not been shared; the site asks search engines not
to index it. Whether to keep it public is K1 (Dr. Rachit). Checks on that URL: `python scripts/smoke_live.py
https://eventflow-twin.vercel.app` → `OK … contract 1.7.0, storage ephemeral, 3 events, 3 plan options, numbers
verified, is_synthetic=True`; the 5 remote Playwright checks below → 5 passed.
To take it offline without deleting the project: Project → Settings → Deployment Protection → protect production too,
or remove the alias with `vercel alias rm eventflow-twin.vercel.app` (another account could then claim that name).

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

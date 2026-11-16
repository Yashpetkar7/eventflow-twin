# EventFlow Twin API (FastAPI). Runs with no network once built: the forecast, simulator, agents and the offline plan
# cache are all inside the image. Build:  docker build -t eventflow-api .   Run:  docker run -p 8000:8000 eventflow-api
FROM python:3.11-slim AS api
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONUTF8=1 PYTHONPATH=/app DEMO_MODE=offline
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*   # LightGBM runtime
COPY requirements.txt requirements-saas.txt ./
ARG SAAS=0
RUN pip install --no-cache-dir -r requirements.txt && if [ "$SAAS" = "1" ]; then pip install --no-cache-dir -r requirements-saas.txt; fi
COPY apps/api apps/api
COPY config config
COPY data/synthetic data/synthetic
COPY data/demo_cache data/demo_cache
COPY eval eval
COPY scripts scripts
COPY tasks.py ./
RUN python scripts/preflight.py --no-ports | grep -v "node_modules\|corridor_scene\|npm is not" || true
RUN useradd -r -u 10001 eft && mkdir -p /app/data/processed && chown -R eft /app/data
USER eft
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"
CMD ["python", "-m", "uvicorn", "apps.api.eventflow.main:app", "--host", "0.0.0.0", "--port", "8000"]

"""Document knowledge for the assistant (decision #149): a small corpus with provenance, hybrid retrieval, and a
knowledge graph of the corridor built from the configuration.

Kept apart from the operational numbers on purpose: a passage can explain a method or quote what an authority
publishes, but no load, capacity or forecast figure is ever taken from a document (CLAUDE.md rule 2).

Retrieval is hybrid and runs fully offline with no model: BM25 over words plus cosine similarity over character
n-grams (robust to spelling and to Arabic word forms), fused by reciprocal rank. There are no neural embeddings and
no neural reranker here; `docs/18_ASSISTANT.md` lists them as the next step. A passage is only returned when it
shares enough of the question's words, otherwise the answer is "not enough evidence".

Passages are data. One that reads like an instruction is dropped when the corpus loads, and nothing in a passage is
ever followed.
"""
from __future__ import annotations

import hashlib
import math
import re
from collections import Counter, deque
from functools import lru_cache

import yaml

from ..config import ROOT, corridor, events

CORPUS = ROOT / "config/knowledge/corpus.yaml"

_AR_MARKS = re.compile(r"[ً-ْٰـ]")                 # diacritics and the tatweel
_AR_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"})
_WORD = re.compile(r"[a-z0-9ء-ي]+")
STOP = frozenset("""a an and are as at be by can do does for from has have how i in is it its of on or that the their there this
to was what when where which who why will with you your me my we our about any into than then so if not no yes please tell
هل ما ماذا من في على الى إلى عن هذا هذه التي الذي كيف متى اين أين لماذا كم او أو و هو هي كان لي""".split())
# Words a visitor or planner uses → the corpus's own words (deterministic query rewriting, both directions are listed).
SYNONYMS = {
    "pod": "people determination accessibility", "disabled": "accessibility wheelchair determination", "disability": "accessibility determination",
    "elevator": "lift", "elevators": "lift", "lifts": "lift", "stairs": "step-free lift", "stepfree": "step-free", "wheelchairs": "wheelchair",
    "blind": "tactile visually impaired", "ticket": "nol fare card", "tickets": "nol fare card", "price": "fare card", "free": "free fare",
    "threshold": "comfort line threshold", "busy": "load crowded", "crowding": "load crowded", "accurate": "confidence backtest forecast",
    "accuracy": "confidence backtest forecast", "trust": "confidence evidence", "real": "real ridership data synthetic", "fake": "synthetic",
    "money": "cost proxy dirhams", "aed": "dirhams", "budget": "cost", "emission": "emissions road", "co2": "emissions", "carbon": "emissions",
    "queue": "queue wait", "queues": "queue wait", "delay": "wait", "schedule": "timetable gtfs", "frequency": "trains timetable",
    "approve": "approval human", "approved": "approval human", "audit": "log decision approval", "rta": "rta official",
    "كرسي": "wheelchair الكرسي المتحرك", "مصعد": "lift مصاعد", "مصاعد": "lift", "همم": "determination الهمم", "بطاقة": "nol بطاقة", "مجانا": "free مجانًا",
}


def norm(text: str) -> str:
    return _AR_MARKS.sub("", text.lower()).translate(_AR_FOLD)


def tokens(text: str, expand: bool = False) -> list[str]:
    out = [w for w in _WORD.findall(norm(text)) if w not in STOP and len(w) > 1]
    if expand:
        out += [w for t in list(out) for w in tokens(SYNONYMS.get(t, ""))]
    return out


def _ngrams(text: str, lo: int, hi: int) -> Counter:
    s = " ".join(_WORD.findall(norm(text)))
    return Counter(s[i:i + n] for n in range(lo, hi + 1) for i in range(max(0, len(s) - n + 1)))


def settings() -> dict:
    return yaml.safe_load((ROOT / "config/assistant.yaml").read_text(encoding="utf-8"))["retrieval"]


def load(path=CORPUS) -> dict:
    """The corpus with every passage joined to its source. Instruction-like passages are dropped and counted."""
    from .brief import screen
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    sources = {s["id"]: s for s in raw["sources"]}
    passages, dropped = [], []
    for p in raw["passages"]:
        if p["source"] not in sources:
            raise ValueError(f"passage {p['id']} names an unknown source {p['source']}")
        body = " ".join(str(p.get(k) or "") for k in ("text", "text_ar"))
        if screen(body):                                          # document-borne prompt injection: never indexed
            dropped.append(p["id"])
            continue
        passages.append({**p, "hash": hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]})
    version = hashlib.sha256("|".join(f"{p['id']}:{p['hash']}" for p in passages).encode()).hexdigest()[:12]
    return {"version": raw.get("version"), "corpus_hash": version, "sources": sources, "passages": passages, "dropped": dropped}


class Index:
    """BM25 + character n-gram vectors over one corpus."""

    def __init__(self, corp: dict, cfg: dict | None = None):
        self.corp, self.cfg = corp, cfg or settings()
        lo, hi = self.cfg["ngram"]
        self.docs = corp["passages"]
        text = [" ".join([p["text"], p.get("text_ar") or "", p.get("section") or "", " ".join(p.get("tags") or [])]) for p in self.docs]
        self.tok = [Counter(tokens(t)) for t in text]
        self.len = [sum(c.values()) for c in self.tok]
        self.avg = (sum(self.len) / len(self.len)) if self.len else 1.0
        n = len(self.docs)
        df = Counter(w for c in self.tok for w in c)
        self.idf = {w: math.log(1 + (n - d + 0.5) / (d + 0.5)) for w, d in df.items()}
        grams = [_ngrams(t, lo, hi) for t in text]
        gdf = Counter(g for c in grams for g in c)
        self.gidf = {g: math.log((1 + n) / (1 + d)) + 1 for g, d in gdf.items()}
        self.vec = [self._weigh(c) for c in grams]

    def _weigh(self, c: Counter) -> tuple[dict, float]:
        v = {g: (1 + math.log(f)) * self.gidf.get(g, 0.0) for g, f in c.items() if g in self.gidf}
        return v, math.sqrt(sum(x * x for x in v.values())) or 1.0

    def _bm25(self, q: list[str], i: int) -> float:
        k1, b, c = self.cfg["bm25_k1"], self.cfg["bm25_b"], self.tok[i]
        return sum(self.idf.get(w, 0.0) * c[w] * (k1 + 1) / (c[w] + k1 * (1 - b + b * self.len[i] / self.avg)) for w in set(q) if w in c)

    def _cos(self, qv: tuple[dict, float], i: int) -> float:
        v, nv = self.vec[i]
        q, nq = qv
        small, big = (q, v) if len(q) < len(v) else (v, q)
        return sum(x * big.get(g, 0.0) for g, x in small.items()) / (nq * nv)

    def search(self, query: str, audience: str = "planner", k: int | None = None) -> dict:
        """Top passages for `query` that `audience` may see. `insufficient` when nothing is relevant enough."""
        cfg = self.cfg
        k = k or cfg["top_k"]
        lo, hi = cfg["ngram"]
        base, q = tokens(query), tokens(query, expand=True)
        qv = self._weigh(_ngrams(" ".join([query, *q]), lo, hi))
        allowed = [i for i, p in enumerate(self.docs) if audience in self.corp["sources"][p["source"]]["audiences"]]
        bm = {i: self._bm25(q, i) for i in allowed}
        cs = {i: self._cos(qv, i) for i in allowed}
        r_bm = {i: r for r, i in enumerate(sorted(allowed, key=lambda i: (-bm[i], i)), 1)}
        r_cs = {i: r for r, i in enumerate(sorted(allowed, key=lambda i: (-cs[i], i)), 1)}
        fused = sorted(allowed, key=lambda i: (-(1 / (cfg["rrf_k"] + r_bm[i]) + 1 / (cfg["rrf_k"] + r_cs[i])), i))
        hits = []
        for i in fused:
            overlap = len(set(q) & set(self.tok[i]))
            direct = len(set(base) & set(self.tok[i]))
            relevant = overlap >= cfg["min_overlap"] or (direct >= 1 and cs[i] >= cfg["min_cosine"] and len(set(base)) <= 2)
            if not relevant or bm[i] <= 0:
                continue
            hits.append({"passage": self.docs[i], "source": self.corp["sources"][self.docs[i]["source"]], "bm25": round(bm[i], 3),
                         "cosine": round(cs[i], 3), "bm25_rank": r_bm[i], "vector_rank": r_cs[i],
                         "score": round(1 / (cfg["rrf_k"] + r_bm[i]) + 1 / (cfg["rrf_k"] + r_cs[i]), 5)})
            if len(hits) == k:
                break
        return {"hits": hits, "considered": len(allowed), "insufficient": not hits, "corpus_hash": self.corp["corpus_hash"],
                "method": "bm25+char-ngram, reciprocal rank fusion"}


@lru_cache(maxsize=1)
def index() -> Index:
    return Index(load())


def search(query: str, audience: str = "planner", k: int | None = None) -> dict:
    return index().search(query, audience, k)


def by_id(passage_id: str) -> dict | None:
    """One passage with its source (for answers that always cite the same passage, e.g. accessibility)."""
    ix = index()
    p = next((p for p in ix.docs if p["id"] == passage_id), None)
    return {"passage": p, "source": ix.corp["sources"][p["source"]]} if p else None


def cite(hit: dict, locale: str = "en") -> dict:
    """An evidence reference for one passage: who says it, where, when it was read, under which licence."""
    p, s = hit["passage"], hit["source"]
    text = p.get("text_ar") if locale == "ar" and p.get("text_ar") else p["text"]
    return {"kind": "document", "id": p["id"], "tool": "retrieve", "run_id": None, "title": s["title"], "authority": s["authority"],
            "url": s["url"], "published": s.get("published"), "retrieved": s.get("retrieved"), "version": f"{index().corp['version']}#{p['hash']}",
            "licence": s.get("licence"), "section": p.get("section"), "excerpt": " ".join(text.split()),
            "excerpt_locale": "ar" if (locale == "ar" and p.get("text_ar")) else "en", "source_kind": s["kind"]}


def sources_view() -> dict:
    c = index().corp
    return {"version": c["version"], "corpus_hash": c["corpus_hash"], "passages": len(c["passages"]), "dropped": c["dropped"],
            "method": "bm25+char-ngram, reciprocal rank fusion (no neural embeddings)",
            "sources": [{**{k: s.get(k) for k in ("id", "kind", "title", "authority", "url", "published", "retrieved", "licence", "audiences")},
                         "passages": sum(1 for p in c["passages"] if p["source"] == s["id"])} for s in c["sources"].values()]}


# ---------------------------------------------------------------- the corridor as a graph
MEASURE_OWNER = {"extra_trains": "rail", "extended_hours": "rail", "station_metering": "station_crowd", "wayfinding_redirect": "station_crowd",
                 "staggered_exit": "venue", "shuttle_bus": "last_mile", "robotaxi_staging": "last_mile"}
MEASURE_PARTY = {"extra_trains": "rail_operations", "extended_hours": "rail_operations", "station_metering": "station_staff",
                 "wayfinding_redirect": "station_staff", "staggered_exit": "venue", "shuttle_bus": "bus_operations",
                 "robotaxi_staging": "robotaxi_operator"}


def _km(a: dict, b: dict) -> float:
    from ..event_model import _haversine_km
    return _haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])


@lru_cache(maxsize=1)
def graph() -> dict:
    """Stations, lines, events, measures and agents as typed nodes and edges, from the configuration only."""
    from ..travel import settings as travel
    cfg, t = corridor(), travel()
    st = {s["id"]: s for s in cfg["stations"]}
    nodes = {f"station:{i}": {"type": "station", "id": i, "in_corridor": bool(s.get("in_corridor"))} for i, s in st.items()}
    edges: list[tuple[str, str, str, dict]] = []
    for line, ids in cfg["lines"].items():
        nodes[f"line:{line}"] = {"type": "line", "id": line}
        edges += [(f"station:{i}", "on_line", f"line:{line}", {}) for i in ids]
        edges += [(f"station:{a}", "next", f"station:{b}", {"line": line}) for a, b in zip(ids, ids[1:])]
    for a, nbs in cfg["neighbours"].items():
        for b in nbs:
            if a in st and b in st and a < b:
                m = round(_km(st[a], st[b]) / float(t["walk_kmh"]) * 60)
                if m <= float(t["walk_max_min"]):
                    edges.append((f"station:{a}", "walk", f"station:{b}", {"minutes": m}))
    corr = [s for s in st.values() if s.get("in_corridor")]
    for e in events():
        nodes[f"event:{e['id']}"] = {"type": "event", "id": e["id"]}
        near = min(corr, key=lambda s: (_km(e, s), s["id"]))
        edges.append((f"event:{e['id']}", "nearest_station", f"station:{near['id']}", {"km": round(_km(e, near), 2)}))
    for m, agent in MEASURE_OWNER.items():
        nodes[f"measure:{m}"] = {"type": "measure", "id": m}
        nodes.setdefault(f"agent:{agent}", {"type": "agent", "id": agent})
        nodes.setdefault(f"party:{MEASURE_PARTY[m]}", {"type": "party", "id": MEASURE_PARTY[m]})
        edges.append((f"measure:{m}", "proposed_by", f"agent:{agent}", {}))
        edges.append((f"measure:{m}", "carried_out_by", f"party:{MEASURE_PARTY[m]}", {}))
    adj: dict[str, list[tuple[str, str, dict]]] = {}
    for a, rel, b, at in edges:
        adj.setdefault(a, []).append((rel, b, at))
        adj.setdefault(b, []).append((f"~{rel}", a, at))
    return {"nodes": nodes, "edges": edges, "adj": adj}


def graph_view() -> dict:
    g = graph()
    return {"nodes": len(g["nodes"]), "edges": len(g["edges"]), "node_types": dict(Counter(n["type"] for n in g["nodes"].values())),
            "edge_types": dict(Counter(rel for _, rel, _, _ in g["edges"])), "built_from": ["config/corridor.yaml", "config/events.yaml", "config/travel.yaml"]}


def lines_of(station: str) -> list[str]:
    return sorted(b.split(":", 1)[1] for rel, b, _ in graph()["adj"].get(f"station:{station}", []) if rel == "on_line")


def walkable(station: str) -> list[dict]:
    """Stations within the walking limit of `station`, nearest first."""
    out = [{"station": b.split(":", 1)[1], "minutes": at["minutes"]} for rel, b, at in graph()["adj"].get(f"station:{station}", [])
           if rel in ("walk", "~walk")]
    return sorted(out, key=lambda x: (x["minutes"], x["station"]))


def route(a: str, b: str) -> dict | None:
    """Fewest stops from `a` to `b` along the lines (breadth-first over `next` edges), with the lines used in order."""
    g = graph()["adj"]
    start, goal = f"station:{a}", f"station:{b}"
    if start not in g or goal not in g:
        return None
    if a == b:
        return {"stops": 0, "lines": [], "changes": 0, "path": [a]}
    prev: dict[str, tuple[str, str] | None] = {start: None}
    q = deque([start])
    while q:
        n = q.popleft()
        if n == goal:
            break
        for rel, m, at in g.get(n, []):
            if rel in ("next", "~next") and m not in prev:
                prev[m] = (n, at["line"])
                q.append(m)
    if goal not in prev:
        return None
    path, lines, n = [], [], goal
    while prev[n] is not None:
        path.append(n.split(":", 1)[1])
        lines.append(prev[n][1])
        n = prev[n][0]
    path.append(a)
    path.reverse()
    lines.reverse()
    used = [ln for i, ln in enumerate(lines) if i == 0 or ln != lines[i - 1]]
    return {"stops": len(path) - 1, "lines": used, "changes": len(used) - 1, "path": path}


def event_station(event_id: str | None) -> str | None:
    for rel, b, _ in graph()["adj"].get(f"event:{event_id}", []):
        if rel == "nearest_station":
            return b.split(":", 1)[1]
    return None


def parties(interventions: list[dict]) -> list[str]:
    """The operating parties that must act for a plan (graph: measure —carried_out_by→ party)."""
    return sorted({MEASURE_PARTY[i["type"]] for i in interventions if i.get("type") in MEASURE_PARTY})

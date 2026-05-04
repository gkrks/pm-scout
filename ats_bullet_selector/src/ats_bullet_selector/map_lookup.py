"""Fast bullet ranking via qualification_map.json + embedding + LLM re-rank.

Pipeline:
  1. Hash each qual text -> look up in precomputed map -> instant top-3
  2. For map misses: batch-embed all miss quals (1 OpenAI call) -> cosine
     against pre-embedded bullets -> retrieve top-10 candidates each
  3. Batch re-rank all misses in 1 GPT-4.1 call to catch transferable-skill
     matches that pure embedding similarity misses -> return top-3 each

Total API calls for N map misses: 1 embedding + 1 re-rank = 2 calls.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
import structlog

from .config import OUTPUTS_DIR, PROJECT_ROOT, SUPABASE_KEY, SUPABASE_URL
from .models import (
    Bullet,
    QualCandidates,
    Qualification,
    ScoredCandidate,
    SubScores,
)

logger = structlog.get_logger()

# --------------------------------------------------------------------------- #
#  Map loading
# --------------------------------------------------------------------------- #

_map_data: Optional[dict] = None
_bullet_embeddings: Optional[np.ndarray] = None
_bullet_ids_order: Optional[list[str]] = None


def _load_map_from_supabase() -> dict:
    """Reconstruct the qualification map dict from Supabase tables."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Supabase not configured")

    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

    # Load meta (most recent row)
    meta_resp = httpx.get(
        f"{SUPABASE_URL}/rest/v1/qualification_map_meta",
        params={"select": "*", "order": "created_at.desc", "limit": "1"},
        headers=headers,
        timeout=10.0,
    )
    meta_resp.raise_for_status()
    meta_rows = meta_resp.json()
    if not meta_rows:
        raise RuntimeError("No qualification_map_meta rows found")
    meta = meta_rows[0]

    # Load all qual rows (paginated)
    quals: dict[str, dict] = {}
    offset = 0
    batch_size = 1000
    while True:
        q_resp = httpx.get(
            f"{SUPABASE_URL}/rest/v1/qualification_map_quals",
            params={
                "select": "qual_hash,qual_text,qual_type,group_name,freq,bullet_ids,similarities",
                "offset": str(offset),
                "limit": str(batch_size),
            },
            headers=headers,
            timeout=15.0,
        )
        q_resp.raise_for_status()
        rows = q_resp.json()
        if not rows:
            break
        for r in rows:
            quals[r["qual_hash"]] = {
                "t": r["qual_text"],
                "type": r["qual_type"],
                "group": r["group_name"],
                "freq": r["freq"],
                "bullets": r["bullet_ids"],
                "sim": r["similarities"],
            }
        if len(rows) < batch_size:
            break
        offset += batch_size

    return {
        "v": meta["version"],
        "embedding_model": meta["embedding_model"],
        "embedding_dim": meta["embedding_dim"],
        "stats": {
            "quals": len(quals),
            "bullets": meta["stats_bullets"],
            "groups": meta["stats_groups"],
        },
        "bullets": meta["bullets"],
        "groups": meta["groups"],
        "resume": meta["resume"],
        "quals": quals,
    }


def _load_map() -> dict:
    """Load qualification map: Supabase first, local JSON fallback."""
    global _map_data
    if _map_data is not None:
        return _map_data

    # Try Supabase first
    try:
        _map_data = _load_map_from_supabase()
        logger.info(
            "qualification_map_loaded_from_supabase",
            version=_map_data.get("v"),
            quals=len(_map_data.get("quals", {})),
        )
        return _map_data
    except Exception as e:
        logger.warning("supabase_map_load_failed", error=str(e))

    # Fallback to local JSON
    map_path = OUTPUTS_DIR / "qualification_map.json"
    if not map_path.exists():
        raise FileNotFoundError(
            f"qualification_map.json not found at {map_path}. "
            "Run the map generation script first."
        )

    with open(map_path, "r", encoding="utf-8") as f:
        _map_data = json.load(f)

    logger.info(
        "qualification_map_loaded_from_file",
        version=_map_data.get("v"),
        quals=_map_data.get("stats", {}).get("quals", 0),
        embedding_model=_map_data.get("embedding_model", "unknown"),
    )
    return _map_data


def _qual_hash(text: str) -> str:
    """Same hash as the map generation script."""
    return hashlib.sha256(text.encode()).hexdigest()[:12]


# --------------------------------------------------------------------------- #
#  OpenAI client (lazy)
# --------------------------------------------------------------------------- #

_openai_client = None


def _get_openai():
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI

        key = os.environ.get("OPENAI_KEY", "")
        if not key:
            raise RuntimeError("OPENAI_KEY not set — needed for embedding map misses")
        _openai_client = OpenAI(api_key=key)
    return _openai_client


# --------------------------------------------------------------------------- #
#  Embedding helpers
# --------------------------------------------------------------------------- #

def _embed_texts(texts: list[str]) -> np.ndarray:
    """Embed multiple texts in one API call. Returns normalized (N, dim) array."""
    client = _get_openai()
    resp = client.embeddings.create(
        model="text-embedding-3-large",
        input=[t[:500] for t in texts],
    )
    vecs = np.array([d.embedding for d in resp.data], dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / norms


def _get_bullet_embeddings(bullets: list[Bullet]) -> tuple[np.ndarray, list[str]]:
    """Get or compute embeddings for all bullets. Caches in memory."""
    global _bullet_embeddings, _bullet_ids_order

    if _bullet_embeddings is not None and _bullet_ids_order is not None:
        return _bullet_embeddings, _bullet_ids_order

    vecs = _embed_texts([b.text for b in bullets])
    ids = [b.bullet_id for b in bullets]

    _bullet_embeddings = vecs
    _bullet_ids_order = ids

    logger.info("bullet_embeddings_computed", count=len(ids), dim=vecs.shape[1])
    return vecs, ids


# --------------------------------------------------------------------------- #
#  Build ScoredCandidate
# --------------------------------------------------------------------------- #

def _build_scored_candidate(
    bullet: Bullet,
    score: float,
    rationale: str = "",
) -> ScoredCandidate:
    """Build a ScoredCandidate from an LLM score [0-100] or embedding sim [0-1]."""
    if score <= 1.0:
        match_score = min(100.0, max(0.0, score * 200.0))
    else:
        match_score = min(100.0, max(0.0, score))

    base = round(match_score / 2, 1)
    sub = SubScores(
        keyword=base, semantic=base, evidence=base,
        quantification=base, seniority=base, recency=base,
    )

    return ScoredCandidate(
        bullet_id=bullet.bullet_id,
        source_id=bullet.source_id,
        source_label=bullet.source_label,
        text=bullet.text,
        match_score=round(match_score, 1),
        confidence=round(min(1.0, match_score / 100.0), 2),
        sub_scores=sub,
        rationale=rationale or f"Embedding similarity: {score:.3f}",
        supporting_span="",
    )


# --------------------------------------------------------------------------- #
#  Batched LLM re-ranking (1 GPT-4.1 call for all map misses)
# --------------------------------------------------------------------------- #

_RERANK_PROMPT = """You are scoring resume bullets against job qualifications.
For EACH qualification, score EACH of its candidate bullets on a 0-100 scale.
Consider TRANSFERABLE SKILLS — a bullet may demonstrate the qualification through
analogous experience even if the vocabulary is different.

Examples of transferable evidence:
- "Writing 9 technical blog posts explaining engineering tradeoffs" demonstrates
  "Structured communication" even though it's not about stakeholder meetings.
- "Building a production pipeline from scratch" demonstrates "Bias for action"
  even without the exact phrase.

Return JSON:
{"results": [
  {"qual_id": "<id>", "scores": [{"id": "<bullet_id>", "score": <0-100>, "reason": "<1 sentence>"}]},
  ...
]}
Only return valid JSON, no markdown fences."""

_RERANK_MODEL = os.environ.get("RERANK_MODEL", "gpt-4.1")


def _batch_rerank(
    items: list[tuple[Qualification, list[tuple[Bullet, float]]]],
    top_k: int = 3,
) -> dict[str, list[tuple[Bullet, float, str]]]:
    """Re-rank candidates for multiple qualifications in one LLM call.

    Returns {qual_id: [(bullet, score, reason), ...]} with top_k per qual.
    """
    if not items:
        return {}

    # Build fallback in case LLM fails
    def _fallback() -> dict[str, list[tuple[Bullet, float, str]]]:
        result = {}
        for qual, candidates in items:
            result[qual.id] = [
                (b, sim * 200, f"Embedding similarity: {sim:.3f}")
                for b, sim in candidates[:top_k]
            ]
        return result

    try:
        client = _get_openai()
    except RuntimeError:
        return _fallback()

    payload = {
        "qualifications": [
            {
                "qual_id": qual.id,
                "text": qual.text,
                "kind": qual.kind.value,
                "bullets": [
                    {"id": b.bullet_id, "source": b.source_label, "text": b.text[:300]}
                    for b, _ in candidates
                ],
            }
            for qual, candidates in items
        ]
    }

    data = None
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=_RERANK_MODEL,
                temperature=0,
                max_tokens=4096,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _RERANK_PROMPT},
                    {"role": "user", "content": json.dumps(payload)},
                ],
            )
            raw = response.choices[0].message.content or "{}"
            data = json.loads(raw)
            break
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate_limit" in err_str.lower():
                wait = 15.0
                match = re.search(r"try again in ([\d.]+)s", err_str, re.IGNORECASE)
                if match:
                    wait = float(match.group(1)) + 2.0
                logger.warning("rerank_rate_limited", attempt=attempt + 1, wait=wait)
                time.sleep(wait)
                continue
            logger.warning("rerank_llm_error", error=str(e))
            break

    if data is None:
        return _fallback()

    # Parse response: build bullet lookup per qual
    all_bullet_map: dict[str, dict[str, tuple[Bullet, float]]] = {}
    for qual, candidates in items:
        all_bullet_map[qual.id] = {b.bullet_id: (b, sim) for b, sim in candidates}

    result: dict[str, list[tuple[Bullet, float, str]]] = {}
    for entry in data.get("results", []):
        qid = entry.get("qual_id", "")
        if qid not in all_bullet_map:
            continue

        bmap = all_bullet_map[qid]
        scored: list[tuple[Bullet, float, str]] = []
        for item in entry.get("scores", []):
            bid = item.get("id", "")
            if bid in bmap:
                b, _ = bmap[bid]
                llm_score = min(100.0, max(0.0, float(item.get("score", 0))))
                scored.append((b, llm_score, item.get("reason", "")))

        scored.sort(key=lambda x: x[1], reverse=True)
        result[qid] = scored[:top_k]

    # Fill missing quals with embedding fallback
    for qual, candidates in items:
        if qual.id not in result:
            result[qual.id] = [
                (b, sim * 200, f"Embedding similarity: {sim:.3f}")
                for b, sim in candidates[:top_k]
            ]

    logger.info(
        "batch_rerank_complete",
        model=_RERANK_MODEL,
        qual_count=len(items),
        total_bullets=sum(len(cs) for _, cs in items),
    )

    return result


# --------------------------------------------------------------------------- #
#  Main entry point
# --------------------------------------------------------------------------- #

def rank_all_from_map(
    quals: list[Qualification],
    bullets: list[Bullet],
    top_k: int = 3,
) -> list[QualCandidates]:
    """Rank bullets for all qualifications.

    Map hits use precomputed rankings (0 API calls).
    Map misses: 1 batched embedding call + 1 batched re-rank call = 2 total.
    """
    t0 = time.time()
    qmap = _load_map()
    bullet_map = {b.bullet_id: b for b in bullets}

    # Phase 1: resolve map hits
    results: dict[str, QualCandidates] = {}
    miss_quals: list[Qualification] = []

    for qual in quals:
        qhash = _qual_hash(qual.text)
        map_entry = qmap.get("quals", {}).get(qhash)

        if map_entry:
            ranked_ids = map_entry.get("bullets", [])[:top_k]
            sims = map_entry.get("sim", [])[:top_k]
            candidates = []
            for bid, sim in zip(ranked_ids, sims):
                bullet = bullet_map.get(bid)
                if bullet:
                    candidates.append(_build_scored_candidate(bullet, sim))
            results[qual.id] = QualCandidates(qualification=qual, candidates=candidates)
            logger.info("map_hit", qual_id=qual.id, qual_hash=qhash, candidates=len(candidates))
        else:
            miss_quals.append(qual)

    # Phase 2: batch-embed all miss quals (1 API call)
    if miss_quals:
        bullet_vecs, bullet_ids = _get_bullet_embeddings(bullets)
        qual_vecs = _embed_texts([q.text for q in miss_quals])

        # Cosine similarities: (N_miss, N_bullets)
        sim_matrix = qual_vecs @ bullet_vecs.T

        retrieval_k = max(top_k * 3, 10)
        miss_candidates: list[tuple[Qualification, list[tuple[Bullet, float]]]] = []

        for i, qual in enumerate(miss_quals):
            sims = sim_matrix[i]
            top_idx = np.argsort(-sims)[:retrieval_k]
            candidates = []
            for idx in top_idx:
                bid = bullet_ids[idx]
                bullet = bullet_map.get(bid)
                if bullet:
                    candidates.append((bullet, float(sims[idx])))
            miss_candidates.append((qual, candidates))

        logger.info("batch_embed_complete", miss_count=len(miss_quals), api_calls=1)

        # Phase 3: re-rank in chunks of 4 quals per LLM call to preserve quality
        _RERANK_CHUNK = 4
        reranked: dict[str, list[tuple[Bullet, float, str]]] = {}
        for ci in range(0, len(miss_candidates), _RERANK_CHUNK):
            chunk = miss_candidates[ci : ci + _RERANK_CHUNK]
            reranked.update(_batch_rerank(chunk, top_k=top_k))

        for qual, _ in miss_candidates:
            ranked = reranked.get(qual.id, [])
            candidates = [
                _build_scored_candidate(bullet, score, reason)
                for bullet, score, reason in ranked
            ]
            results[qual.id] = QualCandidates(qualification=qual, candidates=candidates)

    # Preserve input order
    ordered = [results[q.id] for q in quals if q.id in results]

    hits = len(quals) - len(miss_quals)
    logger.info(
        "map_ranking_complete",
        total=len(quals),
        hits=hits,
        misses=len(miss_quals),
        api_calls=0 if not miss_quals else (1 + ((len(miss_quals) + 3) // 4)),
        duration_ms=round((time.time() - t0) * 1000),
    )

    return ordered

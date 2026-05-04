"""Fast bullet ranking via qualification_map.json + OpenAI embedding fallback.

Replaces the slow LLM judge pipeline (Stages A+B+C) with:
  1. Hash qual text -> look up in the precomputed map -> instant top-3
  2. If not found: embed with text-embedding-3-large -> cosine against
     pre-embedded bullets -> top-3 in <1 second

Zero Groq LLM calls. Only OpenAI embedding calls for map misses (~$0.00001 each).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Optional

import numpy as np
import structlog

from .config import OUTPUTS_DIR, PROJECT_ROOT
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


def _load_map() -> dict:
    global _map_data
    if _map_data is not None:
        return _map_data

    map_path = OUTPUTS_DIR / "qualification_map.json"
    if not map_path.exists():
        raise FileNotFoundError(
            f"qualification_map.json not found at {map_path}. "
            "Run the map generation script first."
        )

    with open(map_path, "r", encoding="utf-8") as f:
        _map_data = json.load(f)

    logger.info(
        "qualification_map_loaded",
        version=_map_data.get("v"),
        quals=_map_data.get("stats", {}).get("quals", 0),
        embedding_model=_map_data.get("embedding_model", "unknown"),
    )
    return _map_data


def _qual_hash(text: str) -> str:
    """Same hash as the map generation script."""
    return hashlib.sha256(text.encode()).hexdigest()[:12]


# --------------------------------------------------------------------------- #
#  OpenAI embedding for map misses
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


def _embed_single(text: str) -> np.ndarray:
    """Embed a single text with text-embedding-3-large."""
    client = _get_openai()
    resp = client.embeddings.create(
        model="text-embedding-3-large",
        input=[text[:500]],
    )
    return np.array(resp.data[0].embedding, dtype=np.float32)


def _get_bullet_embeddings(bullets: list[Bullet]) -> tuple[np.ndarray, list[str]]:
    """Get or compute embeddings for all bullets. Caches in memory."""
    global _bullet_embeddings, _bullet_ids_order

    if _bullet_embeddings is not None and _bullet_ids_order is not None:
        return _bullet_embeddings, _bullet_ids_order

    client = _get_openai()
    texts = [b.text[:500] for b in bullets]
    ids = [b.bullet_id for b in bullets]

    resp = client.embeddings.create(model="text-embedding-3-large", input=texts)
    vecs = np.array([d.embedding for d in resp.data], dtype=np.float32)

    # Normalize
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    vecs = vecs / norms

    _bullet_embeddings = vecs
    _bullet_ids_order = ids

    logger.info("bullet_embeddings_computed", count=len(ids), dim=vecs.shape[1])
    return vecs, ids


# --------------------------------------------------------------------------- #
#  Build ScoredCandidate from map data
# --------------------------------------------------------------------------- #

def _build_scored_candidate(
    bullet: Bullet,
    similarity: float,
) -> ScoredCandidate:
    """Build a ScoredCandidate from embedding similarity (no LLM judge)."""
    # Convert similarity [0,1] to a match_score [0,100]
    # Scale: 0.4+ sim = strong match (80+), 0.3 = decent (60), 0.2 = weak (40)
    match_score = min(100.0, max(0.0, similarity * 200.0))

    # Sub-scores estimated from similarity (since we have no LLM judge)
    base = round(similarity * 100, 1)
    sub = SubScores(
        keyword=base,
        semantic=base,
        evidence=base,
        quantification=base,
        seniority=base,
        recency=base,
    )

    return ScoredCandidate(
        bullet_id=bullet.bullet_id,
        source_id=bullet.source_id,
        source_label=bullet.source_label,
        text=bullet.text,
        match_score=round(match_score, 1),
        confidence=round(min(1.0, similarity * 2.0), 2),
        sub_scores=sub,
        rationale=f"Embedding similarity: {similarity:.3f}",
        supporting_span="",
    )


# --------------------------------------------------------------------------- #
#  Main lookup function
# --------------------------------------------------------------------------- #

def rank_bullets_from_map(
    qual: Qualification,
    bullets: list[Bullet],
    top_k: int = 3,
) -> QualCandidates:
    """Rank bullets for a qualification using the precomputed map.

    1. Hash qual text -> look up in map -> use precomputed top-10
    2. If not found -> embed with OpenAI -> cosine against all bullets
    3. Return top-K as ScoredCandidates

    Zero Groq LLM calls.
    """
    qmap = _load_map()
    bullet_map = {b.bullet_id: b for b in bullets}
    qhash = _qual_hash(qual.text)

    # Try map lookup
    map_entry = qmap.get("quals", {}).get(qhash)

    if map_entry:
        # Map hit — use precomputed rankings
        ranked_ids = map_entry.get("bullets", [])[:top_k]
        sims = map_entry.get("sim", [])[:top_k]

        candidates = []
        for bid, sim in zip(ranked_ids, sims):
            bullet = bullet_map.get(bid)
            if bullet:
                candidates.append(_build_scored_candidate(bullet, sim))

        logger.info(
            "map_hit",
            qual_id=qual.id,
            qual_hash=qhash,
            candidates=len(candidates),
        )

        return QualCandidates(qualification=qual, candidates=candidates)

    # Map miss — embed and compute similarity
    logger.info("map_miss", qual_id=qual.id, qual_text=qual.text[:60])

    bullet_vecs, bullet_ids = _get_bullet_embeddings(bullets)
    qvec = _embed_single(qual.text)
    qvec = qvec / np.linalg.norm(qvec)

    sims = bullet_vecs @ qvec  # (73,)
    top_idx = np.argsort(-sims)[:top_k]

    candidates = []
    for idx in top_idx:
        bid = bullet_ids[idx]
        bullet = bullet_map.get(bid)
        if bullet:
            candidates.append(_build_scored_candidate(bullet, float(sims[idx])))

    return QualCandidates(qualification=qual, candidates=candidates)


def rank_all_from_map(
    quals: list[Qualification],
    bullets: list[Bullet],
    top_k: int = 3,
) -> list[QualCandidates]:
    """Rank bullets for all qualifications. Map hits are free, misses use OpenAI."""
    t0 = time.time()
    results = [rank_bullets_from_map(q, bullets, top_k) for q in quals]

    qmap = _load_map()
    hits = sum(
        1 for q in quals if _qual_hash(q.text) in qmap.get("quals", {})
    )
    misses = len(quals) - hits

    logger.info(
        "map_ranking_complete",
        total=len(quals),
        hits=hits,
        misses=misses,
        openai_calls=misses,
        duration_ms=round((time.time() - t0) * 1000),
    )

    return results

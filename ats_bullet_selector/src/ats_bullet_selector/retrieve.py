"""Semantic retrieval: embed bullets, cache on disk, top-K by cosine similarity."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Optional

import numpy as np
import structlog

from .config import (
    EMBEDDING_MODEL_NAME,
    EMBEDDINGS_CACHE_DIR,
    RETRIEVAL_TOP_K,
    SEMANTIC_SIM_FLOOR,
)
from .models import Bullet, Qualification
from .normalize import compute_literal_coverage

logger = structlog.get_logger()

# Lazy-loaded model
_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
        logger.info("embedding_model_loaded", model=EMBEDDING_MODEL_NAME)
    return _model


# --------------------------------------------------------------------------- #
#  Disk cache for embeddings
# --------------------------------------------------------------------------- #

def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _cache_path(content_hash: str) -> Path:
    EMBEDDINGS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return EMBEDDINGS_CACHE_DIR / f"{content_hash}.npy"


def _load_cached_embedding(content_hash: str) -> Optional[np.ndarray]:
    p = _cache_path(content_hash)
    if p.exists():
        return np.load(p)
    return None


def _save_embedding(content_hash: str, vec: np.ndarray) -> None:
    np.save(_cache_path(content_hash), vec)


# --------------------------------------------------------------------------- #
#  Embedding functions
# --------------------------------------------------------------------------- #

def embed_text(text: str) -> np.ndarray:
    """Embed a single text string, using disk cache."""
    ch = _content_hash(text)
    cached = _load_cached_embedding(ch)
    if cached is not None:
        return cached

    model = _get_model()
    vec = model.encode(text, normalize_embeddings=True)
    vec = np.array(vec, dtype=np.float32)
    _save_embedding(ch, vec)
    return vec


def embed_texts(texts: list[str]) -> np.ndarray:
    """Embed multiple texts, using disk cache where available.

    Returns a (len(texts), dim) array.
    """
    results: list[np.ndarray] = []
    uncached_indices: list[int] = []
    uncached_texts: list[str] = []

    for i, text in enumerate(texts):
        ch = _content_hash(text)
        cached = _load_cached_embedding(ch)
        if cached is not None:
            results.append(cached)
        else:
            results.append(np.empty(0))  # placeholder
            uncached_indices.append(i)
            uncached_texts.append(text)

    if uncached_texts:
        model = _get_model()
        vecs = model.encode(uncached_texts, normalize_embeddings=True)
        for idx, vec in zip(uncached_indices, vecs):
            vec = np.array(vec, dtype=np.float32)
            results[idx] = vec
            _save_embedding(_content_hash(texts[idx]), vec)
        logger.info(
            "embeddings_computed",
            cached=len(texts) - len(uncached_texts),
            computed=len(uncached_texts),
        )

    return np.stack(results)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two vectors (assumed already normalized)."""
    return float(np.dot(a, b))


# --------------------------------------------------------------------------- #
#  Top-K retrieval
# --------------------------------------------------------------------------- #

def retrieve_top_k(
    qualification: Qualification,
    bullets: list[Bullet],
    top_k: int = RETRIEVAL_TOP_K,
    sim_floor: float = SEMANTIC_SIM_FLOOR,
) -> list[tuple[Bullet, float, float]]:
    """Retrieve top-K bullets for a qualification by semantic similarity.

    Returns list of (bullet, semantic_sim, literal_coverage) tuples,
    sorted by semantic_sim descending. Bullets where semantic_sim < sim_floor
    AND literal_coverage == 0 are discarded.
    """
    if not bullets:
        return []

    qual_vec = embed_text(qualification.text)
    bullet_vecs = embed_texts([b.text for b in bullets])

    results: list[tuple[Bullet, float, float]] = []
    for i, bullet in enumerate(bullets):
        sim = cosine_similarity(qual_vec, bullet_vecs[i])
        lit_cov = compute_literal_coverage(qualification.text, bullet.text)

        # Discard if both signals are weak
        if sim < sim_floor and lit_cov == 0.0:
            continue

        results.append((bullet, float(sim), float(lit_cov)))

    # Sort by semantic_sim descending
    results.sort(key=lambda x: x[1], reverse=True)

    return results[:top_k]


def get_cache_size() -> int:
    """Return number of cached embedding files."""
    if not EMBEDDINGS_CACHE_DIR.exists():
        return 0
    return len(list(EMBEDDINGS_CACHE_DIR.glob("*.npy")))

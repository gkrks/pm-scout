"""Voyage AI contextual embeddings for resume bullet ranking.

Uses voyage-context-3 to embed bullets WITH contextual awareness of their
parent role/company section, producing higher-quality semantic representations
than flat text-embedding models.

Feature flag: EMBEDDER_PROVIDER=voyage (in config.py).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import structlog

from .config import (
    VOYAGE_API_KEY,
    VOYAGE_MAX_RETRIES,
    VOYAGE_MODEL,
    VOYAGE_OUTPUT_DIMENSION,
    VOYAGE_OUTPUT_DTYPE,
    VOYAGE_TIMEOUT_S,
)
from .models import Bullet, Qualification

logger = structlog.get_logger()

# Voyage AI per-chunk token limit. The contextualized_embed endpoint accepts
# documents as lists of chunks; each chunk has a token ceiling.
# voyage-context-3 supports up to 16000 tokens per document and 1000 tokens
# per chunk. We conservatively cap at 500 chars (~125 tokens) per bullet text
# to stay well within limits even with multi-byte characters.
_MAX_CHUNK_CHARS = 500

# Maximum texts per single embed API call (Voyage batch limit).
_MAX_BATCH_SIZE = 128


# --------------------------------------------------------------------------- #
#  Data structures
# --------------------------------------------------------------------------- #


@dataclass
class RoleGroup:
    """A group of bullets from the same role/source for contextual embedding.

    The context (source_label, role, dates) is passed to Voyage as the document
    context that surrounds each bullet chunk — enabling contextual embeddings.
    """

    source_id: str
    source_label: str
    role: str
    dates: str  # e.g. "2023-01 to 2024-06" or "2023-01 to Present"
    bullets: list[Bullet] = field(default_factory=list)


# --------------------------------------------------------------------------- #
#  Client management
# --------------------------------------------------------------------------- #

_voyage_client = None


def _get_client():
    """Lazy-init the Voyage AI client."""
    global _voyage_client
    if _voyage_client is not None:
        return _voyage_client

    if not VOYAGE_API_KEY:
        raise RuntimeError(
            "VOYAGE_API_KEY not set. Required when EMBEDDER_PROVIDER=voyage."
        )

    import voyageai

    _voyage_client = voyageai.Client(api_key=VOYAGE_API_KEY, timeout=VOYAGE_TIMEOUT_S)
    return _voyage_client


# --------------------------------------------------------------------------- #
#  Retry helper
# --------------------------------------------------------------------------- #


def _retry_with_backoff(fn, max_retries: int = VOYAGE_MAX_RETRIES):
    """Execute fn() with exponential backoff on failure."""
    last_err: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            return fn()
        except Exception as e:
            last_err = e
            err_str = str(e).lower()
            # Don't retry on auth errors
            if "401" in err_str or "403" in err_str or "invalid" in err_str:
                raise
            wait = min(2 ** attempt * 2, 30)
            logger.warning(
                "voyage_retry",
                attempt=attempt + 1,
                max_retries=max_retries,
                wait_s=wait,
                error=str(e),
            )
            time.sleep(wait)
    raise last_err  # type: ignore[misc]


# --------------------------------------------------------------------------- #
#  Core embedding functions
# --------------------------------------------------------------------------- #


def embed_bullets_contextual(
    role_groups: list[RoleGroup],
) -> tuple[np.ndarray, list[str]]:
    """Embed all bullets with contextual awareness of their parent role.

    Uses Voyage AI's contextualized_embed endpoint where each role group
    becomes a "document" and each bullet is a "chunk" within that document.

    Args:
        role_groups: List of RoleGroup objects, each containing bullets
                     grouped by their source role/company.

    Returns:
        Tuple of:
          - (N_bullets, 1024) float32 ndarray of L2-normalized embeddings
          - Ordered list of bullet_ids corresponding to each row

    Raises:
        RuntimeError: If VOYAGE_API_KEY is not set.
        ValueError: If role_groups is empty or contains no bullets.
    """
    # Collect all bullets and their contexts
    all_bullet_ids: list[str] = []
    documents: list[list[str]] = []
    bullet_to_doc_chunk: list[tuple[int, int]] = []  # (doc_idx, chunk_idx)

    for group in role_groups:
        if not group.bullets:
            continue

        # Build the document as a list of chunks.
        # First chunk is the context header; remaining chunks are bullets.
        context_header = f"{group.source_label} | {group.role} | {group.dates}"
        chunks = [context_header]

        for bullet in group.bullets:
            text = bullet.text[:_MAX_CHUNK_CHARS]
            chunks.append(text)
            doc_idx = len(documents)
            chunk_idx = len(chunks) - 1  # 0-indexed within this doc
            bullet_to_doc_chunk.append((doc_idx, chunk_idx))
            all_bullet_ids.append(bullet.bullet_id)

        documents.append(chunks)

    if not all_bullet_ids:
        return np.empty((0, VOYAGE_OUTPUT_DIMENSION), dtype=np.float32), []

    # Call Voyage contextualized_embed
    # API signature: inputs = List[List[str]] where each inner list is a document's chunks
    client = _get_client()

    def _call_embed():
        return client.contextualized_embed(
            inputs=documents,
            model=VOYAGE_MODEL,
            input_type="document",
        )

    t0 = time.time()
    result = _retry_with_backoff(_call_embed)
    duration_ms = round((time.time() - t0) * 1000)

    # Extract embeddings for bullet chunks only (skip context headers at index 0)
    # result.results is a list of per-document results
    # Each result.results[i].embeddings is a list of per-chunk embeddings
    all_embeddings: list[list[float]] = []

    for doc_idx, chunk_idx in bullet_to_doc_chunk:
        embedding = result.results[doc_idx].embeddings[chunk_idx]
        all_embeddings.append(embedding)

    vecs = np.array(all_embeddings, dtype=np.float32)

    # L2-normalize (voyage-context-3 returns normalized vectors, but be safe)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)  # avoid division by zero
    vecs = vecs / norms

    logger.info(
        "voyage_bullets_embedded",
        total_bullets=len(all_bullet_ids),
        total_documents=len(documents),
        dimension=vecs.shape[1] if vecs.ndim == 2 else 0,
        duration_ms=duration_ms,
    )

    return vecs, all_bullet_ids


def embed_qualifications(quals: list[Qualification]) -> np.ndarray:
    """Embed qualifications as query vectors for similarity search.

    Each qualification is embedded as a standalone single-chunk document
    using contextualized_embed (same API as bullets) so vectors live in
    the same embedding space.

    Args:
        quals: List of Qualification objects to embed.

    Returns:
        (N_quals, 1024) float32 ndarray of L2-normalized embeddings.

    Raises:
        RuntimeError: If VOYAGE_API_KEY is not set.
    """
    if not quals:
        return np.empty((0, VOYAGE_OUTPUT_DIMENSION), dtype=np.float32)

    texts = [q.text[:_MAX_CHUNK_CHARS] for q in quals]
    client = _get_client()

    # Embed qualifications as single-chunk documents via contextualized_embed
    # This ensures they're in the same embedding space as the bullets
    all_vecs: list[np.ndarray] = []

    for i in range(0, len(texts), _MAX_BATCH_SIZE):
        batch = texts[i : i + _MAX_BATCH_SIZE]
        # Each qual becomes a single-chunk document
        documents = [[text] for text in batch]

        def _call_embed(documents=documents):
            return client.contextualized_embed(
                inputs=documents,
                model=VOYAGE_MODEL,
                input_type="query",
            )

        result = _retry_with_backoff(_call_embed)
        # Each document has 1 chunk -> 1 embedding
        batch_embeddings = [result.results[j].embeddings[0] for j in range(len(batch))]
        batch_vecs = np.array(batch_embeddings, dtype=np.float32)
        all_vecs.append(batch_vecs)

    vecs = np.concatenate(all_vecs, axis=0) if len(all_vecs) > 1 else all_vecs[0]

    # L2-normalize
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)
    vecs = vecs / norms

    logger.info(
        "voyage_quals_embedded",
        count=len(quals),
        dimension=vecs.shape[1] if vecs.ndim == 2 else 0,
    )

    return vecs


# --------------------------------------------------------------------------- #
#  Utility: build RoleGroups from flat bullet list
# --------------------------------------------------------------------------- #


def bullets_to_role_groups(bullets: list[Bullet]) -> list[RoleGroup]:
    """Group a flat list of Bullets into RoleGroups by source_id.

    This is the adapter between the existing flat bullet list (used by
    map_lookup.py) and the contextual embedding API which needs grouped input.
    """
    groups: dict[str, RoleGroup] = {}

    for bullet in bullets:
        if bullet.source_id not in groups:
            # Derive dates range from bullet
            end = bullet.end_date or "Present"
            dates = f"{bullet.start_date} to {end}"
            groups[bullet.source_id] = RoleGroup(
                source_id=bullet.source_id,
                source_label=bullet.source_label,
                role=bullet.role,
                dates=dates,
            )
        groups[bullet.source_id].bullets.append(bullet)

    return list(groups.values())

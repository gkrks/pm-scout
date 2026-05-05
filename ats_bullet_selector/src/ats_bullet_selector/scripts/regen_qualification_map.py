"""Regenerate qualification_map.json using specified embedding provider.

Usage:
    python -m ats_bullet_selector.scripts.regen_qualification_map --provider voyage
    python -m ats_bullet_selector.scripts.regen_qualification_map --provider openai

Reads master resume from Supabase (source of truth), groups bullets by source_id,
embeds contextually (voyage) or flat (openai), then writes a new qualification map.

Output:
  - outputs/qualification_map.voyage.json   (when --provider voyage)
  - outputs/qualification_map.openai.json   (when --provider openai)

Does NOT overwrite the existing qualification_map.json. Both maps coexist during
validation; the EMBEDDER_PROVIDER env var selects which is active at runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import structlog

# Ensure the package is importable when run as module
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ats_bullet_selector.config import OUTPUTS_DIR, SUPABASE_KEY, SUPABASE_URL
from ats_bullet_selector.db import load_master_resume
from ats_bullet_selector.models import Bullet, Qualification, QualKind

logger = structlog.get_logger()


def _qual_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def _load_all_qualifications() -> list[Qualification]:
    """Load all qualifications from Supabase job_listings table."""
    import httpx

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Supabase credentials not configured")

    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

    quals: list[Qualification] = []
    seen_hashes: set[str] = set()
    offset = 0
    batch = 1000

    while True:
        resp = httpx.get(
            f"{SUPABASE_URL}/rest/v1/job_listings",
            params={
                "select": "jd_required_qualifications,jd_preferred_qualifications",
                "is_active": "eq.true",
                "offset": str(offset),
                "limit": str(batch),
            },
            headers=headers,
            timeout=15.0,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            break

        for row in rows:
            for kind_str, col in [
                ("basic", "jd_required_qualifications"),
                ("preferred", "jd_preferred_qualifications"),
            ]:
                items = row.get(col) or []
                for text in items:
                    if not text or not text.strip():
                        continue
                    h = _qual_hash(text.strip())
                    if h not in seen_hashes:
                        seen_hashes.add(h)
                        quals.append(Qualification(
                            id=f"q_{kind_str}_{len(quals)}",
                            kind=QualKind(kind_str),
                            text=text.strip(),
                        ))

        if len(rows) < batch:
            break
        offset += batch

    logger.info("qualifications_loaded", count=len(quals))
    return quals


def _embed_with_openai(bullets: list[Bullet], quals: list[Qualification]):
    """Embed using OpenAI text-embedding-3-large (existing behavior)."""
    from ats_bullet_selector.map_lookup import _embed_texts_openai

    bullet_vecs = _embed_texts_openai([b.text for b in bullets])
    qual_vecs = _embed_texts_openai([q.text for q in quals])
    bullet_ids = [b.bullet_id for b in bullets]
    return bullet_vecs, qual_vecs, bullet_ids


def _embed_with_voyage(bullets: list[Bullet], quals: list[Qualification]):
    """Embed using Voyage AI voyage-context-3 with contextual chunking."""
    from ats_bullet_selector.embed_voyage import (
        bullets_to_role_groups,
        embed_bullets_contextual,
        embed_qualifications,
    )

    role_groups = bullets_to_role_groups(bullets)
    bullet_vecs, bullet_ids = embed_bullets_contextual(role_groups)
    qual_vecs = embed_qualifications(quals)
    return bullet_vecs, qual_vecs, bullet_ids


def _build_map(
    provider: str,
    bullets: list[Bullet],
    quals: list[Qualification],
    bullet_vecs: np.ndarray,
    qual_vecs: np.ndarray,
    bullet_ids: list[str],
    top_k: int = 3,
) -> dict:
    """Build qualification map from embeddings."""
    # Cosine similarity matrix: (N_quals, N_bullets)
    sim_matrix = qual_vecs @ bullet_vecs.T

    # Build bullet lookup
    bullet_map = {b.bullet_id: b for b in bullets}

    # Build quals dict
    quals_dict: dict[str, dict] = {}
    for i, qual in enumerate(quals):
        qhash = _qual_hash(qual.text)
        sims = sim_matrix[i]
        top_idx = np.argsort(-sims)[:top_k]

        ranked_ids = [bullet_ids[idx] for idx in top_idx]
        ranked_sims = [round(float(sims[idx]), 4) for idx in top_idx]

        quals_dict[qhash] = {
            "t": qual.text,
            "type": qual.kind.value,
            "group": "",  # grouping deferred to later
            "freq": 1,
            "bullets": ranked_ids,
            "sim": ranked_sims,
        }

    # Build groups by source_id
    groups: dict[str, dict] = {}
    for b in bullets:
        if b.source_id not in groups:
            groups[b.source_id] = {
                "label": b.source_label,
                "role": b.role,
                "count": 0,
            }
        groups[b.source_id]["count"] += 1

    # Build bullet metadata
    bullets_meta: dict[str, dict] = {}
    for b in bullets:
        bullets_meta[b.bullet_id] = {
            "source_id": b.source_id,
            "source_label": b.source_label,
            "text": b.text,
        }

    model_name = "voyage-context-3" if provider == "voyage" else "text-embedding-3-large"
    dim = int(bullet_vecs.shape[1]) if bullet_vecs.ndim == 2 else 0

    return {
        "v": 2,
        "embedder_provider": provider,
        "embedding_model": model_name,
        "embedding_dim": dim,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "quals": len(quals_dict),
            "bullets": len(bullets),
            "groups": len(groups),
        },
        "bullets": bullets_meta,
        "groups": groups,
        "resume": {},
        "quals": quals_dict,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Regenerate qualification_map.json with specified embedding provider."
    )
    parser.add_argument(
        "--provider",
        choices=["voyage", "openai"],
        required=True,
        help="Embedding provider to use.",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=3,
        help="Number of top bullets to store per qualification (default: 3).",
    )
    args = parser.parse_args()

    logger.info("regen_start", provider=args.provider, top_k=args.top_k)
    t0 = time.time()

    # Load data
    bullets = load_master_resume()
    logger.info("bullets_loaded", count=len(bullets))

    quals = _load_all_qualifications()
    if not quals:
        logger.error("no_qualifications_found")
        sys.exit(1)

    # Embed
    if args.provider == "voyage":
        bullet_vecs, qual_vecs, bullet_ids = _embed_with_voyage(bullets, quals)
    else:
        bullet_vecs, qual_vecs, bullet_ids = _embed_with_openai(bullets, quals)

    # Build map
    map_data = _build_map(
        provider=args.provider,
        bullets=bullets,
        quals=quals,
        bullet_vecs=bullet_vecs,
        qual_vecs=qual_vecs,
        bullet_ids=bullet_ids,
        top_k=args.top_k,
    )

    # Write output
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUTS_DIR / f"qualification_map.{args.provider}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(map_data, f, indent=2, ensure_ascii=False)

    duration_s = round(time.time() - t0, 1)
    size_mb = round(output_path.stat().st_size / (1024 * 1024), 2)
    logger.info(
        "regen_complete",
        provider=args.provider,
        output=str(output_path),
        quals=len(quals),
        bullets=len(bullets),
        size_mb=size_mb,
        duration_s=duration_s,
    )


if __name__ == "__main__":
    main()

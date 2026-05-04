"""LLM judge: scores each (qualification, bullet) pair via Groq."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Optional

import structlog

from .config import (
    GROQ_API_KEY,
    JUDGE_CACHE_DIR,
    JUDGE_CONCURRENCY_CAP,
    JUDGE_MAX_TOKENS,
    JUDGE_MODEL,
    JUDGE_TEMPERATURE,
    PROMPTS_DIR,
)
from .models import Bullet, JudgeResult, Qualification

logger = structlog.get_logger()

# --------------------------------------------------------------------------- #
#  System prompt loading + hashing
# --------------------------------------------------------------------------- #

_system_prompt: Optional[str] = None
_system_prompt_hash: Optional[str] = None


def _load_system_prompt() -> str:
    global _system_prompt, _system_prompt_hash
    if _system_prompt is None:
        path = PROMPTS_DIR / "judge_v1.md"
        _system_prompt = path.read_text(encoding="utf-8")
        _system_prompt_hash = "sha256:" + hashlib.sha256(
            _system_prompt.encode("utf-8")
        ).hexdigest()[:16]
    return _system_prompt


def get_system_prompt_hash() -> str:
    _load_system_prompt()
    return _system_prompt_hash  # type: ignore[return-value]


# --------------------------------------------------------------------------- #
#  Cache
# --------------------------------------------------------------------------- #

def _cache_key(
    qual_id: str,
    bullet_id: str,
    literal_coverage: float,
    semantic_sim: float,
) -> str:
    _load_system_prompt()
    raw = "|".join([
        _system_prompt_hash or "",
        JUDGE_MODEL,
        qual_id,
        bullet_id,
        f"{literal_coverage:.4f}",
        f"{semantic_sim:.4f}",
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_path(key: str) -> Path:
    JUDGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return JUDGE_CACHE_DIR / f"{key}.json"


def _load_cached(key: str) -> Optional[JudgeResult]:
    p = _cache_path(key)
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        return JudgeResult(**data)
    return None


def _save_cache(key: str, result: JudgeResult) -> None:
    p = _cache_path(key)
    p.write_text(result.model_dump_json(), encoding="utf-8")


def get_judge_cache_size() -> int:
    if not JUDGE_CACHE_DIR.exists():
        return 0
    return len(list(JUDGE_CACHE_DIR.glob("*.json")))


# --------------------------------------------------------------------------- #
#  Groq client (lazy)
# --------------------------------------------------------------------------- #

_client = None


def _get_client():
    global _client
    if _client is None:
        from groq import Groq
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


# --------------------------------------------------------------------------- #
#  User message builder
# --------------------------------------------------------------------------- #

def _build_user_message(
    qual: Qualification,
    bullet: Bullet,
    literal_coverage: float,
    semantic_sim: float,
    ats_vendor: Optional[str],
) -> str:
    return json.dumps({
        "qualification_text": qual.text,
        "qualification_kind": qual.kind.value,
        "bullet_text": bullet.text,
        "bullet_role": bullet.role,
        "recency_months": bullet.recency_months or 0,
        "literal_coverage": round(literal_coverage, 4),
        "semantic_sim": round(semantic_sim, 4),
        "ats_vendor": ats_vendor or "unknown",
    }, indent=None)


# --------------------------------------------------------------------------- #
#  Judge a single pair
# --------------------------------------------------------------------------- #

def judge_pair(
    qual: Qualification,
    bullet: Bullet,
    literal_coverage: float,
    semantic_sim: float,
    ats_vendor: Optional[str] = None,
) -> JudgeResult:
    """Score a single (qualification, bullet) pair. Synchronous."""
    key = _cache_key(qual.id, bullet.bullet_id, literal_coverage, semantic_sim)
    cached = _load_cached(key)
    if cached is not None:
        logger.debug(
            "judge_cache_hit",
            qual_id=qual.id,
            bullet_id=bullet.bullet_id,
        )
        return cached

    system_prompt = _load_system_prompt()
    user_msg = _build_user_message(qual, bullet, literal_coverage, semantic_sim, ats_vendor)

    raw = _call_groq_with_retry(system_prompt, user_msg)

    try:
        data = json.loads(raw)
        result = JudgeResult(
            semantic_relevance=_clamp(data.get("semantic_relevance", 0), 0, 10),
            evidence_strength=_clamp(data.get("evidence_strength", 0), 0, 10),
            quantification=_clamp(data.get("quantification", 0), 0, 10),
            seniority_scope=_clamp(data.get("seniority_scope", 0), 0, 10),
            self_confidence=_clamp(data.get("self_confidence", 0.5), 0.0, 1.0),
            supporting_span=str(data.get("supporting_span", "")),
            rationale=str(data.get("rationale", ""))[:200],
        )
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(
            "judge_parse_error",
            qual_id=qual.id,
            bullet_id=bullet.bullet_id,
            error=str(e),
            raw=raw[:200],
        )
        # Retry once
        raw = _call_groq_with_retry(system_prompt, user_msg)
        data = json.loads(raw)
        result = JudgeResult(
            semantic_relevance=_clamp(data.get("semantic_relevance", 0), 0, 10),
            evidence_strength=_clamp(data.get("evidence_strength", 0), 0, 10),
            quantification=_clamp(data.get("quantification", 0), 0, 10),
            seniority_scope=_clamp(data.get("seniority_scope", 0), 0, 10),
            self_confidence=_clamp(data.get("self_confidence", 0.5), 0.0, 1.0),
            supporting_span=str(data.get("supporting_span", "")),
            rationale=str(data.get("rationale", ""))[:200],
        )

    _save_cache(key, result)
    logger.info(
        "judge_scored",
        qual_id=qual.id,
        bullet_id=bullet.bullet_id,
        semantic_relevance=result.semantic_relevance,
        evidence_strength=result.evidence_strength,
        model_version=JUDGE_MODEL,
        cache_hit=False,
    )
    return result


# --------------------------------------------------------------------------- #
#  Async batch judging with concurrency cap
# --------------------------------------------------------------------------- #

async def judge_pairs_async(
    pairs: list[tuple[Qualification, Bullet, float, float]],
    ats_vendor: Optional[str] = None,
    concurrency: int = JUDGE_CONCURRENCY_CAP,
) -> list[JudgeResult]:
    """Judge multiple pairs concurrently with a semaphore cap.

    Each tuple is (qualification, bullet, literal_coverage, semantic_sim).
    Returns results in the same order as input.
    """
    semaphore = asyncio.Semaphore(concurrency)
    loop = asyncio.get_event_loop()

    async def _judge_one(
        qual: Qualification,
        bullet: Bullet,
        lit_cov: float,
        sem_sim: float,
    ) -> JudgeResult:
        async with semaphore:
            return await loop.run_in_executor(
                None, judge_pair, qual, bullet, lit_cov, sem_sim, ats_vendor
            )

    tasks = [
        _judge_one(qual, bullet, lit_cov, sem_sim)
        for qual, bullet, lit_cov, sem_sim in pairs
    ]
    return await asyncio.gather(*tasks)


# --------------------------------------------------------------------------- #
#  Helpers
# --------------------------------------------------------------------------- #

def _call_groq_with_retry(
    system_prompt: str,
    user_msg: str,
    max_retries: int = 30,
) -> str:
    """Call Groq with automatic retry on rate-limit (429) errors.

    Groq free tier has 12K TPM. Each judge call uses ~2.5K tokens,
    so we can do ~4 calls/min. For 182 pairs this takes ~30 min
    on a cold cache. Be patient.
    """
    client = _get_client()
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=JUDGE_MODEL,
                temperature=JUDGE_TEMPERATURE,
                max_tokens=JUDGE_MAX_TOKENS,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
            )
            return response.choices[0].message.content or "{}"
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate_limit" in err_str.lower():
                # Extract wait time from error message
                wait = 15.0
                match = re.search(r"try again in ([\d.]+)s", err_str, re.IGNORECASE)
                if match:
                    wait = float(match.group(1)) + 2.0
                logger.warning(
                    "judge_rate_limited",
                    attempt=attempt + 1,
                    wait_seconds=wait,
                )
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"Groq rate limit exceeded after {max_retries} retries")


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))

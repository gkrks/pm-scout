"""Keyword carryability check — deterministic, no LLM.

Determines whether a resume bullet can naturally carry a JD keyword in its
output. This is used by the ILP keyword coverage constraint to decide which
bullets are eligible to satisfy each must-have keyword.

IMPORTANT: This module is deterministic by design. Do NOT add LLM calls.
The gate must be verifiable by string matching.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

import structlog

logger = structlog.get_logger()


@dataclass
class KeywordTerm:
    """Mirrors the TypeScript KeywordTerm from jdKeywordExtractor.ts."""

    canonical: str
    aliases: list[str]
    category: str
    required: bool
    weight: float = 1.0


def carryable(bullet_text: str, keyword: KeywordTerm) -> float:
    """Determine if a bullet can carry a keyword without fabrication.

    Returns:
        1.0 — bullet text already contains keyword canonical or any alias
              (case-insensitive, word-boundary with optional suffix).
        0.0 — bullet cannot carry the keyword without fabrication.

    Implementation:
        - Check direct contains for canonical and each alias.
        - Word-boundary matching with suffix tolerance (s, ly, ing, ed).
        - If neither matches, return 0.0.
        - Do NOT use the LLM for this; it must be deterministic.
    """
    text_lower = bullet_text.lower()

    # Check canonical and all aliases
    all_forms = [keyword.canonical] + keyword.aliases
    # Deduplicate
    seen: set[str] = set()
    unique_forms: list[str] = []
    for form in all_forms:
        fl = form.lower().strip()
        if fl and fl not in seen:
            seen.add(fl)
            unique_forms.append(fl)

    for form in unique_forms:
        # Word-boundary regex with suffix tolerance
        # No plain substring check — it would match inside other words
        escaped = re.escape(form)
        pattern = re.compile(rf"\b{escaped}(?:s|ly|ing|ed|es|tion|ment)?\b", re.IGNORECASE)
        if pattern.search(bullet_text):
            return 1.0

    return 0.0


def find_eligible_bullets(
    bullet_texts: dict[str, str],
    keyword: KeywordTerm,
    min_score: float = 0.85,
) -> list[str]:
    """Find all bullet IDs that can carry a keyword.

    Args:
        bullet_texts: Dict of {bullet_id: bullet_text}
        keyword: The keyword to check carryability for.
        min_score: Minimum carryable() score to be considered eligible.

    Returns:
        List of bullet_ids that can carry the keyword.
    """
    eligible: list[str] = []
    for bid, text in bullet_texts.items():
        score = carryable(text, keyword)
        if score >= min_score:
            eligible.append(bid)
    return eligible

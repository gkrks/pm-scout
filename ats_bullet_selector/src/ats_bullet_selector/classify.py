"""Deterministic qualification classifier. Routes quals by category (0 LLM calls)."""

from __future__ import annotations

import re

from .models import QualCategory, Qualification

_EDUCATION_PATTERNS = re.compile(
    r"\b(degree|bachelor|master|b\.?s\.?|m\.?s\.?|b\.?tech|ph\.?d|graduated|university|diploma)\b",
    re.IGNORECASE,
)

# Only match GENERIC years-of-experience requirements (not domain-specific ones).
# "3+ years of product management experience" -> experience_years
# "2+ years with technical architecture of complex web apps" -> bullet_match
# The key: if the text has 10+ words AFTER the years pattern, it's domain-specific.
_EXPERIENCE_YEARS_PATTERN = re.compile(
    r"\d+\+?\s*years?\s*(of\s*)?(experience|professional|working|in\s+a\b)?",
    re.IGNORECASE,
)

_DOMAIN_SPECIFIC_YEARS = re.compile(
    r"\d+\+?\s*years?\s*(of\s*)?\w+\s+\w+\s+\w+\s+\w+",
    re.IGNORECASE,
)

_VALUES_KEYWORDS = [
    "passion",
    "hunger",
    "comfortable with ambiguity",
    "self-starter",
    "curious",
    "growth mindset",
    "thrives",
    "entrepreneurial",
    "deep interest",
    "eager to learn",
    "intellectually curious",
    "bias for action",
    "ownership mentality",
]

_VALUES_PATTERN = re.compile(
    "|".join(re.escape(kw) for kw in _VALUES_KEYWORDS),
    re.IGNORECASE,
)

_MAX_SKILL_CHECK_WORDS = 8


def classify_qualifications(
    qualifications: list[Qualification],
    resume_skills: list[str],
) -> list[Qualification]:
    """Classify each qualification into a routing category.

    Mutates and returns the same list with .category populated.
    """
    skills_lower = {s.lower() for s in resume_skills}

    for qual in qualifications:
        qual.category = _classify_one(qual.text, skills_lower)

    return qualifications


def _classify_one(text: str, skills_lower: set[str]) -> QualCategory:
    if _EDUCATION_PATTERNS.search(text):
        return QualCategory.education_check

    # Only route to experience_years if it's a SHORT, GENERIC years requirement.
    # "3+ years experience" -> experience_years (short, generic)
    # "2+ years with technical architecture of complex web apps" -> bullet_match (domain-specific)
    if _EXPERIENCE_YEARS_PATTERN.search(text):
        word_count = len(text.split())
        has_domain_detail = _DOMAIN_SPECIFIC_YEARS.search(text)
        # Short + generic = experience_years; long + specific = bullet_match
        if word_count <= 12 and not has_domain_detail:
            return QualCategory.experience_years

    if _VALUES_PATTERN.search(text):
        return QualCategory.values_statement

    word_count = len(text.split())
    if word_count <= _MAX_SKILL_CHECK_WORDS:
        text_lower = text.lower()
        for skill in skills_lower:
            if skill in text_lower and len(skill) > 1:
                return QualCategory.skill_check

    return QualCategory.bullet_match

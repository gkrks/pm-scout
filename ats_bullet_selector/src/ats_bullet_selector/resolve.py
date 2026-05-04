"""Non-bullet resolvers for education, experience-years, and skill-check quals (0 LLM calls)."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from .models import PreResolvedResult, QualCategory, Qualification

# --------------------------------------------------------------------------- #
#  Education resolver
# --------------------------------------------------------------------------- #

_DEGREE_LEVELS = {
    "phd": ["ph.d", "phd", "doctorate", "doctoral"],
    "master": ["master", "m.s.", "ms", "m.s", "m.eng", "mba", "m.a."],
    "bachelor": ["bachelor", "b.s.", "bs", "b.s", "b.tech", "b.a.", "b.eng"],
}

_CS_FIELDS = [
    "computer science",
    "computer engineering",
    "cs",
    "software engineering",
    "information technology",
    "computing",
    "engineering",
]


def resolve_education(qual: Qualification, resume: dict[str, Any]) -> PreResolvedResult:
    """Check education section for degree match."""
    qual_lower = qual.text.lower()
    education = resume.get("education", [])

    required_level = None
    for level, keywords in _DEGREE_LEVELS.items():
        for kw in keywords:
            if kw in qual_lower:
                required_level = level
                break
        if required_level:
            break

    required_field = None
    for field in _CS_FIELDS:
        if field in qual_lower:
            required_field = field
            break

    for entry in education:
        degree_str = (entry.get("degree") or "").lower()
        major_str = (entry.get("major") or "").lower()
        combined = f"{degree_str} {major_str}"

        level_match = True
        if required_level:
            level_match = any(
                kw in combined for kw in _DEGREE_LEVELS[required_level]
            )

        field_match = True
        if required_field:
            field_match = any(f in combined for f in _CS_FIELDS)

        if level_match and field_match:
            return PreResolvedResult(
                qualification_id=qual.id,
                category=QualCategory.education_check,
                met=True,
                evidence=entry.get("degree", ""),
                confidence=1.0,
                source_section="education",
            )

    return PreResolvedResult(
        qualification_id=qual.id,
        category=QualCategory.education_check,
        met=False,
        evidence="",
        confidence=1.0,
        source_section="education",
    )


# --------------------------------------------------------------------------- #
#  Experience years resolver
# --------------------------------------------------------------------------- #

_YEARS_PATTERN = re.compile(r"(\d+)\+?\s*years?", re.IGNORECASE)


def resolve_experience_years(qual: Qualification, resume: dict[str, Any]) -> PreResolvedResult:
    """Compute total experience years from start/end dates."""
    match = _YEARS_PATTERN.search(qual.text)
    if not match:
        return PreResolvedResult(
            qualification_id=qual.id,
            category=QualCategory.experience_years,
            met=False,
            evidence="Could not parse required years",
            confidence=0.5,
            source_section="experiences",
        )

    required_years = int(match.group(1))
    today = date.today()
    total_months = 0.0
    contributions: list[str] = []

    for exp in resume.get("experiences", []):
        start_raw = exp.get("start_date")
        end_raw = exp.get("end_date")
        if not start_raw:
            continue

        start = _parse_date(start_raw)
        end = _parse_date(end_raw) if end_raw else today
        if not start or not end:
            continue

        months = (end.year - start.year) * 12 + (end.month - start.month)
        if months > 0:
            total_months += months
            years_str = f"{months / 12:.1f}y"
            contributions.append(f"{exp.get('company', '?')} ({years_str})")

    total_years = total_months / 12.0
    met = total_years >= required_years
    evidence = f"{total_years:.1f} years total: {' + '.join(contributions)}"

    return PreResolvedResult(
        qualification_id=qual.id,
        category=QualCategory.experience_years,
        met=met,
        evidence=evidence,
        confidence=1.0,
        source_section="experiences",
    )


# --------------------------------------------------------------------------- #
#  Skill check resolver
# --------------------------------------------------------------------------- #


def resolve_skill_check(qual: Qualification, resume: dict[str, Any]) -> PreResolvedResult:
    """Check if a skill mentioned in the qual exists in the skills section."""
    qual_lower = qual.text.lower()
    all_skills: list[str] = []

    for group in resume.get("skills", []):
        all_skills.extend(group.get("skills", []))

    matched_skills: list[str] = []
    for skill in all_skills:
        if skill.lower() in qual_lower:
            matched_skills.append(skill)

    if matched_skills:
        return PreResolvedResult(
            qualification_id=qual.id,
            category=QualCategory.skill_check,
            met=True,
            evidence=f"Skills found: {', '.join(matched_skills)}",
            confidence=0.9,
            source_section="skills",
        )

    return PreResolvedResult(
        qualification_id=qual.id,
        category=QualCategory.skill_check,
        met=False,
        evidence="",
        confidence=0.9,
        source_section="skills",
    )


# --------------------------------------------------------------------------- #
#  Helpers
# --------------------------------------------------------------------------- #


def _parse_date(raw: str) -> date | None:
    """Parse 'YYYY-MM-DD' or 'YYYY-MM' into a date."""
    parts = raw.split("-")
    try:
        if len(parts) >= 3:
            return date(int(parts[0]), int(parts[1]), int(parts[2]))
        if len(parts) == 2:
            return date(int(parts[0]), int(parts[1]), 1)
    except (ValueError, IndexError):
        pass
    return None

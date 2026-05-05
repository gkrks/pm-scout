"""Role profile system: load YAML profiles, detect role family, expand acronyms.

Role profiles drive keyword taxonomies, ILP weights, and rewriter rules.
Currently only PM is fully populated; others are stubs for future expansion.

Key functions:
  - load_role_profile(family) -> RoleProfile
  - detect_role_family(jd_title, jd_body) -> str
  - expand_acronyms(text, profile) -> str
  - canonicalize_term(term) -> str
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import structlog
import yaml

logger = structlog.get_logger()

# --------------------------------------------------------------------------- #
#  Paths
# --------------------------------------------------------------------------- #

_REPO_ROOT = Path(__file__).resolve().parents[3]  # JobSearch/
_PROFILES_DIR = _REPO_ROOT / "role_profiles"
_SHARED_DIR = _PROFILES_DIR / "_shared"


# --------------------------------------------------------------------------- #
#  Exceptions
# --------------------------------------------------------------------------- #


class StubProfileError(Exception):
    """Raised when a stub profile is requested for live scoring."""

    pass


class ProfileNotFoundError(Exception):
    """Raised when a role profile YAML does not exist."""

    pass


# --------------------------------------------------------------------------- #
#  Data classes
# --------------------------------------------------------------------------- #


@dataclass
class KeywordCategory:
    name: str
    weight: int
    terms: list[str]


@dataclass
class BulletFormat:
    primary: str  # "xyz" or "car"
    fallback: str
    char_limit: int
    must_have_components: list[str]


@dataclass
class RubricWeights:
    basic: dict[str, float]
    preferred: dict[str, float]


@dataclass
class AcronymPolicy:
    always_spell_out: dict[str, str]  # acronym -> expansion
    keep_as_acronym: list[str]


@dataclass
class RoleProfile:
    role_family: str
    display_name: str
    status: Optional[str]  # None for live profiles, "stub" for stubs
    title_patterns: list[str]
    responsibilities_signals: list[str]
    keyword_taxonomy: dict[str, KeywordCategory]
    bullet_format: BulletFormat
    rubric_weights: RubricWeights
    banned_phrases: list[str]  # merged: global + role-specific
    preferred_verbs: list[str]
    acronym_policy: AcronymPolicy
    synonyms: dict[str, list[str]]  # canonical -> aliases


# --------------------------------------------------------------------------- #
#  YAML caches
# --------------------------------------------------------------------------- #

_shared_cache: dict[str, Any] = {}
_profile_cache: dict[str, RoleProfile] = {}


def _load_shared_yaml(name: str) -> Any:
    """Load a _shared/ YAML file, cached."""
    if name in _shared_cache:
        return _shared_cache[name]

    path = _SHARED_DIR / f"{name}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"Shared YAML not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    _shared_cache[name] = data
    return data


def _load_profile_yaml(family: str) -> dict:
    """Load a role profile YAML by family name."""
    path = _PROFILES_DIR / f"{family}.yaml"
    if not path.exists():
        raise ProfileNotFoundError(f"Role profile not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# --------------------------------------------------------------------------- #
#  Loaders
# --------------------------------------------------------------------------- #


def _resolve_inherit(section: Any, parent_family: str, section_name: str) -> Any:
    """Resolve 'inherit: <family>' directives by loading from parent."""
    if isinstance(section, dict) and "inherit" in section:
        parent = _load_profile_yaml(section["inherit"])
        return parent.get(section_name, section)
    return section


def load_role_profile(family: str, allow_stub: bool = False) -> RoleProfile:
    """Load a role profile by family name.

    Args:
        family: Role family identifier (e.g., "pm", "swe", "tpm").
        allow_stub: If False (default), raises StubProfileError for stub profiles.
                    Set True only for detection/metadata purposes, not live scoring.

    Returns:
        Fully resolved RoleProfile with shared config merged in.

    Raises:
        StubProfileError: If profile has status="stub" and allow_stub=False.
        ProfileNotFoundError: If YAML file doesn't exist.
    """
    cache_key = f"{family}:{allow_stub}"
    if cache_key in _profile_cache:
        return _profile_cache[cache_key]

    raw = _load_profile_yaml(family)

    # Check stub status
    status = raw.get("status")
    if status == "stub" and not allow_stub:
        raise StubProfileError(
            f"Role profile '{family}' is a stub and cannot be used for live scoring. "
            f"Only the following profiles are fully populated: pm"
        )

    # Load shared config
    synonyms_data = _load_shared_yaml("synonyms")
    acronym_data = _load_shared_yaml("acronym_policy")
    banned_data = _load_shared_yaml("banned_phrases")

    # Resolve inheritance for bullet_format and rubric_weights
    bullet_format_raw = _resolve_inherit(
        raw.get("bullet_format", {}), family, "bullet_format"
    )
    rubric_weights_raw = _resolve_inherit(
        raw.get("rubric_weights", {}), family, "rubric_weights"
    )

    # Build keyword taxonomy
    taxonomy: dict[str, KeywordCategory] = {}
    for cat_name, cat_data in (raw.get("keyword_taxonomy") or {}).items():
        if isinstance(cat_data, dict):
            taxonomy[cat_name] = KeywordCategory(
                name=cat_name,
                weight=cat_data.get("weight", 1),
                terms=cat_data.get("terms", []),
            )

    # Build bullet format
    bullet_format = BulletFormat(
        primary=bullet_format_raw.get("primary", "xyz"),
        fallback=bullet_format_raw.get("fallback", "car"),
        char_limit=bullet_format_raw.get("char_limit", 225),
        must_have_components=bullet_format_raw.get("must_have_components", []),
    )

    # Build rubric weights
    rubric_weights = RubricWeights(
        basic=rubric_weights_raw.get("basic", {}),
        preferred=rubric_weights_raw.get("preferred", {}),
    )

    # Build acronym policy
    acronym_policy = AcronymPolicy(
        always_spell_out=acronym_data.get("always_spell_out", {}),
        keep_as_acronym=acronym_data.get("keep_as_acronym", []),
    )

    # Merge banned phrases: global + role-specific
    global_banned = banned_data.get("global", [])
    role_banned = raw.get("banned_phrases", [])
    merged_banned = list(dict.fromkeys(global_banned + role_banned))  # dedup, preserve order

    # Build synonyms map
    synonyms = synonyms_data.get("canonical_to_aliases", {})

    profile = RoleProfile(
        role_family=raw.get("role_family", family),
        display_name=raw.get("display_name", family),
        status=status,
        title_patterns=raw.get("detection", {}).get("title_patterns", []),
        responsibilities_signals=raw.get("detection", {}).get("responsibilities_signals", []),
        keyword_taxonomy=taxonomy,
        bullet_format=bullet_format,
        rubric_weights=rubric_weights,
        banned_phrases=merged_banned,
        preferred_verbs=raw.get("preferred_verbs", []),
        acronym_policy=acronym_policy,
        synonyms=synonyms,
    )

    _profile_cache[cache_key] = profile
    return profile


# --------------------------------------------------------------------------- #
#  Role detection
# --------------------------------------------------------------------------- #

# Detection order: most specific to most general.
# TPM checked before program_manager (to avoid "technical program manager" matching "program manager").
# PA and data_analyst checked before PM (to avoid "product analyst" matching on the fallback).
# SWE patterns are specific enough to not collide.
# PM is last as the broadest catch-all.
_DETECTION_ORDER = [
    "tpm",
    "pa",
    "data_analyst",
    "engineering_manager",
    "swe",
    "program_manager",
    "pm",
]


def detect_role_family(jd_title: str, jd_body: str = "") -> str:
    """Detect role family from JD title using substring matching.

    Args:
        jd_title: Job title string (e.g., "Senior Product Manager, Growth").
        jd_body: Optional JD body text for signal strengthening (future use).

    Returns:
        Role family string (e.g., "pm", "swe", "tpm").
        Falls back to "pm" if nothing matches; logs a warning.

    Detection logic:
        - Patterns are checked case-insensitive via substring matching.
        - Families are checked in _DETECTION_ORDER (most specific first).
        - If multiple families match, the one with the LONGEST matching pattern wins.
    """
    title_lower = jd_title.lower()

    best_match: Optional[tuple[str, str, int]] = None  # (family, pattern, length)

    for family in _DETECTION_ORDER:
        try:
            profile = load_role_profile(family, allow_stub=True)
        except (ProfileNotFoundError, FileNotFoundError):
            continue

        for pattern in profile.title_patterns:
            pattern_lower = pattern.lower()
            if pattern_lower in title_lower:
                if best_match is None or len(pattern_lower) > best_match[2]:
                    best_match = (family, pattern, len(pattern_lower))

    if best_match is not None:
        logger.debug(
            "role_family_detected",
            family=best_match[0],
            pattern=best_match[1],
            title=jd_title,
        )
        return best_match[0]

    # Fallback to PM
    logger.warning(
        "role_family_fallback",
        title=jd_title,
        fallback="pm",
        note="No title pattern matched; defaulting to pm.",
    )
    return "pm"


# --------------------------------------------------------------------------- #
#  Acronym expansion (for resume output)
# --------------------------------------------------------------------------- #

def expand_acronyms(text: str, profile: RoleProfile) -> str:
    """Expand acronyms in text per the acronym policy.

    Expands terms in always_spell_out. Leaves keep_as_acronym terms untouched.
    Uses word-boundary matching only; does not expand inside other words.

    Args:
        text: Text to process (e.g., a rewritten bullet).
        profile: RoleProfile containing the acronym_policy.

    Returns:
        Text with acronyms expanded where appropriate.
    """
    # Build set of terms to keep (case-insensitive lookup)
    keep_set = {t.lower() for t in profile.acronym_policy.keep_as_acronym}

    result = text
    for acronym, expansion in profile.acronym_policy.always_spell_out.items():
        # Skip if this acronym is also in keep list (shouldn't happen, but safety)
        if acronym.lower() in keep_set:
            continue

        # Word-boundary match, case-insensitive
        # Escape special regex chars in the acronym (e.g., "B.S.", "FP&A")
        escaped = re.escape(acronym)
        pattern = rf"\b{escaped}\b"
        result = re.sub(pattern, expansion, result, flags=re.IGNORECASE)

    return result


# --------------------------------------------------------------------------- #
#  Canonicalization (for keyword matching)
# --------------------------------------------------------------------------- #

# Lazy-built reverse map: alias_lower -> canonical_lower
_alias_to_canonical: Optional[dict[str, str]] = None


def _build_alias_map() -> dict[str, str]:
    """Build reverse alias -> canonical mapping from synonyms.yaml."""
    global _alias_to_canonical
    if _alias_to_canonical is not None:
        return _alias_to_canonical

    synonyms_data = _load_shared_yaml("synonyms")
    canonical_to_aliases = synonyms_data.get("canonical_to_aliases", {})

    mapping: dict[str, str] = {}
    for canonical, aliases in canonical_to_aliases.items():
        canonical_lower = canonical.lower()
        for alias in aliases:
            mapping[alias.lower()] = canonical_lower

    _alias_to_canonical = mapping
    return mapping


def canonicalize_term(term: str) -> str:
    """Return the canonical form for a term.

    "PRD" -> "product requirements document"
    "a/b testing" -> "a/b testing" (already canonical)
    Unknown terms returned unchanged, lowercased.

    Args:
        term: Term to canonicalize (case-insensitive).

    Returns:
        Canonical form (lowercased).
    """
    alias_map = _build_alias_map()
    term_lower = term.lower().strip()
    return alias_map.get(term_lower, term_lower)


# --------------------------------------------------------------------------- #
#  Cache clearing (for tests)
# --------------------------------------------------------------------------- #


def clear_caches():
    """Clear all module-level caches. For testing only."""
    global _shared_cache, _profile_cache, _alias_to_canonical
    _shared_cache = {}
    _profile_cache = {}
    _alias_to_canonical = None

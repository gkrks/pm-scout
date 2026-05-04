"""Acronym/synonym expansion and text normalization.

Augments text with both canonical and abbreviated forms so that
literal matchers see both surface forms. Does NOT replace -- only appends.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml
import structlog

from .config import SYNONYMS_PATH, SPACY_MODEL

logger = structlog.get_logger()

# Lazy-loaded spaCy model
_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        import spacy
        _nlp = spacy.load(SPACY_MODEL)
    return _nlp


# --------------------------------------------------------------------------- #
#  Synonym map
# --------------------------------------------------------------------------- #

class SynonymMap:
    """Bidirectional synonym/acronym lookup.

    For each entry in synonyms.yaml, every variant maps to the canonical form,
    and the canonical form maps to all its variants.
    """

    def __init__(self, path: Optional[Path] = None):
        self._canon_to_variants: dict[str, list[str]] = {}
        self._variant_to_canon: dict[str, str] = {}
        self._load(path or SYNONYMS_PATH)

    def _load(self, path: Path) -> None:
        with open(path, "r", encoding="utf-8") as f:
            entries = yaml.safe_load(f) or []

        for entry in entries:
            canonical = entry["canonical"]
            variants = entry.get("variants", [])
            canon_lower = canonical.lower()

            if canon_lower not in self._canon_to_variants:
                self._canon_to_variants[canon_lower] = []

            for v in variants:
                v_lower = v.lower()
                self._canon_to_variants[canon_lower].append(v_lower)
                self._variant_to_canon[v_lower] = canon_lower

        logger.info(
            "synonym_map_loaded",
            canonical_count=len(self._canon_to_variants),
            variant_count=len(self._variant_to_canon),
        )

    def expand(self, text: str) -> str:
        """Augment text with synonym expansions.

        For each recognized term (variant or canonical) found in the text,
        append the counterpart forms in parentheses if not already present.
        """
        expanded = text

        # Check variants -> add canonical
        for variant, canonical in self._variant_to_canon.items():
            pattern = re.compile(re.escape(variant), re.IGNORECASE)
            if pattern.search(expanded) and not re.search(
                re.escape(canonical), expanded, re.IGNORECASE
            ):
                expanded = pattern.sub(
                    lambda m: f"{m.group(0)} ({canonical})", expanded, count=1
                )

        # Check canonical -> add first variant
        for canonical, variants in self._canon_to_variants.items():
            pattern = re.compile(re.escape(canonical), re.IGNORECASE)
            if pattern.search(expanded) and variants:
                first_variant = variants[0]
                if not re.search(
                    re.escape(first_variant), expanded, re.IGNORECASE
                ):
                    expanded = pattern.sub(
                        lambda m, fv=first_variant: f"{m.group(0)} ({fv})",
                        expanded,
                        count=1,
                    )

        return expanded

    def get_canonical(self, term: str) -> Optional[str]:
        """Return canonical form if term is a known variant, else None."""
        return self._variant_to_canon.get(term.lower())

    def get_variants(self, term: str) -> list[str]:
        """Return variants if term is a known canonical, else empty list."""
        return self._canon_to_variants.get(term.lower(), [])


@lru_cache(maxsize=1)
def get_synonym_map() -> SynonymMap:
    """Singleton synonym map."""
    return SynonymMap()


# --------------------------------------------------------------------------- #
#  Noun chunk extraction
# --------------------------------------------------------------------------- #

def extract_noun_chunks(text: str) -> list[str]:
    """Extract noun phrases via spaCy noun_chunks, lowercased and lemmatized.

    Large chunks containing 'and'/'or' are split into sub-chunks.
    Individual content-word lemmas (nouns, proper nouns, adjectives) are also
    included to catch partial matches within compound phrases.
    """
    nlp = _get_nlp()
    doc = nlp(text)
    chunks: list[str] = []
    seen: set[str] = set()

    for chunk in doc.noun_chunks:
        lemmatized = " ".join(token.lemma_.lower() for token in chunk)
        if lemmatized not in seen:
            chunks.append(lemmatized)
            seen.add(lemmatized)

        # Split on "and" / "or" conjunctions within the chunk
        sub_tokens: list[list] = [[]]
        for token in chunk:
            if token.text.lower() in ("and", "or", ","):
                if sub_tokens[-1]:
                    sub_tokens.append([])
            else:
                sub_tokens[-1].append(token)

        if len(sub_tokens) > 1:
            for group in sub_tokens:
                if group:
                    sub = " ".join(t.lemma_.lower() for t in group)
                    if sub not in seen:
                        chunks.append(sub)
                        seen.add(sub)

    # Add individual content-word lemmas (nouns, proper nouns)
    for token in doc:
        if token.pos_ in ("NOUN", "PROPN") and not token.is_stop:
            lem = token.lemma_.lower()
            if lem not in seen and len(lem) > 1:
                chunks.append(lem)
                seen.add(lem)

    return chunks


def lemmatize(text: str) -> str:
    """Lemmatize all tokens in text, lowercased."""
    nlp = _get_nlp()
    doc = nlp(text)
    return " ".join(token.lemma_.lower() for token in doc)


# --------------------------------------------------------------------------- #
#  Literal coverage computation
# --------------------------------------------------------------------------- #

def compute_literal_coverage(
    qual_text: str,
    bullet_text: str,
    canonical_terms: Optional[list[str]] = None,
) -> float:
    """Fraction of qualification noun-phrases present in the bullet text.

    Args:
        qual_text: The qualification text.
        bullet_text: The bullet text (already synonym-expanded).
        canonical_terms: Additional canonical terms from the qualification record.

    Returns:
        Coverage in [0, 1]. Returns 0.0 if no chunks found.
    """
    syn_map = get_synonym_map()
    qual_expanded = syn_map.expand(qual_text)
    bullet_expanded = syn_map.expand(bullet_text)

    chunks = extract_noun_chunks(qual_expanded)
    if canonical_terms:
        chunks.extend(t.lower() for t in canonical_terms)

    if not chunks:
        return 0.0

    bullet_lemmatized = lemmatize(bullet_expanded)

    matched = 0
    for chunk in chunks:
        if chunk in bullet_lemmatized:
            matched += 1

    return matched / len(chunks)

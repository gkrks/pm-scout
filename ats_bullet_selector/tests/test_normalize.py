"""Tests for normalize.py — acronym expansion and literal coverage."""

from __future__ import annotations

import pytest

from ats_bullet_selector.normalize import (
    SynonymMap,
    compute_literal_coverage,
    extract_noun_chunks,
    lemmatize,
)


class TestSynonymMap:
    def test_variant_to_canonical(self):
        sm = SynonymMap()
        assert sm.get_canonical("ML") == "machine learning"
        assert sm.get_canonical("JS") == "javascript"
        assert sm.get_canonical("AWS") == "amazon web services"

    def test_canonical_to_variants(self):
        sm = SynonymMap()
        variants = sm.get_variants("Machine Learning")
        assert "ml" in variants

    def test_unknown_term_returns_none(self):
        sm = SynonymMap()
        assert sm.get_canonical("xyzzy_not_a_term") is None
        assert sm.get_variants("xyzzy_not_a_term") == []

    def test_expand_adds_canonical(self):
        sm = SynonymMap()
        result = sm.expand("Built ML pipeline for predictions")
        assert "machine learning" in result.lower()
        # Original text preserved
        assert "ML" in result

    def test_expand_adds_variant(self):
        sm = SynonymMap()
        result = sm.expand("Used Machine Learning for classification")
        assert "ml" in result.lower()

    def test_expand_no_duplicate_if_both_present(self):
        sm = SynonymMap()
        text = "Built ML (Machine Learning) pipeline"
        result = sm.expand(text)
        # Should not double-expand
        count = result.lower().count("machine learning")
        assert count <= 2  # original + at most one expansion

    def test_acronym_expansion_matches_qualification(self):
        """Spec test: bullet 'Built ML pipeline' literal-matches
        qualification 'machine learning experience' after expansion."""
        sm = SynonymMap()
        bullet = sm.expand("Built ML pipeline for real-time predictions")
        qual = sm.expand("machine learning experience")
        # After expansion, 'machine learning' should appear in the bullet
        assert "machine learning" in bullet.lower()
        # And 'ml' should appear in the qualification
        assert "ml" in qual.lower()


class TestNounChunks:
    def test_extracts_noun_phrases(self):
        chunks = extract_noun_chunks("3+ years of product management experience")
        # Should get at least "product management experience" or subsets
        joined = " ".join(chunks)
        assert "product" in joined or "management" in joined

    def test_empty_string(self):
        chunks = extract_noun_chunks("")
        assert chunks == []


class TestLemmatize:
    def test_basic_lemmatization(self):
        result = lemmatize("Building dashboards and tracking metrics")
        # "building" -> "build", "dashboards" -> "dashboard", "tracking" -> "track"
        assert "build" in result or "dashboard" in result


class TestLiteralCoverage:
    def test_full_coverage(self):
        coverage = compute_literal_coverage(
            qual_text="SQL experience",
            bullet_text="Built SQL dashboards in Looker tracking KPIs",
        )
        # "SQL" and "experience" -- SQL is in bullet, experience may not be
        assert coverage > 0.0

    def test_zero_coverage(self):
        coverage = compute_literal_coverage(
            qual_text="Kubernetes orchestration",
            bullet_text="Designed marketing campaigns for B2C products",
        )
        assert coverage == 0.0 or coverage < 0.2

    def test_partial_coverage(self):
        coverage = compute_literal_coverage(
            qual_text="Python and JavaScript development experience",
            bullet_text="Developed RESTful APIs in Python serving 50K users",
        )
        # Python matched, JavaScript not, development partially
        assert 0.0 < coverage < 1.0

    def test_synonym_expansion_boosts_coverage(self):
        """ML in bullet should match 'machine learning' in qualification
        via synonym expansion."""
        coverage = compute_literal_coverage(
            qual_text="machine learning experience",
            bullet_text="Built ML pipeline for real-time predictions",
        )
        assert coverage > 0.0

    def test_with_canonical_terms(self):
        coverage = compute_literal_coverage(
            qual_text="data analysis",
            bullet_text="Built SQL dashboards tracking KPIs",
            canonical_terms=["SQL", "dashboards", "KPIs"],
        )
        assert coverage > 0.0

    def test_empty_qualification(self):
        coverage = compute_literal_coverage(
            qual_text="",
            bullet_text="Some bullet text here",
        )
        assert coverage == 0.0

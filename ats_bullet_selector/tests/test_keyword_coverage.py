"""Tests for Phase 4: keyword coverage constraint in ILP.

Tests:
  1. Keyword K with only 1 carrier bullet -> ILP must select that bullet
  2. Keyword K with no carrier -> ILP completes with K in impossible_keywords
  3. Basic ILP behavior preserved when KEYWORD_COVERAGE_ENABLED=False
  4. carryable() function correctness
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from ats_bullet_selector.keyword_carry import KeywordTerm, carryable, find_eligible_bullets
from ats_bullet_selector.models import (
    Bullet,
    FinalSelection,
    QualCandidates,
    QualKind,
    Qualification,
    ScoredCandidate,
    SourceType,
    SubScores,
)


# --------------------------------------------------------------------------- #
#  Fixtures
# --------------------------------------------------------------------------- #


def _bullet(bid: str, sid: str, text: str) -> Bullet:
    return Bullet(
        bullet_id=bid,
        source_id=sid,
        source_type=SourceType.experience,
        source_label=f"Company -- Role",
        role="PM",
        start_date="2023-01",
        end_date="2024-01",
        text=text,
        technologies=[],
        recency_months=6.0,
    )


def _scored(bid: str, sid: str, text: str, score: float) -> ScoredCandidate:
    return ScoredCandidate(
        bullet_id=bid,
        source_id=sid,
        source_label="Company -- Role",
        text=text,
        match_score=score,
        confidence=score / 100.0,
        sub_scores=SubScores(
            keyword=score / 2, semantic=score / 2,
            evidence=score / 2, quantification=score / 2,
            seniority=score / 2, recency=score / 2,
        ),
        rationale="test",
        supporting_span="",
    )


def _keyword(canonical: str, aliases: list[str] | None = None) -> KeywordTerm:
    return KeywordTerm(
        canonical=canonical,
        aliases=aliases or [canonical],
        category="product_craft",
        required=True,
    )


# --------------------------------------------------------------------------- #
#  carryable() tests
# --------------------------------------------------------------------------- #


class TestCarryable:
    """Test the deterministic carryable function."""

    def test_direct_match(self):
        """Bullet containing exact keyword -> 1.0."""
        score = carryable(
            "Built SQL dashboards for analytics",
            _keyword("sql", ["sql"]),
        )
        assert score == 1.0

    def test_alias_match(self):
        """Bullet containing an alias -> 1.0."""
        score = carryable(
            "Defined PRD for new feature launch",
            _keyword("product requirements document", ["product requirements document", "prd"]),
        )
        assert score == 1.0

    def test_suffix_match(self):
        """Bullet containing plural/verb form -> 1.0."""
        score = carryable(
            "Built product roadmaps for 3 teams",
            _keyword("roadmap", ["roadmap", "roadmaps"]),
        )
        assert score == 1.0

    def test_no_match(self):
        """Bullet without keyword or aliases -> 0.0."""
        score = carryable(
            "Led engineering team to ship mobile app",
            _keyword("sql", ["sql", "structured query language"]),
        )
        assert score == 0.0

    def test_case_insensitive(self):
        """Match is case-insensitive."""
        score = carryable(
            "Used SQL and Python for analysis",
            _keyword("sql", ["sql"]),
        )
        assert score == 1.0

    def test_word_boundary(self):
        """Should not match inside other words."""
        score = carryable(
            "Consulted on API design",
            _keyword("sul", ["sul"]),
        )
        assert score == 0.0

    def test_adverb_form(self):
        """cross-functional -> cross-functionally matches."""
        score = carryable(
            "Partnered cross-functionally with engineering",
            _keyword("cross-functional", ["cross-functional", "cross functional"]),
        )
        assert score == 1.0


class TestFindEligibleBullets:
    """Test find_eligible_bullets helper."""

    def test_finds_carriers(self):
        texts = {
            "b1": "Built SQL dashboards",
            "b2": "Led product roadmap definition",
            "b3": "Shipped mobile app",
        }
        eligible = find_eligible_bullets(texts, _keyword("sql", ["sql"]))
        assert eligible == ["b1"]

    def test_no_carriers(self):
        texts = {
            "b1": "Led team to ship feature",
            "b2": "Grew engagement 40%",
        }
        eligible = find_eligible_bullets(texts, _keyword("sql", ["sql"]))
        assert eligible == []

    def test_multiple_carriers(self):
        texts = {
            "b1": "Ran SQL queries for analysis",
            "b2": "Built SQL dashboards",
            "b3": "Shipped mobile app",
        }
        eligible = find_eligible_bullets(texts, _keyword("sql", ["sql"]))
        assert set(eligible) == {"b1", "b2"}


# --------------------------------------------------------------------------- #
#  ILP keyword coverage tests
# --------------------------------------------------------------------------- #


class TestILPKeywordCoverage:
    """Test ILP behavior with keyword coverage constraints."""

    def _make_ranked(self, bullets_and_scores: list[tuple[str, str, str, float]]) -> list[QualCandidates]:
        """Build QualCandidates with a single qualification and given bullet scores."""
        qual = Qualification(id="q_basic_0", kind=QualKind.basic, text="Test qual")
        candidates = [
            _scored(bid, sid, text, score)
            for bid, sid, text, score in bullets_and_scores
        ]
        return [QualCandidates(qualification=qual, candidates=candidates)]

    @patch("ats_bullet_selector.assign.KEYWORD_COVERAGE_ENABLED", True)
    def test_keyword_forces_selection(self):
        """When keyword K is must-have and only b3 carries it, b3 must be selected."""
        from ats_bullet_selector.assign import solve_assignment

        # b1 has highest score but doesn't carry "sql"
        # b2 has medium score and doesn't carry "sql"
        # b3 has lowest score but carries "sql"
        ranked = self._make_ranked([
            ("b1", "s1", "Led team to ship feature with 50% growth", 90.0),
            ("b2", "s2", "Built product roadmap for 3 teams", 80.0),
            ("b3", "s3", "Wrote SQL queries to analyze retention metrics", 50.0),
        ])

        bullet_texts = {
            "b1": "Led team to ship feature with 50% growth",
            "b2": "Built product roadmap for 3 teams",
            "b3": "Wrote SQL queries to analyze retention metrics",
        }

        kw = _keyword("sql", ["sql", "structured query language"])
        result = solve_assignment(
            ranked,
            must_have_keywords=[kw],
            bullet_texts=bullet_texts,
        )

        selected_ids = {sb.bullet_id for sb in result.selected_bullets}
        assert "b3" in selected_ids, f"b3 should be selected for SQL coverage, got {selected_ids}"

    @patch("ats_bullet_selector.assign.KEYWORD_COVERAGE_ENABLED", True)
    def test_impossible_keyword(self):
        """When no bullet can carry keyword K, ILP completes with K in impossible_keywords."""
        from ats_bullet_selector.assign import solve_assignment

        ranked = self._make_ranked([
            ("b1", "s1", "Led team to ship feature with 50% growth", 90.0),
            ("b2", "s2", "Built product roadmap for 3 teams", 80.0),
        ])

        bullet_texts = {
            "b1": "Led team to ship feature with 50% growth",
            "b2": "Built product roadmap for 3 teams",
        }

        # "kubernetes" not in any bullet
        kw = _keyword("kubernetes", ["kubernetes", "k8s"])
        result = solve_assignment(
            ranked,
            must_have_keywords=[kw],
            bullet_texts=bullet_texts,
        )

        assert "kubernetes" in result.impossible_keywords
        assert result.total_score > 0  # ILP still solves

    @patch("ats_bullet_selector.assign.KEYWORD_COVERAGE_ENABLED", False)
    def test_disabled_flag_no_keyword_constraints(self):
        """When KEYWORD_COVERAGE_ENABLED=False, keywords don't affect selection."""
        from ats_bullet_selector.assign import solve_assignment

        ranked = self._make_ranked([
            ("b1", "s1", "Led team to ship feature with 50% growth", 90.0),
            ("b2", "s2", "Wrote SQL queries to analyze retention", 40.0),
        ])

        bullet_texts = {
            "b1": "Led team to ship feature with 50% growth",
            "b2": "Wrote SQL queries to analyze retention",
        }

        kw = _keyword("sql", ["sql"])
        result = solve_assignment(
            ranked,
            must_have_keywords=[kw],
            bullet_texts=bullet_texts,
        )

        # Without keyword constraint, b1 (score 90) should be selected over b2 (score 40)
        selected_ids = {sb.bullet_id for sb in result.selected_bullets}
        assert "b1" in selected_ids
        # uncovered_keywords should be empty when disabled
        assert result.uncovered_keywords == []
        assert result.impossible_keywords == []

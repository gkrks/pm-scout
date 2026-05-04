"""Tests for score.py -- deterministic score aggregation."""

from __future__ import annotations

import pytest

from ats_bullet_selector.models import (
    Bullet,
    JudgeResult,
    QualKind,
    Qualification,
    SourceType,
)
from ats_bullet_selector.score import (
    compute_confidence,
    compute_keyword_score,
    compute_match_score,
    compute_recency_score,
    score_candidate,
)


class TestRecencyScore:
    def test_within_24_months(self):
        assert compute_recency_score(0) == 10.0
        assert compute_recency_score(12) == 10.0
        assert compute_recency_score(24) == 10.0

    def test_decay_after_24_months(self):
        # 30 months: 10 - 0.15 * 6 = 9.1
        score = compute_recency_score(30)
        assert abs(score - 9.1) < 0.01

    def test_far_past_hits_zero(self):
        # 24 + 10/0.15 = ~90.7 months -> 0
        assert compute_recency_score(100) == 0.0

    def test_exactly_at_zero_boundary(self):
        # 10/0.15 = 66.67 months after 24 = 90.67 months
        score = compute_recency_score(90.67)
        assert score < 0.1


class TestKeywordScore:
    def test_full_coverage(self):
        assert compute_keyword_score(1.0) == 10.0

    def test_zero_coverage(self):
        assert compute_keyword_score(0.0) == 0.0

    def test_partial_coverage(self):
        assert abs(compute_keyword_score(0.5) - 5.0) < 0.01


class TestMatchScore:
    def test_perfect_scores_basic(self):
        score = compute_match_score(
            QualKind.basic, 10, 10, 10, 10, 10, 10
        )
        assert abs(score - 100.0) < 0.1

    def test_zero_scores(self):
        score = compute_match_score(
            QualKind.basic, 0, 0, 0, 0, 0, 0
        )
        assert score == 0.0

    def test_basic_vs_preferred_weights_differ(self):
        """Spec test: same pair scored as basic vs preferred yields different scores."""
        # High keyword, low semantic
        basic_score = compute_match_score(
            QualKind.basic, 10, 3, 5, 5, 8, 7
        )
        preferred_score = compute_match_score(
            QualKind.preferred, 10, 3, 5, 5, 8, 7
        )
        # Basic weights keyword higher (.20 vs .10) and seniority higher (.20 vs .10)
        # Preferred weights semantic higher (.30 vs .20) and evidence higher (.20 vs .15)
        # With keyword=10, seniority=8 (high), basic should score higher
        assert basic_score != preferred_score
        assert basic_score > preferred_score

    def test_preferred_favors_semantic(self):
        """When semantic is high and keyword low, preferred should score higher."""
        basic_score = compute_match_score(
            QualKind.basic, 2, 10, 7, 6, 3, 8
        )
        preferred_score = compute_match_score(
            QualKind.preferred, 2, 10, 7, 6, 3, 8
        )
        # Preferred weights semantic at .30 vs basic .20
        assert preferred_score > basic_score

    def test_hand_computed_basic(self):
        """Hand-computed example for basic weights:
        kw=8, sem=7, evi=6, qty=5, sen=9, rec=10
        score = 100 * (.20*0.8 + .20*0.7 + .15*0.6 + .15*0.5 + .20*0.9 + .10*1.0)
             = 100 * (.16 + .14 + .09 + .075 + .18 + .10) = 100 * .745 = 74.5
        """
        score = compute_match_score(QualKind.basic, 8, 7, 6, 5, 9, 10)
        assert abs(score - 74.5) < 0.1


class TestConfidence:
    def test_high_confidence(self):
        conf = compute_confidence(
            self_confidence=0.9,
            literal_coverage=0.8,
            semantic_sim=0.85,
            supporting_span="built ML pipeline",
            bullet_text="built ML pipeline for predictions",
        )
        # 0.5*0.9 + 0.3*(1 - 0.05) + 0.2*(1-0) = 0.45 + 0.285 + 0.2 = 0.935
        assert conf > 0.9

    def test_low_confidence_no_span(self):
        conf = compute_confidence(
            self_confidence=0.3,
            literal_coverage=0.1,
            semantic_sim=0.8,
            supporting_span="not in bullet",
            bullet_text="completely different text here",
        )
        # supporting_span not in bullet -> hedge = 0.3
        # 0.5*0.3 + 0.3*(1-0.7) + 0.2*(1-0.3) = 0.15 + 0.09 + 0.14 = 0.38
        assert conf < 0.5

    def test_bounds(self):
        conf = compute_confidence(1.0, 1.0, 1.0, "x", "x")
        assert 0.0 <= conf <= 1.0
        conf = compute_confidence(0.0, 0.0, 0.0, "", "text")
        assert 0.0 <= conf <= 1.0


class TestScoreCandidate:
    def test_produces_scored_candidate(self):
        qual = Qualification(id="q_basic_0", kind=QualKind.basic, text="PM experience")
        bullet = Bullet(
            bullet_id="b1",
            source_id="s1",
            source_type=SourceType.experience,
            source_label="Acme -- PM",
            role="PM",
            start_date="2022-01",
            end_date="2024-06",
            text="Led product roadmap for 2 years",
            technologies=[],
            recency_months=11.0,
        )
        judge = JudgeResult(
            semantic_relevance=8,
            evidence_strength=7,
            quantification=5,
            seniority_scope=7,
            self_confidence=0.85,
            supporting_span="Led product roadmap for 2 years",
            rationale="Direct PM experience with scope",
        )

        sc = score_candidate(qual, bullet, judge, 0.6, 0.75)
        assert 0 <= sc.match_score <= 100
        assert 0 <= sc.confidence <= 1
        assert sc.bullet_id == "b1"
        assert sc.source_id == "s1"
        assert sc.sub_scores.keyword >= 0
        assert sc.sub_scores.recency >= 0

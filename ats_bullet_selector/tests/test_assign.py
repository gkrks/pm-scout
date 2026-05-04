"""Tests for assign.py -- ILP solver with cap enforcement."""

from __future__ import annotations

import pytest

from ats_bullet_selector.assign import solve_assignment
from ats_bullet_selector.models import (
    QualCandidates,
    Qualification,
    QualKind,
    ScoredCandidate,
    SubScores,
)


def _make_sub_scores(score: float = 50.0) -> SubScores:
    return SubScores(
        keyword=score, semantic=score, evidence=score,
        quantification=score, seniority=score, recency=score,
    )


def _make_candidate(
    bullet_id: str,
    source_id: str,
    match_score: float,
    source_label: str = "",
) -> ScoredCandidate:
    return ScoredCandidate(
        bullet_id=bullet_id,
        source_id=source_id,
        source_label=source_label or source_id,
        text=f"Bullet {bullet_id}",
        match_score=match_score,
        confidence=0.8,
        sub_scores=_make_sub_scores(match_score),
        rationale="test",
        supporting_span="test",
    )


def _make_qual(qid: str, kind: QualKind = QualKind.basic) -> Qualification:
    return Qualification(id=qid, kind=kind, text=f"Qualification {qid}")


class TestCapEnforced:
    def test_cap_enforced(self):
        """Spec test: one experience holds top-1 for 5 qualifications.
        Assert <= 2 picked from it; the other 3 quals get next-best."""
        dominant_source = "exp_dominant"
        other_sources = ["exp_other_1", "exp_other_2", "exp_other_3"]

        ranked = []
        for i in range(5):
            qid = f"q_basic_{i}"
            qual = _make_qual(qid)

            # Dominant source always has highest score
            candidates = [
                _make_candidate(
                    f"b_dom_{i}", dominant_source, 95.0 - i
                ),
            ]
            # Each qual also has candidates from other sources
            for j, src in enumerate(other_sources):
                candidates.append(
                    _make_candidate(
                        f"b_other_{j}_{i}", src, 70.0 - j
                    )
                )
            ranked.append(QualCandidates(qualification=qual, candidates=candidates))

        result = solve_assignment(ranked, source_cap=2)

        # Count how many bullets came from dominant source
        dom_count = sum(
            1 for sb in result.selected_bullets if sb.source_id == dominant_source
        )
        assert dom_count <= 2, f"Dominant source has {dom_count} bullets, expected <= 2"

        # All 5 quals should be covered
        assert len(result.uncovered_qualifications) == 0

        # Source utilization should reflect the cap
        assert result.source_utilization.get(dominant_source, 0) <= 2

    def test_cap_of_1(self):
        """With cap=1, each source can only provide 1 bullet."""
        ranked = []
        for i in range(3):
            qual = _make_qual(f"q_{i}")
            candidates = [
                _make_candidate(f"b_s1_{i}", "src1", 90.0),
                _make_candidate(f"b_s2_{i}", "src2", 80.0),
                _make_candidate(f"b_s3_{i}", "src3", 70.0),
            ]
            ranked.append(QualCandidates(qualification=qual, candidates=candidates))

        result = solve_assignment(ranked, source_cap=1)

        for src, count in result.source_utilization.items():
            assert count <= 1, f"Source {src} has {count} bullets with cap=1"

        assert len(result.uncovered_qualifications) == 0


class TestOptimalUnderCap:
    def test_optimal_under_cap(self):
        """Hand-computed optimum. 3 quals, 2 sources, cap=2.

        q0: s1=90, s2=60
        q1: s1=85, s2=70
        q2: s1=80, s2=65

        Without cap: all from s1 = 90+85+80 = 255
        With cap=2: best is s1 for q0(90) + s1 for q1(85) + s2 for q2(65) = 240
        Or: s1 for q0(90) + s2 for q1(70) + s1 for q2(80) = 240
        Or: s1 for q0(90) + s1 for q2(80) + s2 for q1(70) = 240
        Actually best: s1 gets q0(90) + q1(85), s2 gets q2(65) = 240
        """
        ranked = [
            QualCandidates(
                qualification=_make_qual("q0"),
                candidates=[
                    _make_candidate("b_s1_0", "s1", 90.0),
                    _make_candidate("b_s2_0", "s2", 60.0),
                ],
            ),
            QualCandidates(
                qualification=_make_qual("q1"),
                candidates=[
                    _make_candidate("b_s1_1", "s1", 85.0),
                    _make_candidate("b_s2_1", "s2", 70.0),
                ],
            ),
            QualCandidates(
                qualification=_make_qual("q2"),
                candidates=[
                    _make_candidate("b_s1_2", "s1", 80.0),
                    _make_candidate("b_s2_2", "s2", 65.0),
                ],
            ),
        ]

        result = solve_assignment(ranked, source_cap=2)

        assert result.source_utilization.get("s1", 0) <= 2
        assert len(result.uncovered_qualifications) == 0
        # Optimal is 240 (s1 gets 2 highest-value quals, s2 covers the rest)
        assert result.total_score >= 239.9, f"Score {result.total_score} < expected 240"

    def test_no_cap_needed(self):
        """When all bullets from different sources, cap is irrelevant."""
        ranked = [
            QualCandidates(
                qualification=_make_qual("q0"),
                candidates=[_make_candidate("b1", "s1", 95.0)],
            ),
            QualCandidates(
                qualification=_make_qual("q1"),
                candidates=[_make_candidate("b2", "s2", 90.0)],
            ),
        ]

        result = solve_assignment(ranked, source_cap=2)
        assert abs(result.total_score - 185.0) < 0.1
        assert len(result.uncovered_qualifications) == 0


class TestInfeasibleWarning:
    def test_infeasible_warning(self):
        """Spec test: 7 quals, 3 sources (max 6 bullets with cap=2).
        Assert warning emitted (uncovered_qualifications non-empty),
        fallback engages."""
        ranked = []
        sources = ["s1", "s2", "s3"]
        for i in range(7):
            qual = _make_qual(f"q_{i}")
            candidates = [
                _make_candidate(
                    f"b_{src}_{i}", src, 80.0 - i * 2
                )
                for src in sources
            ]
            ranked.append(QualCandidates(qualification=qual, candidates=candidates))

        result = solve_assignment(ranked, source_cap=2)

        # With 3 sources * cap 2 = 6 max bullets, 7 quals can't all be covered
        # The relaxed solver (<=1 instead of ==1) should cover 6 and leave 1 uncovered
        assert len(result.uncovered_qualifications) >= 1
        assert len(result.selected_bullets) <= 6

        # Verify source caps still respected
        for src, count in result.source_utilization.items():
            assert count <= 2

    def test_empty_input(self):
        """No qualifications -> empty result."""
        result = solve_assignment([], source_cap=2)
        assert result.total_score == 0.0
        assert result.selected_bullets == []

    def test_all_below_floor(self):
        """All candidates below score floor -> all uncovered."""
        ranked = [
            QualCandidates(
                qualification=_make_qual("q0"),
                candidates=[
                    _make_candidate("b1", "s1", 10.0),  # below 30 floor
                ],
            ),
        ]

        result = solve_assignment(ranked, source_cap=2, score_floor=30)
        assert len(result.uncovered_qualifications) == 1


class TestDeterminism:
    def test_same_input_same_output(self):
        """Run solver twice on identical input, get identical output."""
        ranked = []
        for i in range(4):
            qual = _make_qual(f"q_{i}")
            candidates = [
                _make_candidate(f"b_s1_{i}", "s1", 90.0 - i),
                _make_candidate(f"b_s2_{i}", "s2", 85.0 - i),
                _make_candidate(f"b_s3_{i}", "s3", 80.0 - i),
            ]
            ranked.append(QualCandidates(qualification=qual, candidates=candidates))

        r1 = solve_assignment(ranked, source_cap=2)
        r2 = solve_assignment(ranked, source_cap=2)

        assert r1.total_score == r2.total_score
        assert r1.selected_bullets == r2.selected_bullets
        assert r1.source_utilization == r2.source_utilization
        assert r1.uncovered_qualifications == r2.uncovered_qualifications

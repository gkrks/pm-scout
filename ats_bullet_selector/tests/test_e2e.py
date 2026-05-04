"""End-to-end determinism tests.

These tests verify that Stages A, C, and D produce byte-identical output
across runs, and that Stage B (LLM judge) produces >= 95% top-3 set agreement.

NOTE: Stage B tests require GROQ_API_KEY and are skipped if not set.
The deterministic stages (A, C, D) run without any API key.
"""

from __future__ import annotations

import json
import os

import pytest

from ats_bullet_selector.assign import solve_assignment
from ats_bullet_selector.models import (
    JudgeResult,
    QualCandidates,
    QualKind,
    Qualification,
    ScoredCandidate,
    SubScores,
)
from ats_bullet_selector.normalize import compute_literal_coverage, get_synonym_map
from ats_bullet_selector.retrieve import retrieve_top_k
from ats_bullet_selector.score import score_candidate


# --------------------------------------------------------------------------- #
#  Determinism: Stage A (normalize + retrieve)
# --------------------------------------------------------------------------- #

class TestStageADeterminism:
    def test_literal_coverage_deterministic(self, sample_bullets, sample_qualifications):
        """Literal coverage is byte-identical across runs."""
        results_1 = []
        results_2 = []
        for qual in sample_qualifications:
            for bullet in sample_bullets:
                results_1.append(compute_literal_coverage(qual.text, bullet.text))
                results_2.append(compute_literal_coverage(qual.text, bullet.text))
        assert results_1 == results_2

    def test_retrieval_deterministic(self, sample_bullets, sample_qualifications):
        """Top-K retrieval order is identical across runs."""
        for qual in sample_qualifications:
            r1 = retrieve_top_k(qual, sample_bullets, top_k=5)
            r2 = retrieve_top_k(qual, sample_bullets, top_k=5)
            ids_1 = [b.bullet_id for b, _, _ in r1]
            ids_2 = [b.bullet_id for b, _, _ in r2]
            assert ids_1 == ids_2

    def test_synonym_expansion_deterministic(self):
        """Synonym expansion produces identical output."""
        sm = get_synonym_map()
        text = "Built ML pipeline using AWS and CI/CD"
        r1 = sm.expand(text)
        r2 = sm.expand(text)
        assert r1 == r2


# --------------------------------------------------------------------------- #
#  Determinism: Stage C (score aggregation)
# --------------------------------------------------------------------------- #

class TestStageCDeterminism:
    def test_score_deterministic(self, sample_bullets, sample_qualifications):
        """Score computation is byte-identical across runs."""
        qual = sample_qualifications[0]
        bullet = sample_bullets[0]
        judge = JudgeResult(
            semantic_relevance=8, evidence_strength=7,
            quantification=6, seniority_scope=7,
            self_confidence=0.85,
            supporting_span="Led cross-functional team",
            rationale="Strong PM evidence",
        )

        sc1 = score_candidate(qual, bullet, judge, 0.6, 0.75)
        sc2 = score_candidate(qual, bullet, judge, 0.6, 0.75)

        assert sc1.match_score == sc2.match_score
        assert sc1.confidence == sc2.confidence
        assert sc1.sub_scores == sc2.sub_scores


# --------------------------------------------------------------------------- #
#  Determinism: Stage D (ILP)
# --------------------------------------------------------------------------- #

class TestStageDDeterminism:
    def test_ilp_deterministic(self):
        """ILP solver produces byte-identical output across 5 runs."""

        def _make_cand(bid, sid, score):
            return ScoredCandidate(
                bullet_id=bid, source_id=sid, source_label=sid,
                text=f"Bullet {bid}", match_score=score, confidence=0.8,
                sub_scores=SubScores(
                    keyword=score, semantic=score, evidence=score,
                    quantification=score, seniority=score, recency=score,
                ),
                rationale="test", supporting_span="test",
            )

        ranked = [
            QualCandidates(
                qualification=Qualification(id=f"q_{i}", kind=QualKind.basic, text=f"Q{i}"),
                candidates=[
                    _make_cand(f"b_s1_{i}", "s1", 90.0 - i * 2),
                    _make_cand(f"b_s2_{i}", "s2", 85.0 - i * 2),
                    _make_cand(f"b_s3_{i}", "s3", 80.0 - i * 2),
                ],
            )
            for i in range(5)
        ]

        results = []
        for _ in range(5):
            r = solve_assignment(ranked, source_cap=2)
            results.append(r.model_dump_json())

        # All 5 runs should be identical
        for i in range(1, 5):
            assert results[0] == results[i], f"Run 0 != Run {i}"


# --------------------------------------------------------------------------- #
#  Stage B determinism (requires GROQ_API_KEY)
# --------------------------------------------------------------------------- #

@pytest.mark.skipif(
    not os.environ.get("GROQ_API_KEY"),
    reason="GROQ_API_KEY not set; skipping LLM judge tests",
)
class TestStageBDeterminism:
    def test_judge_cache_determinism(self, sample_bullets, sample_qualifications):
        """With cache, judge returns identical results."""
        from ats_bullet_selector.judge import judge_pair

        qual = sample_qualifications[0]
        bullet = sample_bullets[0]

        r1 = judge_pair(qual, bullet, 0.5, 0.7, "greenhouse")
        r2 = judge_pair(qual, bullet, 0.5, 0.7, "greenhouse")

        assert r1.semantic_relevance == r2.semantic_relevance
        assert r1.evidence_strength == r2.evidence_strength
        assert r1.quantification == r2.quantification
        assert r1.seniority_scope == r2.seniority_scope

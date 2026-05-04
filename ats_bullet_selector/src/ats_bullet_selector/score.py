"""Stage C: deterministic score aggregation. No LLM calls."""

from __future__ import annotations

from .config import (
    RECENCY_DECAY_RATE,
    RECENCY_FULL_CREDIT_MONTHS,
    WEIGHTS_BASIC,
    WEIGHTS_PREFERRED,
)
from .models import (
    Bullet,
    JudgeResult,
    QualKind,
    Qualification,
    ScoredCandidate,
    SubScores,
)


def compute_recency_score(recency_months: float) -> float:
    """Recency score on 0-10 scale.

    Full credit (10) if recency_months <= 24.
    Decays by RECENCY_DECAY_RATE per month after that.
    """
    if recency_months <= RECENCY_FULL_CREDIT_MONTHS:
        return 10.0
    return max(0.0, 10.0 - RECENCY_DECAY_RATE * (recency_months - RECENCY_FULL_CREDIT_MONTHS))


def compute_keyword_score(literal_coverage: float) -> float:
    """Keyword score on 0-10 scale. Linear mapping from coverage [0,1]."""
    return 10.0 * literal_coverage


def compute_match_score(
    qual_kind: QualKind,
    keyword_score: float,
    semantic_relevance: float,
    evidence_strength: float,
    quantification: float,
    seniority_scope: float,
    recency_score: float,
) -> float:
    """Weighted match_score on 0-100 scale."""
    w = WEIGHTS_BASIC if qual_kind == QualKind.basic else WEIGHTS_PREFERRED

    score = 100.0 * (
        w["keyword"] * (keyword_score / 10.0)
        + w["semantic"] * (semantic_relevance / 10.0)
        + w["evidence"] * (evidence_strength / 10.0)
        + w["quantification"] * (quantification / 10.0)
        + w["seniority"] * (seniority_scope / 10.0)
        + w["recency"] * (recency_score / 10.0)
    )
    return round(score, 1)


def compute_confidence(
    self_confidence: float,
    literal_coverage: float,
    semantic_sim: float,
    supporting_span: str,
    bullet_text: str,
) -> float:
    """Confidence in [0, 1].

    confidence = 0.5 * self_confidence
               + 0.3 * agreement(literal, semantic)
               + 0.2 * (1 - hedge)
    """
    agreement = 1.0 - abs(literal_coverage - semantic_sim)
    hedge = 0.0 if supporting_span and supporting_span in bullet_text else 0.3
    conf = 0.5 * self_confidence + 0.3 * agreement + 0.2 * (1.0 - hedge)
    return round(min(1.0, max(0.0, conf)), 2)


def score_candidate(
    qual: Qualification,
    bullet: Bullet,
    judge: JudgeResult,
    literal_coverage: float,
    semantic_sim: float,
) -> ScoredCandidate:
    """Combine judge results + deterministic scores into a ScoredCandidate."""
    recency = compute_recency_score(bullet.recency_months or 0.0)
    keyword = compute_keyword_score(literal_coverage)

    match = compute_match_score(
        qual_kind=qual.kind,
        keyword_score=keyword,
        semantic_relevance=judge.semantic_relevance,
        evidence_strength=judge.evidence_strength,
        quantification=judge.quantification,
        seniority_scope=judge.seniority_scope,
        recency_score=recency,
    )

    confidence = compute_confidence(
        self_confidence=judge.self_confidence,
        literal_coverage=literal_coverage,
        semantic_sim=semantic_sim,
        supporting_span=judge.supporting_span,
        bullet_text=bullet.text,
    )

    sub = SubScores(
        keyword=round(keyword * 10, 1),
        semantic=round(judge.semantic_relevance * 10, 1),
        evidence=round(judge.evidence_strength * 10, 1),
        quantification=round(judge.quantification * 10, 1),
        seniority=round(judge.seniority_scope * 10, 1),
        recency=round(recency * 10, 1),
    )

    return ScoredCandidate(
        bullet_id=bullet.bullet_id,
        source_id=bullet.source_id,
        source_label=bullet.source_label,
        text=bullet.text,
        match_score=match,
        confidence=confidence,
        sub_scores=sub,
        rationale=judge.rationale,
        supporting_span=judge.supporting_span,
    )

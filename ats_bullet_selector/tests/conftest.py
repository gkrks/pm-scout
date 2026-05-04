"""Shared test fixtures."""

from __future__ import annotations

import pytest

from ats_bullet_selector.models import Bullet, Qualification, QualKind, SourceType


@pytest.fixture
def sample_bullets() -> list[Bullet]:
    """5-bullet fixture spanning 3 sources."""
    return [
        Bullet(
            bullet_id="exp_acme_1_b1",
            source_id="exp_acme_1",
            source_type=SourceType.experience,
            source_label="Acme Corp -- Senior PM",
            role="Senior PM",
            start_date="2022-01",
            end_date="2024-06",
            text="Led cross-functional team of 8 to ship ML-powered search feature, increasing user engagement 34%",
            technologies=["Python", "Elasticsearch"],
            recency_months=11.0,
        ),
        Bullet(
            bullet_id="exp_acme_1_b2",
            source_id="exp_acme_1",
            source_type=SourceType.experience,
            source_label="Acme Corp -- Senior PM",
            role="Senior PM",
            start_date="2022-01",
            end_date="2024-06",
            text="Defined product roadmap and wrote PRDs for 3 quarterly releases, aligning 4 engineering squads",
            technologies=[],
            recency_months=11.0,
        ),
        Bullet(
            bullet_id="exp_beta_1_b1",
            source_id="exp_beta_1",
            source_type=SourceType.experience,
            source_label="Beta Inc -- PM",
            role="PM",
            start_date="2020-03",
            end_date="2022-01",
            text="Built SQL dashboards in Looker tracking KPIs across 12 B2B SaaS accounts, reducing churn 18%",
            technologies=["SQL", "Looker"],
            recency_months=40.0,
        ),
        Bullet(
            bullet_id="exp_gamma_1_b1",
            source_id="exp_gamma_1",
            source_type=SourceType.experience,
            source_label="Gamma Labs -- SWE",
            role="SWE",
            start_date="2019-01",
            end_date="2020-02",
            text="Developed RESTful APIs in Python and JavaScript serving 50K daily active users",
            technologies=["Python", "JavaScript", "REST"],
            recency_months=63.0,
        ),
        Bullet(
            bullet_id="proj_delta_1_b1",
            source_id="proj_delta_1",
            source_type=SourceType.project,
            source_label="Delta Search Engine",
            role="Delta Search Engine",
            start_date="2023-06",
            end_date=None,
            text="Architected full-text search engine in Rust with BM25 ranking, handling 10K queries/sec on commodity hardware",
            technologies=["Rust", "BM25"],
            recency_months=0.0,
        ),
    ]


@pytest.fixture
def sample_qualifications() -> list[Qualification]:
    """3-qualification fixture."""
    return [
        Qualification(
            id="q_basic_0",
            kind=QualKind.basic,
            text="3+ years of product management experience",
        ),
        Qualification(
            id="q_basic_1",
            kind=QualKind.basic,
            text="Experience with SQL and data analysis",
        ),
        Qualification(
            id="q_preferred_0",
            kind=QualKind.preferred,
            text="Experience building ML-powered features",
        ),
    ]

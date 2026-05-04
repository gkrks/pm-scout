"""Tests for retrieve.py -- embedding cache and top-K retrieval."""

from __future__ import annotations

import numpy as np
import pytest

from ats_bullet_selector.models import Bullet, Qualification, QualKind, SourceType
from ats_bullet_selector.retrieve import (
    cosine_similarity,
    embed_text,
    retrieve_top_k,
)


class TestEmbedding:
    def test_embed_returns_vector(self):
        vec = embed_text("product management experience")
        assert isinstance(vec, np.ndarray)
        assert vec.ndim == 1
        assert vec.shape[0] > 0

    def test_embed_is_normalized(self):
        vec = embed_text("SQL and data analysis")
        norm = np.linalg.norm(vec)
        assert abs(norm - 1.0) < 0.01

    def test_cache_returns_same_result(self):
        text = "cache test determinism"
        v1 = embed_text(text)
        v2 = embed_text(text)
        assert np.allclose(v1, v2)


class TestCosineSimilarity:
    def test_identical_vectors(self):
        v = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        assert abs(cosine_similarity(v, v) - 1.0) < 0.001

    def test_orthogonal_vectors(self):
        a = np.array([1.0, 0.0], dtype=np.float32)
        b = np.array([0.0, 1.0], dtype=np.float32)
        assert abs(cosine_similarity(a, b)) < 0.001


class TestRetrieveTopK:
    def test_returns_sorted_by_similarity(self, sample_bullets, sample_qualifications):
        qual = sample_qualifications[0]  # "3+ years of product management experience"
        results = retrieve_top_k(qual, sample_bullets, top_k=3)
        assert len(results) <= 3
        sims = [r[1] for r in results]
        assert sims == sorted(sims, reverse=True)

    def test_each_result_has_three_elements(self, sample_bullets, sample_qualifications):
        qual = sample_qualifications[1]  # "Experience with SQL and data analysis"
        results = retrieve_top_k(qual, sample_bullets, top_k=3)
        for bullet, sim, lit_cov in results:
            assert isinstance(bullet, Bullet)
            assert 0.0 <= sim <= 1.0
            assert 0.0 <= lit_cov <= 1.0

    def test_sql_qual_ranks_sql_bullet_high(self, sample_bullets, sample_qualifications):
        """The SQL dashboard bullet should rank highly for SQL qualification."""
        qual = sample_qualifications[1]  # "Experience with SQL and data analysis"
        results = retrieve_top_k(qual, sample_bullets, top_k=5)
        top_ids = [r[0].bullet_id for r in results[:3]]
        # exp_beta_1_b1 has "Built SQL dashboards..."
        assert "exp_beta_1_b1" in top_ids

    def test_ml_qual_ranks_ml_bullet_high(self, sample_bullets, sample_qualifications):
        """The ML bullet should rank highly for ML qualification."""
        qual = sample_qualifications[2]  # "Experience building ML-powered features"
        results = retrieve_top_k(qual, sample_bullets, top_k=5)
        top_ids = [r[0].bullet_id for r in results[:3]]
        # exp_acme_1_b1 has "ML-powered search feature"
        assert "exp_acme_1_b1" in top_ids

    def test_empty_bullets(self, sample_qualifications):
        qual = sample_qualifications[0]
        results = retrieve_top_k(qual, [], top_k=3)
        assert results == []

    def test_top_k_limits_results(self, sample_bullets, sample_qualifications):
        qual = sample_qualifications[0]
        results = retrieve_top_k(qual, sample_bullets, top_k=2)
        assert len(results) <= 2

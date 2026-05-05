"""Tests for embed_voyage.py — Voyage AI contextual embedding module.

These tests mock the Voyage AI client to verify:
  (a) Single-bullet role group produces correct shape
  (b) 8-bullet role group across 2 sources
  (c) Empty role group returns empty array
  (d) Qualification text > 500 chars gets truncated before embedding
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from ats_bullet_selector.embed_voyage import (
    RoleGroup,
    _MAX_CHUNK_CHARS,
    bullets_to_role_groups,
    embed_bullets_contextual,
    embed_qualifications,
)
from ats_bullet_selector.models import Bullet, Qualification, QualKind, SourceType


# --------------------------------------------------------------------------- #
#  Fixtures
# --------------------------------------------------------------------------- #


def _make_bullet(bullet_id: str, source_id: str, text: str = "Test bullet") -> Bullet:
    return Bullet(
        bullet_id=bullet_id,
        source_id=source_id,
        source_type=SourceType.experience,
        source_label=f"Company -- Role",
        role="PM",
        start_date="2023-01",
        end_date="2024-01",
        text=text,
        technologies=[],
        recency_months=6.0,
    )


def _mock_multimodal_embed_result(documents: list[list], dim: int = 1024):
    """Create a mock result matching Voyage multimodal_embed response structure.

    Returns embeddings for each chunk in each document.
    """
    result = MagicMock()
    embeddings = []
    for doc in documents:
        doc_embeddings = []
        for _ in doc:
            vec = np.random.randn(dim).astype(np.float32)
            vec = vec / np.linalg.norm(vec)
            doc_embeddings.append(vec.tolist())
        embeddings.append(doc_embeddings)
    result.embeddings = embeddings
    return result


def _mock_embed_result(texts: list[str], dim: int = 1024):
    """Create a mock result matching Voyage embed response structure."""
    result = MagicMock()
    embeddings = []
    for _ in texts:
        vec = np.random.randn(dim).astype(np.float32)
        vec = vec / np.linalg.norm(vec)
        embeddings.append(vec.tolist())
    result.embeddings = embeddings
    return result


# --------------------------------------------------------------------------- #
#  Tests
# --------------------------------------------------------------------------- #


class TestEmbedBulletsContextual:
    """Tests for embed_bullets_contextual()."""

    @patch("ats_bullet_selector.embed_voyage._get_client")
    def test_single_bullet_role_group(self, mock_get_client):
        """(a) Single bullet in one role group produces (1, 1024) array."""
        bullet = _make_bullet("b1", "src1", "Shipped ML search feature")
        group = RoleGroup(
            source_id="src1",
            source_label="Acme Corp -- PM",
            role="PM",
            dates="2023-01 to 2024-01",
            bullets=[bullet],
        )

        # Mock: 1 document with 2 chunks (context header + 1 bullet)
        mock_client = MagicMock()
        mock_client.multimodal_embed.side_effect = lambda **kwargs: _mock_multimodal_embed_result(
            [[{"content": "ctx"}, {"content": "bullet"}]]
        )
        mock_get_client.return_value = mock_client

        vecs, ids = embed_bullets_contextual([group])

        assert vecs.shape == (1, 1024)
        assert ids == ["b1"]
        # Verify L2 normalization
        assert abs(np.linalg.norm(vecs[0]) - 1.0) < 1e-5

    @patch("ats_bullet_selector.embed_voyage._get_client")
    def test_eight_bullet_role_group(self, mock_get_client):
        """(b) 8 bullets across 2 sources produces (8, 1024) array."""
        bullets_src1 = [_make_bullet(f"b{i}", "src1", f"Bullet {i}") for i in range(5)]
        bullets_src2 = [_make_bullet(f"b{i+5}", "src2", f"Bullet {i+5}") for i in range(3)]

        group1 = RoleGroup(
            source_id="src1",
            source_label="Acme -- PM",
            role="PM",
            dates="2022-01 to 2024-01",
            bullets=bullets_src1,
        )
        group2 = RoleGroup(
            source_id="src2",
            source_label="Beta -- SWE",
            role="SWE",
            dates="2020-01 to 2022-01",
            bullets=bullets_src2,
        )

        # Mock: 2 documents (6 chunks each for src1: header+5, 4 for src2: header+3)
        mock_client = MagicMock()

        def fake_embed(**kwargs):
            inputs = kwargs.get("inputs", [])
            return _mock_multimodal_embed_result(inputs)

        mock_client.multimodal_embed.side_effect = fake_embed
        mock_get_client.return_value = mock_client

        vecs, ids = embed_bullets_contextual([group1, group2])

        assert vecs.shape == (8, 1024)
        assert len(ids) == 8
        assert ids == [f"b{i}" for i in range(8)]

    @patch("ats_bullet_selector.embed_voyage._get_client")
    def test_empty_role_group(self, mock_get_client):
        """(c) Empty role group returns (0, 1024) array."""
        group = RoleGroup(
            source_id="src1",
            source_label="Acme -- PM",
            role="PM",
            dates="2023-01 to 2024-01",
            bullets=[],
        )

        vecs, ids = embed_bullets_contextual([group])

        assert vecs.shape == (0, 1024)
        assert ids == []
        # Should NOT call the API
        mock_get_client.assert_not_called()

    @patch("ats_bullet_selector.embed_voyage._get_client")
    def test_long_bullet_truncated(self, mock_get_client):
        """(d) Bullet text > 500 chars gets truncated before sending to API."""
        long_text = "x" * 800
        bullet = _make_bullet("b_long", "src1", long_text)
        group = RoleGroup(
            source_id="src1",
            source_label="Acme -- PM",
            role="PM",
            dates="2023-01 to 2024-01",
            bullets=[bullet],
        )

        mock_client = MagicMock()
        captured_inputs = []

        def capture_embed(**kwargs):
            captured_inputs.append(kwargs.get("inputs", []))
            return _mock_multimodal_embed_result(kwargs.get("inputs", []))

        mock_client.multimodal_embed.side_effect = capture_embed
        mock_get_client.return_value = mock_client

        vecs, ids = embed_bullets_contextual([group])

        assert vecs.shape == (1, 1024)
        # Verify the bullet chunk was truncated
        # Document structure: [[context_header_chunk, bullet_chunk]]
        doc_chunks = captured_inputs[0][0]
        bullet_content = doc_chunks[1]["content"]
        assert len(bullet_content) <= _MAX_CHUNK_CHARS


class TestEmbedQualifications:
    """Tests for embed_qualifications()."""

    @patch("ats_bullet_selector.embed_voyage._get_client")
    def test_basic_qualifications(self, mock_get_client):
        """Embed 3 qualifications produces (3, 1024) array."""
        quals = [
            Qualification(id="q0", kind=QualKind.basic, text="3+ years PM experience"),
            Qualification(id="q1", kind=QualKind.basic, text="SQL proficiency"),
            Qualification(id="q2", kind=QualKind.preferred, text="ML experience"),
        ]

        mock_client = MagicMock()
        mock_client.embed.side_effect = lambda **kwargs: _mock_embed_result(kwargs.get("texts", []))
        mock_get_client.return_value = mock_client

        vecs = embed_qualifications(quals)

        assert vecs.shape == (3, 1024)
        # Verify L2 normalization
        for i in range(3):
            assert abs(np.linalg.norm(vecs[i]) - 1.0) < 1e-5

    def test_empty_qualifications(self):
        """Empty list returns (0, 1024) without calling API."""
        vecs = embed_qualifications([])
        assert vecs.shape == (0, 1024)

    @patch("ats_bullet_selector.embed_voyage._get_client")
    def test_long_qualification_truncated(self, mock_get_client):
        """Qualification text > 500 chars gets truncated."""
        long_qual = Qualification(
            id="q_long",
            kind=QualKind.basic,
            text="a" * 800,
        )

        mock_client = MagicMock()
        captured_texts = []

        def capture_embed(**kwargs):
            captured_texts.append(kwargs.get("texts", []))
            return _mock_embed_result(kwargs.get("texts", []))

        mock_client.embed.side_effect = capture_embed
        mock_get_client.return_value = mock_client

        vecs = embed_qualifications([long_qual])

        assert vecs.shape == (1, 1024)
        # Verify truncation
        assert len(captured_texts[0][0]) <= _MAX_CHUNK_CHARS


class TestBulletsToRoleGroups:
    """Tests for the adapter function."""

    def test_groups_by_source_id(self, sample_bullets):
        """Bullets with same source_id end up in same RoleGroup."""
        groups = bullets_to_role_groups(sample_bullets)

        source_ids = {g.source_id for g in groups}
        assert source_ids == {"exp_acme_1", "exp_beta_1", "exp_gamma_1", "proj_delta_1"}

        # Acme has 2 bullets
        acme = next(g for g in groups if g.source_id == "exp_acme_1")
        assert len(acme.bullets) == 2
        assert acme.source_label == "Acme Corp -- Senior PM"
        assert acme.role == "Senior PM"

    def test_empty_list(self):
        """Empty bullet list produces empty groups."""
        groups = bullets_to_role_groups([])
        assert groups == []

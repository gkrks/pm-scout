"""Tests for role_profile.py — role detection, acronym expansion, canonicalization."""

from __future__ import annotations

import pytest

from ats_bullet_selector.role_profile import (
    ProfileNotFoundError,
    StubProfileError,
    canonicalize_term,
    clear_caches,
    detect_role_family,
    expand_acronyms,
    load_role_profile,
)


@pytest.fixture(autouse=True)
def _clear():
    """Clear caches before each test."""
    clear_caches()
    yield
    clear_caches()


# --------------------------------------------------------------------------- #
#  Role detection tests
# --------------------------------------------------------------------------- #


class TestDetectRoleFamily:
    """Test detect_role_family() with all examples from the implementation brief."""

    def test_senior_product_manager(self):
        assert detect_role_family("Senior Product Manager") == "pm"

    def test_forward_deployed_apm(self):
        """'Forward Deployed Associate Product Manager' -> pm (contains 'product manager')."""
        assert detect_role_family("Forward Deployed Associate Product Manager") == "pm"

    def test_senior_software_engineer(self):
        assert detect_role_family("Senior Software Engineer") == "swe"

    def test_technical_program_manager(self):
        """'Technical Program Manager II' -> tpm."""
        assert detect_role_family("Technical Program Manager II") == "tpm"

    def test_product_analyst_growth(self):
        """'Product Analyst, Growth' -> pa."""
        assert detect_role_family("Product Analyst, Growth") == "pa"

    def test_technical_product_manager(self):
        """'Technical Product Manager' -> pm (NOT tpm).
        Contains 'product manager' which is longer than 'tpm' pattern."""
        assert detect_role_family("Technical Product Manager") == "pm"

    def test_engineering_manager_fallback(self):
        """'Engineering Manager' -> engineering_manager."""
        assert detect_role_family("Engineering Manager") == "engineering_manager"

    def test_vp_product(self):
        assert detect_role_family("VP Product") == "pm"

    def test_head_of_product(self):
        assert detect_role_family("Head of Product") == "pm"

    def test_staff_engineer(self):
        assert detect_role_family("Staff Engineer") == "swe"

    def test_data_analyst(self):
        assert detect_role_family("Data Analyst") == "data_analyst"

    def test_program_manager(self):
        """Plain 'Program Manager' -> program_manager (not tpm)."""
        assert detect_role_family("Program Manager") == "program_manager"

    def test_unknown_title_falls_back_to_pm(self):
        """Unknown title falls back to pm with warning."""
        assert detect_role_family("Chief Happiness Officer") == "pm"

    def test_case_insensitive(self):
        assert detect_role_family("SENIOR PRODUCT MANAGER") == "pm"
        assert detect_role_family("software ENGINEER") == "swe"

    def test_longest_pattern_wins(self):
        """When multiple families match, longest pattern wins."""
        # "technical program manager" (24 chars) beats "program manager" (15 chars)
        assert detect_role_family("Senior Technical Program Manager") == "tpm"


# --------------------------------------------------------------------------- #
#  Profile loading tests
# --------------------------------------------------------------------------- #


class TestLoadRoleProfile:
    """Test load_role_profile() loading and inheritance."""

    def test_load_pm_profile(self):
        """PM profile loads with all fields populated."""
        profile = load_role_profile("pm")
        assert profile.role_family == "pm"
        assert profile.display_name == "Product Manager"
        assert profile.status is None
        assert len(profile.title_patterns) >= 5
        assert "product_craft" in profile.keyword_taxonomy
        assert profile.bullet_format.char_limit == 225
        assert profile.bullet_format.primary == "xyz"
        assert len(profile.preferred_verbs) >= 10
        assert len(profile.banned_phrases) > 0  # global + role

    def test_stub_profile_raises_for_live_scoring(self):
        """Stub profiles raise StubProfileError when allow_stub=False."""
        with pytest.raises(StubProfileError):
            load_role_profile("swe")

    def test_stub_profile_loads_with_allow_stub(self):
        """Stub profiles load when allow_stub=True (for detection)."""
        profile = load_role_profile("swe", allow_stub=True)
        assert profile.role_family == "swe"
        assert profile.status == "stub"

    def test_nonexistent_profile_raises(self):
        with pytest.raises(ProfileNotFoundError):
            load_role_profile("nonexistent_role")

    def test_shared_config_merged(self):
        """PM profile has shared synonyms and acronym policy."""
        profile = load_role_profile("pm")
        assert len(profile.synonyms) >= 30
        assert "PRD" in profile.acronym_policy.always_spell_out
        assert "SQL" in profile.acronym_policy.keep_as_acronym

    def test_stub_inherits_bullet_format(self):
        """Stub profiles inherit bullet_format from pm."""
        profile = load_role_profile("pa", allow_stub=True)
        assert profile.bullet_format.primary == "xyz"
        assert profile.bullet_format.char_limit == 225


# --------------------------------------------------------------------------- #
#  Acronym expansion tests
# --------------------------------------------------------------------------- #


class TestExpandAcronyms:
    """Test expand_acronyms() for resume output processing."""

    def test_prd_expanded_api_kept(self):
        """'Built PRD for new API' -> 'Built product requirements document for new API'."""
        profile = load_role_profile("pm")
        result = expand_acronyms("Built PRD for new API", profile)
        assert "product requirements document" in result
        assert "API" in result  # kept as acronym

    def test_okr_expanded(self):
        profile = load_role_profile("pm")
        result = expand_acronyms("Defined OKR framework", profile)
        assert "objectives and key results" in result

    def test_sql_kept(self):
        profile = load_role_profile("pm")
        result = expand_acronyms("Wrote SQL queries for analytics", profile)
        assert "SQL" in result

    def test_no_expansion_inside_words(self):
        """Should not expand 'PM' inside 'SPAM' or similar."""
        profile = load_role_profile("pm")
        result = expand_acronyms("Reduced SPAM by 40%", profile)
        # "PM" in "SPAM" should NOT be expanded
        assert "SPAM" in result or "product manager" not in result.lower().replace(
            "product manager", ""
        )

    def test_multiple_expansions(self):
        profile = load_role_profile("pm")
        result = expand_acronyms("Set KPIs and OKRs for GTM launch", profile)
        assert "key performance indicator" in result
        assert "objectives and key results" in result
        assert "go-to-market" in result

    def test_case_insensitive_expansion(self):
        profile = load_role_profile("pm")
        result = expand_acronyms("Wrote prd for feature", profile)
        assert "product requirements document" in result


# --------------------------------------------------------------------------- #
#  Canonicalization tests
# --------------------------------------------------------------------------- #


class TestCanonicalizeTerm:
    """Test canonicalize_term() for keyword matching."""

    def test_prd_to_canonical(self):
        assert canonicalize_term("PRD") == "product requirements document"

    def test_okr_to_canonical(self):
        assert canonicalize_term("OKR") == "objectives and key results"

    def test_gtm_to_canonical(self):
        assert canonicalize_term("GTM") == "go-to-market"

    def test_already_canonical(self):
        assert canonicalize_term("a/b testing") == "a/b testing"

    def test_unknown_term_lowercased(self):
        assert canonicalize_term("SomethingNew") == "somethingnew"

    def test_alias_variant(self):
        assert canonicalize_term("split testing") == "a/b testing"

    def test_case_insensitive(self):
        assert canonicalize_term("prd") == "product requirements document"
        assert canonicalize_term("Prd") == "product requirements document"

    def test_whitespace_stripped(self):
        assert canonicalize_term("  PRD  ") == "product requirements document"

    def test_dau_canonical(self):
        assert canonicalize_term("DAU") == "daily active users"

    def test_mau_canonical(self):
        assert canonicalize_term("MAU") == "monthly active users"

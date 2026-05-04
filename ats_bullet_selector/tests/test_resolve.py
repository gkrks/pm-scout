"""Tests for resolve.py -- deterministic non-bullet resolvers."""

from __future__ import annotations

import pytest

from ats_bullet_selector.models import QualCategory, QualKind, Qualification
from ats_bullet_selector.resolve import (
    resolve_education,
    resolve_experience_years,
    resolve_skill_check,
)


SAMPLE_RESUME = {
    "education": [
        {
            "id": "edu_0",
            "degree": "M.S. Computer Engineering and Management",
            "major": None,
            "university": "Northeastern University",
            "start_date": "2022-09-01",
            "end_date": "2024-12-01",
        },
        {
            "id": "edu_1",
            "degree": "Bachelor of Technology",
            "major": None,
            "university": "VNIT",
            "start_date": "2017-06-01",
            "end_date": "2021-05-01",
        },
    ],
    "experiences": [
        {
            "id": "exp_0",
            "company": "Matic Robots",
            "role": "PM",
            "start_date": "2026-01-01",
            "end_date": None,
        },
        {
            "id": "exp_1",
            "company": "ZS Associates",
            "role": "Consultant",
            "start_date": "2021-06-01",
            "end_date": "2022-08-01",
        },
        {
            "id": "exp_2",
            "company": "Startup Inc",
            "role": "SWE Intern",
            "start_date": "2020-05-01",
            "end_date": "2020-08-01",
        },
    ],
    "skills": [
        {"header": "Languages", "skills": ["Python", "TypeScript", "Rust", "SQL"]},
        {"header": "Tools", "skills": ["Docker", "Kubernetes", "Elasticsearch"]},
    ],
}


def _make_qual(text: str) -> Qualification:
    return Qualification(id="q_test_0", kind=QualKind.basic, text=text)


class TestResolveEducation:
    def test_masters_cs_match(self):
        qual = _make_qual("Master's degree in Computer Science or related field")
        result = resolve_education(qual, SAMPLE_RESUME)
        assert result.met is True
        assert "M.S. Computer Engineering" in result.evidence
        assert result.source_section == "education"
        assert result.confidence == 1.0

    def test_bachelors_match(self):
        qual = _make_qual("Bachelor's degree required")
        result = resolve_education(qual, SAMPLE_RESUME)
        assert result.met is True
        assert "Bachelor of Technology" in result.evidence

    def test_phd_no_match(self):
        qual = _make_qual("PhD in Physics required")
        result = resolve_education(qual, SAMPLE_RESUME)
        assert result.met is False
        assert result.evidence == ""

    def test_masters_engineering_matches(self):
        qual = _make_qual("Master's degree in Engineering")
        result = resolve_education(qual, SAMPLE_RESUME)
        assert result.met is True

    def test_no_education_section(self):
        qual = _make_qual("Master's in CS")
        result = resolve_education(qual, {"education": []})
        assert result.met is False


class TestResolveExperienceYears:
    def test_sufficient_years(self):
        qual = _make_qual("1+ years of experience in product management")
        result = resolve_experience_years(qual, SAMPLE_RESUME)
        assert result.met is True
        assert "years total" in result.evidence
        assert result.source_section == "experiences"

    def test_insufficient_years(self):
        qual = _make_qual("10+ years of experience")
        result = resolve_experience_years(qual, SAMPLE_RESUME)
        assert result.met is False

    def test_sums_across_experiences(self):
        qual = _make_qual("1+ years of experience")
        result = resolve_experience_years(qual, SAMPLE_RESUME)
        assert result.met is True
        assert "ZS Associates" in result.evidence or "Matic" in result.evidence

    def test_no_years_pattern(self):
        qual = _make_qual("Experience with data pipelines")
        result = resolve_experience_years(qual, SAMPLE_RESUME)
        assert result.met is False
        assert result.confidence == 0.5


class TestResolveSkillCheck:
    def test_skill_found(self):
        qual = _make_qual("Proficiency in Python")
        result = resolve_skill_check(qual, SAMPLE_RESUME)
        assert result.met is True
        assert "Python" in result.evidence
        assert result.source_section == "skills"

    def test_skill_case_insensitive(self):
        qual = _make_qual("Experience with python and SQL")
        result = resolve_skill_check(qual, SAMPLE_RESUME)
        assert result.met is True

    def test_skill_not_found(self):
        qual = _make_qual("Proficiency in Go")
        result = resolve_skill_check(qual, SAMPLE_RESUME)
        assert result.met is False
        assert result.evidence == ""

    def test_multiple_skills_found(self):
        qual = _make_qual("Python and TypeScript")
        result = resolve_skill_check(qual, SAMPLE_RESUME)
        assert result.met is True
        assert "Python" in result.evidence
        assert "TypeScript" in result.evidence

    def test_empty_skills(self):
        qual = _make_qual("Python")
        result = resolve_skill_check(qual, {"skills": []})
        assert result.met is False

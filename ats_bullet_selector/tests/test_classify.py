"""Tests for classify.py -- deterministic qualification routing."""

from __future__ import annotations

import pytest

from ats_bullet_selector.classify import classify_qualifications
from ats_bullet_selector.models import QualCategory, QualKind, Qualification


SAMPLE_SKILLS = ["Python", "TypeScript", "SQL", "Rust", "Java", "Elasticsearch"]


def _make_qual(text: str, kind: QualKind = QualKind.basic) -> Qualification:
    return Qualification(id="q_test", kind=kind, text=text)


class TestEducationCheck:
    def test_bachelors_degree(self):
        q = _make_qual("Bachelor's degree in Computer Science")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.education_check

    def test_masters_degree(self):
        q = _make_qual("Master's degree in a technical field")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.education_check

    def test_bs_abbreviation(self):
        q = _make_qual("B.S. in CS or related field")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.education_check

    def test_phd_required(self):
        q = _make_qual("PhD in Machine Learning or related")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.education_check

    def test_no_degree_mention(self):
        q = _make_qual("Strong analytical skills")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category != QualCategory.education_check


class TestExperienceYears:
    def test_n_plus_years(self):
        q = _make_qual("3+ years of product management experience")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.experience_years

    def test_years_of_experience(self):
        q = _make_qual("5 years of experience in software development")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.experience_years

    def test_years_working(self):
        q = _make_qual("2+ years working in a startup environment")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.experience_years

    def test_no_years_pattern(self):
        q = _make_qual("Experience with agile methodologies")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category != QualCategory.experience_years


class TestValuesStatement:
    def test_passion(self):
        q = _make_qual("Deep passion for building products")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.values_statement

    def test_self_starter(self):
        q = _make_qual("Self-starter who thrives in ambiguity")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.values_statement

    def test_growth_mindset(self):
        q = _make_qual("Growth mindset and willingness to learn")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.values_statement

    def test_not_values(self):
        q = _make_qual("Led cross-functional teams to ship features")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category != QualCategory.values_statement


class TestSkillCheck:
    def test_short_skill_mention(self):
        q = _make_qual("Proficiency in Python")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.skill_check

    def test_skill_in_list(self):
        q = _make_qual("Experience with SQL")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.skill_check

    def test_skill_not_in_resume(self):
        q = _make_qual("Proficiency in Go")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category != QualCategory.skill_check

    def test_long_text_not_skill_check(self):
        q = _make_qual("Strong experience building Python applications with complex data pipelines and distributed systems")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category != QualCategory.skill_check


class TestBulletMatchDefault:
    def test_default_fallback(self):
        q = _make_qual("Led cross-functional teams to deliver complex features on time")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.bullet_match

    def test_generic_experience(self):
        q = _make_qual("Experience building and shipping consumer products")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.bullet_match


class TestPriorityOrder:
    def test_education_wins_over_years(self):
        """If text mentions both degree and years, education wins (checked first)."""
        q = _make_qual("Bachelor's degree with 2+ years experience")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.education_check

    def test_years_wins_over_values(self):
        """Years pattern is checked before values keywords."""
        q = _make_qual("3+ years of experience with passion for ML")
        classify_qualifications([q], SAMPLE_SKILLS)
        assert q.category == QualCategory.experience_years

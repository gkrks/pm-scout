"""Pydantic v2 strict-mode models for the bullet selection pipeline."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# --------------------------------------------------------------------------- #
#  Enums
# --------------------------------------------------------------------------- #

class QualKind(str, Enum):
    basic = "basic"
    preferred = "preferred"


class SourceType(str, Enum):
    experience = "experience"
    project = "project"


# --------------------------------------------------------------------------- #
#  Stage A inputs
# --------------------------------------------------------------------------- #

class Bullet(BaseModel):
    model_config = ConfigDict(strict=True)

    bullet_id: str
    source_id: str
    source_type: SourceType
    source_label: str
    role: str
    start_date: str          # "YYYY-MM" or "Present"
    end_date: Optional[str]  # "YYYY-MM" or None (means present)
    text: str
    technologies: list[str] = Field(default_factory=list)
    recency_months: Optional[float] = None  # computed at load time


class Qualification(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str           # e.g. "q_basic_0"
    kind: QualKind
    text: str


# --------------------------------------------------------------------------- #
#  Stage B output (per-pair LLM judge result)
# --------------------------------------------------------------------------- #

class JudgeResult(BaseModel):
    model_config = ConfigDict(strict=True)

    semantic_relevance: float = Field(ge=0, le=10)
    evidence_strength: float = Field(ge=0, le=10)
    quantification: float = Field(ge=0, le=10)
    seniority_scope: float = Field(ge=0, le=10)
    self_confidence: float = Field(ge=0.0, le=1.0)
    supporting_span: str
    rationale: str = Field(max_length=200)


# --------------------------------------------------------------------------- #
#  Stage C output (per-candidate score)
# --------------------------------------------------------------------------- #

class SubScores(BaseModel):
    model_config = ConfigDict(strict=True)

    keyword: float = Field(ge=0, le=100)
    semantic: float = Field(ge=0, le=100)
    evidence: float = Field(ge=0, le=100)
    quantification: float = Field(ge=0, le=100)
    seniority: float = Field(ge=0, le=100)
    recency: float = Field(ge=0, le=100)


class ScoredCandidate(BaseModel):
    model_config = ConfigDict(strict=True)

    bullet_id: str
    source_id: str
    source_label: str
    text: str
    match_score: float = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    sub_scores: SubScores
    rationale: str
    supporting_span: str


class QualCandidates(BaseModel):
    model_config = ConfigDict(strict=True)

    qualification: Qualification
    candidates: list[ScoredCandidate]  # top 3, sorted by match_score desc


# --------------------------------------------------------------------------- #
#  Stage D output (ILP assignment)
# --------------------------------------------------------------------------- #

class SelectedBullet(BaseModel):
    model_config = ConfigDict(strict=True)

    bullet_id: str
    source_id: str
    covers_qualifications: list[str]  # qualification ids


class FinalSelection(BaseModel):
    model_config = ConfigDict(strict=True)

    selected_bullets: list[SelectedBullet]
    uncovered_qualifications: list[str]
    total_score: float
    source_utilization: dict[str, int]  # source_id -> count


# --------------------------------------------------------------------------- #
#  API request / response schemas
# --------------------------------------------------------------------------- #

class ScoreRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    job_id: str
    master_resume_path: Optional[str] = None
    force_refresh: bool = False


class ScoreResponse(BaseModel):
    model_config = ConfigDict(strict=True)

    job_id: str
    model_version: str
    system_prompt_hash: str
    ranked_candidates: list[QualCandidates]
    final_selection: FinalSelection


class UserSelection(BaseModel):
    model_config = ConfigDict(strict=True)

    qualification_id: str
    bullet_id_or_text: str
    is_custom: bool = False


class SelectRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    job_id: str
    user_selections: list[UserSelection]


class ResolvedBullet(BaseModel):
    model_config = ConfigDict(strict=True)

    qualification_id: str
    bullet_id: Optional[str]  # None if custom
    text: str
    source_id: Optional[str]  # None if custom
    is_custom: bool


class SelectResponse(BaseModel):
    model_config = ConfigDict(strict=True)

    ok: bool
    warnings: list[str]
    resolved_bullets: list[ResolvedBullet]


class HealthResponse(BaseModel):
    model_config = ConfigDict(strict=True)

    status: str
    model_version: str
    cache_size: int

"""Configuration constants for the bullet selection pipeline."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Try .env in ats_bullet_selector/ first, then parent (JobSearch/.env)
load_dotenv()
load_dotenv(Path(__file__).resolve().parents[2].parent / ".env")

# --------------------------------------------------------------------------- #
#  Paths
# --------------------------------------------------------------------------- #

PROJECT_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PROJECT_ROOT.parent  # JobSearch/
CACHE_DIR = PROJECT_ROOT / "cache"
EMBEDDINGS_CACHE_DIR = CACHE_DIR / "embeddings"
JUDGE_CACHE_DIR = CACHE_DIR / "judge"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
SYNONYMS_PATH = PROJECT_ROOT / "data" / "synonyms.yaml"
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"

# On Railway, root dir is ats_bullet_selector/ so REPO_ROOT won't have config/.
# Fall back to a local copy bundled in PROJECT_ROOT.
_repo_resume = REPO_ROOT / "config" / "master_resume.json"
_local_resume = PROJECT_ROOT / "master_resume.json"
DEFAULT_MASTER_RESUME_PATH = _repo_resume if _repo_resume.exists() else _local_resume

# --------------------------------------------------------------------------- #
#  LLM (Groq)
# --------------------------------------------------------------------------- #

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "llama-3.3-70b-versatile")
JUDGE_TEMPERATURE = 0
JUDGE_MAX_TOKENS = 1024
JUDGE_CONCURRENCY_CAP = 1  # sequential for Groq free tier (12K TPM)

# --------------------------------------------------------------------------- #
#  Embeddings
# --------------------------------------------------------------------------- #

# Provider selection: "openai" (default, current behavior) or "voyage"
EMBEDDER_PROVIDER = os.environ.get("EMBEDDER_PROVIDER", "openai")

# Local sentence-transformers (used by retrieve.py for local fallback)
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384  # all-MiniLM-L6-v2 output dimension
RETRIEVAL_TOP_K = int(os.environ.get("RETRIEVAL_TOP_K", "5"))
SEMANTIC_SIM_FLOOR = 0.25

# Voyage AI configuration (active when EMBEDDER_PROVIDER=voyage)
VOYAGE_API_KEY = os.environ.get("VOYAGE_API_KEY", "")
VOYAGE_MODEL = "voyage-context-3"
VOYAGE_OUTPUT_DIMENSION = 1024
VOYAGE_OUTPUT_DTYPE = "float"
VOYAGE_TIMEOUT_S = 30
VOYAGE_MAX_RETRIES = 3

# OpenAI embedding (active when EMBEDDER_PROVIDER=openai)
OPENAI_EMBEDDING_MODEL = "text-embedding-3-large"

# --------------------------------------------------------------------------- #
#  Database (Supabase REST API)
# --------------------------------------------------------------------------- #

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# --------------------------------------------------------------------------- #
#  Scoring weights
# --------------------------------------------------------------------------- #

# Dimension order: keyword, semantic, evidence, quantification, seniority, recency
WEIGHTS_BASIC = {
    "keyword": 0.25,
    "semantic": 0.30,
    "evidence": 0.10,
    "quantification": 0.05,
    "seniority": 0.20,
    "recency": 0.10,
}

WEIGHTS_PREFERRED = {
    "keyword": 0.15,
    "semantic": 0.35,
    "evidence": 0.15,
    "quantification": 0.05,
    "seniority": 0.10,
    "recency": 0.20,
}

# --------------------------------------------------------------------------- #
#  ILP constraints
# --------------------------------------------------------------------------- #

SOURCE_BULLET_CAP = 2
GLOBAL_BULLET_CAP = 12
MATCH_SCORE_FLOOR = 30  # y[q,b] = 0 if match_score < this
MATCH_SCORE_FLOOR_LOWERED = 20  # used when keyword coverage needs borderline bullets
ILP_RANDOM_SEED = 42
ILP_THREADS = 1
VALUES_QUAL_SCORE_SCALE = 0.5

# Keyword coverage constraint (Phase 4)
# When enabled, the ILP forces selection of at least one bullet per must-have keyword
KEYWORD_COVERAGE_ENABLED = os.environ.get("KEYWORD_COVERAGE_ENABLED", "false").lower() == "true"
KEYWORD_SLACK_PENALTY = 300  # penalty for uncovered must-have keyword

# --------------------------------------------------------------------------- #
#  Recency scoring
# --------------------------------------------------------------------------- #

RECENCY_FULL_CREDIT_MONTHS = 24
RECENCY_DECAY_RATE = 0.15  # score drops by this per month after full credit

# --------------------------------------------------------------------------- #
#  spaCy
# --------------------------------------------------------------------------- #

SPACY_MODEL = "en_core_web_sm"  # sm is sufficient for noun_chunks + lemma

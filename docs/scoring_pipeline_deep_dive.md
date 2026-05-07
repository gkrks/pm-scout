# Resume Scoring, Summary Generation & Skills Analysis Pipeline

Complete technical documentation of the Check Fit resume tailoring system.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow Summary](#2-data-flow-summary)
3. [Stage A: Qualification Classification](#3-stage-a-qualification-classification)
4. [Stage B: Pre-Resolved Qualifications](#4-stage-b-pre-resolved-qualifications)
5. [Stage C: Bullet Ranking via Map Lookup](#5-stage-c-bullet-ranking-via-map-lookup)
6. [Stage D: ILP Global Assignment](#6-stage-d-ilp-global-assignment)
7. [Score Aggregation Formula](#7-score-aggregation-formula)
8. [Summary Generation](#8-summary-generation)
9. [Skills Optimization](#9-skills-optimization)
10. [Cover Letter Generation](#10-cover-letter-generation)
11. [Resume Generation & Template Filling](#11-resume-generation--template-filling)
12. [Data Models & Schemas](#12-data-models--schemas)
13. [Caching Strategy](#13-caching-strategy)
14. [Configuration Constants](#14-configuration-constants)
15. [Error Handling & Fallbacks](#15-error-handling--fallbacks)
16. [API Route Orchestration](#16-api-route-orchestration)

---

## 1. Architecture Overview

The system is a two-service architecture:

| Layer | Technology | Role |
|-------|-----------|------|
| **Node.js Web Layer** | Express (port 3847) | API orchestration, summary/skills generation, resume templating |
| **Python Microservice** | FastAPI (port 8001) | Bullet scoring, qualification classification, ILP optimization |

**Key files:**

```
Node Layer:
  src/fit/server.ts              Express routes + orchestration
  src/fit/summaryGenerator.ts    Summary generation (OpenAI gpt-4o)
  src/fit/skillsOptimizer.ts     Skills analysis (deterministic)
  src/fit/generateResume.ts      Resume composition + fill_resume.js
  src/fit/coverLetterGenerator.ts Cover letter (OpenAI gpt-4o)
  src/fit/types.ts               Zod schemas mirroring Python models

Python Layer:
  ats_bullet_selector/server.py                      FastAPI entrypoint
  ats_bullet_selector/src/ats_bullet_selector/
    classify.py     Stage A: qualification routing
    resolve.py      Stage B: deterministic resolution
    map_lookup.py   Stage C: embedding + re-rank
    score.py        Score aggregation formulas
    assign.py       Stage D: ILP optimization
    models.py       Pydantic v2 schemas
    config.py       Constants and weights
    db.py           Supabase + JSON data loading
```

---

## 2. Data Flow Summary

```
User opens /fit/:jobId
  |
  v
Browser auto-fires POST /fit/:jobId/score
  |
  +-- Check Supabase fit_score_cache (cache hit -> return immediately)
  |
  +-- Cache miss: parallel fan-out
  |     |
  |     +-- Python POST /score (45s timeout)
  |     |     |
  |     |     +-- Stage A: classify_qualifications()     [0 LLM calls]
  |     |     +-- Stage B: resolve pre-resolved quals    [0 LLM calls]
  |     |     +-- Stage C: rank_all_from_map()           [0-2 API calls]
  |     |     +-- Stage D: solve_assignment()            [0 LLM calls, ILP solver]
  |     |     +-- Return ScoreResponse
  |     |
  |     +-- Supabase: fetch job metadata
  |     +-- Supabase/JSON: load master resume
  |
  +-- After Python returns:
  |     +-- generateSummaryCandidates()   [1 OpenAI call]
  |     +-- optimizeSkills()              [0 LLM calls, deterministic]
  |
  +-- Cache result in Supabase
  +-- Return enriched response to browser

User selects bullets + summary in UI
  |
  v
POST /fit/:jobId/generate
  |
  +-- Resolve selections to bullet texts
  +-- Dynamic 4+2 source selection
  +-- Fill bullet slots (max 2 per source)
  +-- Regenerate summary if needed  [1 OpenAI call]
  +-- optimizeSkills() with user edits
  +-- Write working_resume.json
  +-- Shell: node fill_resume.js -> PDF + DOCX
  +-- Return download paths
```

**Total API calls per scoring request (cache miss):**
- Map hits only: 0 external calls (precomputed)
- N map misses: 1 OpenAI embedding call + ceil(N/4) GPT-4.1 re-rank calls + 1 GPT-4o summary call

---

## 3. Stage A: Qualification Classification

**File:** `ats_bullet_selector/src/ats_bullet_selector/classify.py`
**LLM calls:** 0 (fully deterministic)

Every qualification extracted from the JD is routed into one of 5 categories. This determines whether it needs bullet evidence or can be resolved from resume metadata.

### Categories

| Category | What it means | Resolution method |
|----------|--------------|-------------------|
| `education_check` | Degree requirement | Check resume.education[] |
| `experience_years` | Generic YOE requirement | Sum experience dates |
| `skill_check` | Short skill mention (<=8 words) | Check resume.skills[] |
| `values_statement` | Soft/cultural value | Scored at 0.5x weight in ILP |
| `bullet_match` | Everything else | Full embedding + re-rank pipeline |

### Classification Logic (evaluated in order)

```python
def _classify_one(text, skills_lower):
    # 1. Education patterns
    if regex matches (degree|bachelor|master|b.s.|ph.d|university|diploma):
        return education_check

    # 2. Generic years-of-experience (short + not domain-specific)
    if regex matches (\d+\+?\s*years):
        if word_count <= 12 AND no domain-specific detail:
            return experience_years
        # else: falls through to bullet_match (domain-specific quals
        #   like "2+ years with technical architecture of complex web apps"
        #   need bullet evidence)

    # 3. Values/cultural keywords
    if text contains any of: "passion", "hunger", "comfortable with ambiguity",
       "self-starter", "curious", "growth mindset", "thrives", "entrepreneurial",
       "deep interest", "eager to learn", "intellectually curious",
       "bias for action", "ownership mentality":
        return values_statement

    # 4. Short skill mentions found in resume
    if word_count <= 8:
        for each resume skill:
            if skill appears in qualification text:
                return skill_check

    # 5. Default: needs bullet evidence
    return bullet_match
```

### Domain-Specific Years Detection

The classifier distinguishes generic from domain-specific YOE requirements:

```
"3+ years experience"                                    -> experience_years (short, generic)
"3+ years of product management experience"              -> experience_years (short, generic)
"2+ years with technical architecture of complex web apps" -> bullet_match (long, domain-specific)
```

The heuristic: if the text has >12 words AND a regex matches `\d+\+?\s*years\s*(of\s*)?\w+\s+\w+\s+\w+\s+\w+` (4+ words of domain detail after the years pattern), it's domain-specific and routed to bullet_match.

---

## 4. Stage B: Pre-Resolved Qualifications

**File:** `ats_bullet_selector/src/ats_bullet_selector/resolve.py`
**LLM calls:** 0 (all deterministic lookups against resume structure)

### Education Resolver

```python
def resolve_education(qual, resume):
    # 1. Parse required degree level from qualification text
    #    Checks against: phd/doctorate, master/m.s./mba, bachelor/b.s./b.tech
    required_level = match_degree_keywords(qual.text)

    # 2. Parse required field
    #    Checks against: computer science, software engineering, engineering, etc.
    required_field = match_field_keywords(qual.text)

    # 3. Check each resume.education[] entry
    for entry in resume.education:
        combined = f"{entry.degree} {entry.major}".lower()
        level_match = any(keyword in combined for keyword in DEGREE_LEVELS[required_level])
        field_match = any(field in combined for field in CS_FIELDS)

        if level_match AND field_match:
            return PreResolvedResult(met=True, confidence=1.0, evidence=entry.degree)

    return PreResolvedResult(met=False, confidence=1.0, evidence="")
```

**Output:** `PreResolvedResult(qualification_id, category="education_check", met: bool, evidence: str, confidence: 1.0)`

### Experience Years Resolver

```python
def resolve_experience_years(qual, resume):
    # 1. Parse required years from text: "3+" -> 3
    required_years = parse_regex(r"(\d+)\+?\s*years?", qual.text)

    # 2. Sum all experience durations
    total_months = 0
    for exp in resume.experiences:
        start = parse_date(exp.start_date)
        end = parse_date(exp.end_date) or today
        months = (end.year - start.year) * 12 + (end.month - start.month)
        total_months += months

    # 3. Compare
    total_years = total_months / 12.0
    met = total_years >= required_years
    evidence = f"{total_years:.1f} years total: Matic (1.5y) + Tonal (1.2y) + ..."
```

**Output:** `PreResolvedResult(met: bool, evidence: "3.5 years total: ...", confidence: 1.0)`

### Skill Check Resolver

```python
def resolve_skill_check(qual, resume):
    # Flatten all resume.skills[].skills[] into one list
    all_skills = flatten(resume.skills)

    # Case-insensitive containment check
    matched = [s for s in all_skills if s.lower() in qual.text.lower()]

    if matched:
        return PreResolvedResult(met=True, evidence=f"Skills found: {', '.join(matched)}", confidence=0.9)
    return PreResolvedResult(met=False, evidence="", confidence=0.9)
```

**Note:** Skill check confidence is 0.9 (not 1.0) because containment matching can have false positives.

---

## 5. Stage C: Bullet Ranking via Map Lookup

**File:** `ats_bullet_selector/src/ats_bullet_selector/map_lookup.py`
**LLM calls:** 0 for map hits; 1 embedding + ceil(N/4) re-rank calls for N map misses

This is the core scoring engine. It finds the best resume bullets for each qualification that was routed to `bullet_match` (and `values_statement`).

### Phase 1: Map Hits (0 API calls)

A precomputed `qualification_map.json` (stored in Supabase or local file) maps qualification text hashes to pre-ranked bullets.

```python
def rank_from_map(qual):
    qual_hash = SHA256(qual.text)[:12]   # First 12 hex chars
    entry = map_data["quals"].get(qual_hash)

    if entry:
        # Instant lookup: precomputed bullet IDs + similarity scores
        ranked_ids = entry["bullets"][:3]   # Top 3 bullet IDs
        sims = entry["sim"][:3]             # Corresponding similarity scores
        return [build_scored_candidate(bullet, sim) for bullet, sim in zip(ranked_ids, sims)]
```

The qualification map is loaded once at startup:
1. **Primary:** Supabase `qualification_map_meta` + `qualification_map_quals` tables (paginated)
2. **Fallback:** Local `ats_bullet_selector/outputs/qualification_map.json`

### Phase 2: Batch Embedding for Map Misses (1 API call)

When a qualification isn't in the precomputed map:

```python
# 1. Embed ALL miss qualifications in one batch call
qual_vectors = openai.embeddings.create(
    model="text-embedding-3-large",
    input=[qual.text[:500] for qual in miss_quals]
)  # -> normalized (N_miss, 3072) array

# 2. Get bullet embeddings (computed once, cached in memory)
bullet_vectors = embed_all_bullets()  # -> normalized (N_bullets, 3072) array

# 3. Cosine similarity via matrix multiplication
sim_matrix = qual_vectors @ bullet_vectors.T  # (N_miss, N_bullets)

# 4. For each miss qual, take top-10 candidates
for i, qual in enumerate(miss_quals):
    top_indices = argsort(-sim_matrix[i])[:10]
    candidates = [(bullets[idx], sim_matrix[i][idx]) for idx in top_indices]
```

**Embedding model:** OpenAI `text-embedding-3-large` (3072 dimensions)
**Retrieval depth:** top-10 candidates per qualification (configurable via `RETRIEVAL_TOP_K`)

### Phase 3: LLM Re-Ranking (1 GPT-4.1 call per 4 qualifications)

Pure embedding similarity misses transferable skills. The re-ranker catches them.

```python
# Chunk miss candidates into groups of 4 quals per LLM call
for chunk in chunks(miss_candidates, size=4):
    reranked = batch_rerank(chunk, top_k=3)
```

**Re-rank prompt:**

```
You are scoring resume bullets against job qualifications.
For EACH qualification, score EACH of its candidate bullets on a 0-100 scale.
Consider TRANSFERABLE SKILLS -- a bullet may demonstrate the qualification through
analogous experience even if the vocabulary is different.

Examples of transferable evidence:
- "Writing 9 technical blog posts explaining engineering tradeoffs" demonstrates
  "Structured communication" even though it's not about stakeholder meetings.
- "Building a production pipeline from scratch" demonstrates "Bias for action"
  even without the exact phrase.

Return JSON:
{"results": [
  {"qual_id": "<id>", "scores": [{"id": "<bullet_id>", "score": <0-100>, "reason": "<1 sentence>"}]},
  ...
]}
```

**Model:** GPT-4.1 (configurable via `RERANK_MODEL` env var)
**Temperature:** 0 (deterministic)
**Response format:** JSON mode
**Retry policy:** 3 attempts with rate-limit backoff (parses `try again in Ns` from error)

### Building ScoredCandidate from Scores

```python
def build_scored_candidate(bullet, score, rationale=""):
    # Normalize: embedding sims are [0,1], LLM scores are [0,100]
    if score <= 1.0:
        match_score = score * 200.0  # Amplify embedding similarity
    else:
        match_score = score           # LLM score already 0-100

    match_score = clamp(0, 100, match_score)

    # Sub-scores: evenly distributed from match_score (simplified)
    base = match_score / 2
    sub_scores = SubScores(
        keyword=base, semantic=base, evidence=base,
        quantification=base, seniority=base, recency=base
    )

    return ScoredCandidate(
        bullet_id, source_id, source_label, text,
        match_score=round(match_score, 1),
        confidence=min(1.0, match_score / 100.0),
        sub_scores,
        rationale=rationale or f"Embedding similarity: {score:.3f}",
        supporting_span=""
    )
```

---

## 6. Stage D: ILP Global Assignment

**File:** `ats_bullet_selector/src/ats_bullet_selector/assign.py`
**LLM calls:** 0 (mathematical optimization)
**Solver:** PuLP + CBC (Coin-or Branch-and-Cut)

The ILP selects the globally optimal set of bullets subject to hard constraints.

### Decision Variables

| Variable | Type | Meaning |
|----------|------|---------|
| `x[b]` | Binary | Select bullet `b` for the resume |
| `y[q,b]` | Binary | Assign bullet `b` to cover qualification `q` |
| `slack[q]` | Binary | Allow basic qualification `q` to be uncovered (penalty) |

### Objective Function

```
maximize:
    SUM( match_score[q,b] * y[q,b] )           -- primary: maximize coverage quality
  + SUM( 1e-6 * tiebreaker[b] * x[b] )         -- tiebreaker: deterministic by MD5 hash
  - SUM( 1000 * slack[q] )                      -- penalty: heavily penalize uncovered basics

where:
  - match_score is 0-100 from Stage C
  - values_statement quals are scaled by 0.5 (VALUES_QUAL_SCORE_SCALE)
  - tiebreaker = -(MD5(bullet_id)[:8] as int) / 2^32  (deterministic ordering)
```

### Constraints

```
Constraint 1 (Basic qualification coverage):
    SUM(y[q,b] for all b) + slack[q] >= 1    -- must cover (slack allows infeasibility)
    SUM(y[q,b] for all b) <= 1                -- at most one bullet per qual

Constraint 2 (Preferred qualification coverage):
    SUM(y[q,b] for all b) <= 1                -- at most one bullet (soft, can be 0)

Constraint 3 (Selection implication):
    y[q,b] <= x[b]                            -- can't assign bullet without selecting it

Constraint 4 (Source bullet cap):
    SUM(x[b] for b in source) <= 2            -- max 2 bullets per experience/project

Constraint 5 (Global bullet cap):
    SUM(x[b] for all b) <= 12                 -- max 12 bullets total

Constraint 6 (Score floor):
    y[q,b] = 0 if match_score[q,b] < 30      -- filter low-scoring candidates pre-solve
```

### Feasibility Handling

1. **Primary solve:** Basic quals require coverage (with slack). Preferred quals are soft.
2. **If infeasible:** Retry with `all_soft=True` (all quals become soft coverage).
3. **If still infeasible:** Return empty selection with all quals uncovered.

### Solver Configuration

```python
solver = PULP_CBC_CMD(
    msg=0,              # silent
    threads=1,          # single-threaded (ILP_THREADS)
    timeLimit=30,       # 30 second hard limit
    options=["randomSeed 42"]  # deterministic
)
```

### Output

```python
FinalSelection(
    selected_bullets=[
        SelectedBullet(bullet_id="exp_matic_0_a4f2", source_id="exp_matic_0",
                       covers_qualifications=["q_basic_0", "q_preferred_2"]),
        ...
    ],
    uncovered_qualifications=["q_preferred_5"],
    total_score=487.3,
    source_utilization={"exp_matic_0": 2, "exp_tonal_0": 1, "proj_searchengine_rust_0": 2, ...}
)
```

---

## 7. Score Aggregation Formula

**File:** `ats_bullet_selector/src/ats_bullet_selector/score.py`

This module defines the full scoring formula used in the legacy judge path. The map_lookup path uses a simplified version, but these formulas are the canonical definitions.

### Sub-Score Computation

Each bullet-qualification pair produces 6 sub-scores, each on a 0-10 scale:

| Sub-score | Source | Formula |
|-----------|--------|---------|
| **keyword** | Deterministic | `10.0 * literal_coverage` where coverage = fraction of qual keywords found in bullet |
| **semantic** | LLM Judge | `semantic_relevance` (0-10 from JudgeResult) |
| **evidence** | LLM Judge | `evidence_strength` (0-10 from JudgeResult) |
| **quantification** | LLM Judge | `quantification` (0-10, presence of metrics/numbers) |
| **seniority** | LLM Judge | `seniority_scope` (0-10, scope of impact) |
| **recency** | Deterministic | Based on bullet's end_date |

### Recency Score

```python
def compute_recency_score(recency_months):
    if recency_months <= 24:          # Full credit for last 2 years
        return 10.0
    return max(0.0, 10.0 - 0.15 * (recency_months - 24))
    # Linear decay: 0.15 points per month after 24 months
    # Reaches 0 at ~91 months (7.5 years ago)
```

**Note:** Projects are always treated as `recency_months=0` (current).

### Weighted Match Score (0-100)

```python
def compute_match_score(qual_kind, keyword, semantic, evidence, quantification, seniority, recency):
    # Different weights for basic vs preferred qualifications
    if qual_kind == "basic":
        weights = {keyword: 0.25, semantic: 0.30, evidence: 0.10,
                   quantification: 0.05, seniority: 0.20, recency: 0.10}
    else:  # preferred
        weights = {keyword: 0.15, semantic: 0.35, evidence: 0.15,
                   quantification: 0.05, seniority: 0.10, recency: 0.20}

    score = 100.0 * SUM(weight * (sub_score / 10.0) for each dimension)
    return round(score, 1)
```

**Weight comparison:**

| Dimension | Basic Weight | Preferred Weight | Reasoning |
|-----------|-------------|-----------------|-----------|
| keyword | 0.25 | 0.15 | Basic quals need exact keyword matches |
| semantic | 0.30 | 0.35 | Preferred quals reward conceptual alignment |
| evidence | 0.10 | 0.15 | Preferred: stronger evidence needed |
| quantification | 0.05 | 0.05 | Equal: metrics matter equally |
| seniority | 0.20 | 0.10 | Basic quals weight seniority heavily |
| recency | 0.10 | 0.20 | Preferred quals reward recent experience |

### Confidence Score (0-1)

```python
def compute_confidence(self_confidence, literal_coverage, semantic_sim, supporting_span, bullet_text):
    agreement = 1.0 - abs(literal_coverage - semantic_sim)   # Do keyword and semantic agree?
    hedge = 0.0 if supporting_span in bullet_text else 0.3   # Is the span actually in the bullet?

    confidence = 0.5 * self_confidence    # LLM's own confidence
               + 0.3 * agreement          # Agreement between scoring methods
               + 0.2 * (1.0 - hedge)      # Evidence verification
```

---

## 8. Summary Generation

Two summary generation paths exist: one at `/score` time (for UI display) and one at `/generate` time (for final resume).

### At Score Time

**File:** `src/fit/summaryGenerator.ts`
**Model:** OpenAI GPT-4o, temperature 0.3
**Purpose:** Generate 3 candidate summaries for user selection

**Input:**
- JD text (title, company, key requirements, role context)
- Selected bullet texts from the ILP assignment

**Process:**

1. Load prompt template from `.claude/commands/resume_summary.md`
2. If the JD specifies years (e.g., "3+ years"), inject a critical override:
   ```
   ## CRITICAL OVERRIDE
   The JD specifies "3" years. You MUST use "3+ yrs" in the summary.
   Do NOT use "4+ yrs" or any other number.
   ```
3. Call GPT-4o with system prompt + user message containing JD and bullets

**9 Hard Rules for Summaries:**

| # | Rule | Example |
|---|------|---------|
| 1 | Max 300 characters | Enforced by char count |
| 2 | No em dashes | Use `;` or `,` instead |
| 3 | No buzzwords | "passionate", "results-driven", "dynamic", etc. banned |
| 4 | No first-person | No "I", "me", "my" |
| 5 | No bullet duplication | Summary adds framing, not repetition |
| 6 | Mirror 2-3 JD keywords | Natural integration, no keyword-stuffing |
| 7 | Lead with identity noun | "Engineer-PM", "Builder-PM", "Technical PM" |
| 8 | Years format | "N+ yrs" or "N+ years" |
| 9 | ASCII-only punctuation | No smart quotes, unicode dashes |

**Output format:**

```
CANDIDATE 1 -- <angle>
Text: "<summary>"
Chars: <N>
Self-check: [1] PASS [2] PASS ... [9] PASS
Reasoning: <why this angle>

CANDIDATE 2 -- <angle>
...

CANDIDATE 3 -- <angle>
...

RECOMMENDED: CANDIDATE <N>
```

**Parsing strategy:**
1. Regex: extract each `CANDIDATE N` block with angle, text, chars, self-check, reasoning
2. Extract `RECOMMENDED: CANDIDATE N`
3. Fallback: if structured parsing fails, extract any quoted text 50-300 chars long
4. Final fallback: static summary

**Static fallback summary:**
```
Engineer-PM with 4+ yrs across consumer robotics, fitness tech, and enterprise SaaS;
ships end-to-end systems in Rust and Python, bridging product management with hands-on engineering.
```

### At Generate Time

**File:** `src/fit/generateResume.ts` (`regenerateSummary()`)
**Model:** OpenAI GPT-4o, temperature 0
**Max characters:** 340

Called when the user doesn't provide a `summaryOverride` during resume generation.

**Differences from score-time generation:**
- Max chars: 340 (vs 300 at score time)
- Temperature: 0 (vs 0.3)
- Retry: 2 attempts with diagnostic note on retry
- Truncation: if summary is 341-360 chars, truncate to 337 + "..."

**User message includes:**
- JD (role, company, key requirements, role context)
- Selected resume bullets (up to 8)
- Candidate facts (name, focus areas, languages, cloud stack)

---

## 9. Skills Optimization

**File:** `src/fit/skillsOptimizer.ts`
**LLM calls:** 0 (fully deterministic)
**Strategy:** JD-first, aggressive inclusion

### Algorithm

**Step 1: Extract JD Skill Terms**

Skills are extracted from multiple sources in the JD:
- `jdSkills.technical`, `.tools`, `.languages`, `.methodologies`, `.domain_expertise`
- `jdExtractedSkills` (if pre-extracted during JD extraction)
- Regex patterns applied to required + preferred qualifications:
  ```
  AI|ML|LLM|NLP|API|SDK|REST|GraphQL|SQL|NoSQL
  Python|Rust|TypeScript|JavaScript|Java|Go|C++
  React|Next.js|Node.js|Express|FastAPI|Flask|Django
  AWS|GCP|Azure|Docker|Kubernetes|Terraform
  TensorFlow|PyTorch|SageMaker|Hugging Face
  inference|embeddings|fine-tuning|RAG|vector search
  A/B test|experimentation|analytics|metrics|data analysis
  CI/CD|DevOps|microservices|distributed systems
  Figma|JIRA|Postman|Git|Agile|Scrum
  roadmap|PRD|user research|stakeholder management|OKR
  product management|developer tool|developer experience
  ```

Noise filtering removes HTML tags, common English words, and single-character terms.

**Step 2: Categorize & Include All JD Skills**

Each JD skill is mapped to one of 6 resume categories using keyword matching:

| Category | Keywords (sample) |
|----------|------------------|
| Product and Strategy | product management, roadmap, PRD, user research, OKR, GTM |
| Data, ML and Search | SQL, analytics, ML, LLM, embeddings, BM25, vector search |
| Backend and Systems | API, microservices, Docker, Kubernetes, CI/CD, AWS |
| Frontend and Full-Stack | React, Next.js, TypeScript, Figma, wireframing |
| Languages | Python, Rust, Java, TypeScript, Go, C++ |
| AWS and Cloud | AWS, Lambda, DynamoDB, S3, SageMaker, GCP, Azure |

For each JD skill:
- If it exists in the resume (case-insensitive, substring match): use the resume's casing
- If NOT in resume: include it anyway (the candidate claims competency)
- Skip soft/generic terms: communication, leadership, empathy, curiosity, fast-moving, problem solving

**Step 3: Fill to Minimum**

If total skills < 12, add the most relevant resume skills that weren't already included, iterating through resume categories.

**Step 4: Rank & Select Top 3 Categories**

Categories are ranked by skill count (descending). Only the top 3 are kept.

**Step 5: Build Lines with Character Limit**

Each skill line has the format `"{Category}: {skill1}, {skill2}, ..."` and is capped at **110 characters**.

```python
max_list_length = 110 - len(category_header) - 2  # 2 for ": "
# Add skills until the character limit is reached
for skill in category_skills:
    addition = len(skill) if first else len(skill) + 2  # ", " separator
    if current_length + addition > max_list_length:
        break
    selected.append(skill)
```

**Step 6: Gap Reporting**

```typescript
{
  lines: [
    { name: "Product and Strategy", list: "product management, roadmap, user research, OKR", jdEvidence: [...] },
    { name: "Data, ML and Search", list: "SQL, analytics, ML, embeddings, BM25", jdEvidence: [...] },
    { name: "Backend and Systems", list: "API, Docker, AWS, microservices", jdEvidence: [...] }
  ],
  gapFilled: ["product management", "SQL", "Docker", ...],    // JD skills included
  gapRemaining: ["Terraform", "SageMaker", ...]                // JD skills that didn't fit
}
```

---

## 10. Cover Letter Generation

**File:** `src/fit/coverLetterGenerator.ts`
**Model:** OpenAI GPT-4o, temperature 0.4

### Philosophy

The cover letter positions the candidate as a builder who uses the company's kind of product. Three signals:
1. "I am your customer" -- built things with similar tools
2. "I build at the level your team builds" -- specific technical projects
3. "Here's the instinct that drew me to you" -- personal project connects to company mission

### Fixed Format

| Paragraph | Purpose | Length |
|-----------|---------|--------|
| 1 (Hook) | Start with something built that connects to company | 60-80 words |
| 2 (Connection) | Draw lines between projects and company needs | 80-100 words |
| 3 (Why This Company) | Reference specific product/launch/decision | 40-60 words |
| 4 (Close) | Direct ask for conversation | 25-35 words |

**Total:** 280-380 words (excluding header)

### Hard Constraints

- NO bullet points in body (flowing paragraphs only)
- Banned phrases: "I am writing to express", "thrilled/excited to apply", "passionate", "results-driven", "team player", "synergy", "leverage", "perfect fit", "dynamic team"
- Every claim traces to a resume bullet
- Must use project names: "Search Engine in Rust", "filmsearch", "ChuckleBox", "Voyantra"
- Must reference technical details: "BM25", "pgvector embeddings", "Llama 3.1 70B via Groq"

### Output

```typescript
{
  letter: string,           // Full cover letter text
  wordCount: number,
  priorities: string[],     // 3 company needs targeted
  assumptions: string[],    // Assumptions made about the company
  alternativeHook: string,  // Different opening paragraph angle
  docxPath?: string         // Path to generated DOCX file
}
```

The DOCX is built using the `docx` library with Calibri 11pt font, 1-inch margins.

---

## 11. Resume Generation & Template Filling

**File:** `src/fit/generateResume.ts`

### Dynamic 4+2 Source Selection

The system selects which experiences and projects appear on the resume:

```typescript
// 1. Rank experiences by selected bullet count (descending)
rankedExps = experiences.sort((a, b) => {
    countB = selectedBullets[b].length - selectedBullets[a].length;
    if (countB !== 0) return countB;
    return originalOrder(a) - originalOrder(b);  // tiebreak by resume order
});
selectedExpIds = rankedExps.slice(0, 4);  // Top 4 experiences

// 2. Rank projects: "Search Engine in Rust" always gets priority
rankedProjs = projects.sort((a, b) => {
    if (a === "proj_searchengine_rust_0") return -1;  // Always first
    if (b === "proj_searchengine_rust_0") return 1;
    return selectedBullets[b].length - selectedBullets[a].length;
});
selectedProjIds = rankedProjs.slice(0, 2);  // Top 2 projects
```

### Bullet Slot Filling (Max 2 Per Source)

```typescript
for (const source of selectedSources) {
    const selected = sourceBullets.get(source.id) || [];  // User-selected bullets
    const defaults = source.bullets
        .sort((a, b) => b.text.length - a.text.length)    // Longest bullets first
        .map(b => b.text);

    const finalBullets = [];

    // First: add user-selected bullets (deduped)
    for (const text of selected) {
        if (finalBullets.length >= 2) break;
        finalBullets.push(text);
    }

    // Then: fill remaining slots with defaults
    for (const text of defaults) {
        if (finalBullets.length >= 2) break;
        if (!finalBullets.includes(text)) {
            finalBullets.push(text);
        }
    }
}
```

### Working Resume Assembly

The system creates a modified copy of `master_resume.json` with:
- `__summary_override`: generated/selected summary text
- `__email_override`: user-selected email
- `__skills_override`: optimized skill lines (with user edits applied)
- Reordered experiences (most recent `start_date` first)
- Replaced bullet arrays (selected + default fills)

### Template Rendering

```bash
node fill_resume.js \
    --input /tmp/fit-resume-XXXXX/working_resume.json \
    --out-basename "Krithik_Gopinath_Google_APM" \
    --summary "Engineer-PM with 3+ yrs..."
```

**Output:** `out/Krithik_Gopinath_Google_APM.pdf` + `.docx`

**Basename formula:**
```typescript
`Krithik_Gopinath_${slug(company)}_${slug(role)}`
// slug: lowercase, replace non-alphanum with _, trim underscores
```

---

## 12. Data Models & Schemas

### Python Models (Pydantic v2 strict mode)

**File:** `ats_bullet_selector/src/ats_bullet_selector/models.py`

```python
class Bullet:
    bullet_id: str          # "exp_matic_0_a4f2"
    source_id: str          # "exp_matic_0"
    source_type: "experience" | "project"
    source_label: str       # "Matic Robots -- Product Associate"
    role: str
    start_date: str         # "YYYY-MM"
    end_date: str | None    # "YYYY-MM" or None (present)
    text: str
    technologies: list[str]
    recency_months: float | None

class Qualification:
    id: str                 # "q_basic_0" or "q_preferred_3"
    kind: "basic" | "preferred"
    text: str
    category: QualCategory | None  # Set by classifier

class ScoredCandidate:
    bullet_id: str
    source_id: str
    source_label: str
    text: str
    match_score: float      # 0-100
    confidence: float       # 0-1
    sub_scores: SubScores   # 6 dimensions, each 0-100
    rationale: str
    supporting_span: str

class SubScores:
    keyword: float          # 0-100
    semantic: float         # 0-100
    evidence: float         # 0-100
    quantification: float   # 0-100
    seniority: float        # 0-100
    recency: float          # 0-100

class FinalSelection:
    selected_bullets: list[SelectedBullet]
    uncovered_qualifications: list[str]
    total_score: float
    source_utilization: dict[str, int]

class PreResolvedResult:
    qualification_id: str
    category: QualCategory
    met: bool
    evidence: str
    confidence: float       # 0-1
    source_section: str     # "education" | "experiences" | "skills"
```

### TypeScript Schemas (Zod)

**File:** `src/fit/types.ts`

Mirror the Python models exactly. Key request/response schemas:

```typescript
// Request to score a job
ScoreRequestBodyZ = { force_refresh?: boolean }

// User's bullet selection
UserSelectionZ = {
    qualification_id: string,
    bullet_id_or_text: string,    // bullet ID for resume bullets, text for custom
    is_custom: boolean
}

// Request to generate resume
GenerateRequestBodyZ = {
    selections: UserSelection[],
    summaryHints?: string,         // Override summary text
    email?: string,                // Override contact email
    customSkills?: string[],       // Additional skills to append
    skillEdits?: Record<string, string>  // Per-line skill edits {lineIndex: "edited list"}
}
```

---

## 13. Caching Strategy

### Score Cache (Supabase `fit_score_cache`)

```
Key: listing_id (UUID)
Value: {
    score_response: { ranked_candidates, final_selection, pre_resolved },
    summary_candidates: SummaryCandidate[],
    summary_recommended: number,
    summary_jd_analysis: string,
    optimized_skills: SkillLine[],
    skills_gap_filled: string[],
    skills_gap_remaining: string[],
    model_version: string
}
TTL: Until force_refresh
Saves: ~20-25s per cache hit
```

### Qualification Map Cache (Python, in-memory)

```python
_map_data = None        # Loaded once at startup from Supabase/JSON
_bullet_embeddings = None  # Computed on first scoring, reused for all jobs
_bullet_ids_order = None
```

Refreshable via `POST /map/refresh` endpoint.

### Generated Resume Cache (Node, in-memory)

```typescript
generatedFiles = Map<jobId, { pdfPath, docxPath }>
// Disk files in /out directory
// Sweep hourly: delete files > 24h old with prefix "Krithik_Gopinath_"
```

---

## 14. Configuration Constants

**File:** `ats_bullet_selector/src/ats_bullet_selector/config.py`

### Scoring Weights

| Dimension | Basic Qual Weight | Preferred Qual Weight |
|-----------|------------------|-----------------------|
| keyword | 0.25 | 0.15 |
| semantic | 0.30 | 0.35 |
| evidence | 0.10 | 0.15 |
| quantification | 0.05 | 0.05 |
| seniority | 0.20 | 0.10 |
| recency | 0.10 | 0.20 |

### ILP Constraints

| Constant | Value | Purpose |
|----------|-------|---------|
| `SOURCE_BULLET_CAP` | 2 | Max bullets per experience/project |
| `GLOBAL_BULLET_CAP` | 12 | Max total bullets on resume |
| `MATCH_SCORE_FLOOR` | 30 | Minimum score to consider a bullet |
| `VALUES_QUAL_SCORE_SCALE` | 0.5 | Scale down values_statement quals in objective |
| `ILP_RANDOM_SEED` | 42 | Deterministic solver behavior |
| `ILP_THREADS` | 1 | Single-threaded solving |

### Recency

| Constant | Value | Purpose |
|----------|-------|---------|
| `RECENCY_FULL_CREDIT_MONTHS` | 24 | Full score for experience within 2 years |
| `RECENCY_DECAY_RATE` | 0.15 | Score decay per month after full credit period |

### Character Limits

| Element | Max Characters |
|---------|---------------|
| Summary (score time) | 300 |
| Summary (generate time) | 340 |
| Skill line | 110 |

### API Configuration

| Setting | Value |
|---------|-------|
| Python scorer timeout | 45 seconds |
| OpenAI summary timeout | 30 seconds |
| Summary retry attempts | 2 |
| Re-rank model | GPT-4.1 (env: `RERANK_MODEL`) |
| Embedding model | `text-embedding-3-large` |
| Re-rank chunk size | 4 quals per LLM call |
| Re-rank max retries | 3 |

---

## 15. Error Handling & Fallbacks

### Python Scorer Unavailable

```
45s timeout or connection refused
  -> Log warning "Python unavailable"
  -> Return empty ranked_candidates + pre_resolved
  -> Node checks: if both are empty, return 503 to client
  -> Client shows: "Bullet scoring service unavailable. Please try again later."
```

### Summary Generation Failure

```
Attempt 1 fails
  -> Retry with note: "Previous attempt failed self-checks. Regenerate carefully."
Attempt 2 fails
  -> Return static fallback summary
  -> Set summaryWarning: "Summary regeneration failed; using static fallback"
```

### Qualification Map Missing

```
Supabase load fails
  -> Try local JSON file at ats_bullet_selector/outputs/qualification_map.json
Local file missing
  -> Raise FileNotFoundError with instructions to run map generation
```

### ILP Infeasibility

```
Primary solve (basic=exact, preferred=soft) fails
  -> Retry with all_soft=True (all quals become soft coverage)
Still infeasible
  -> Return empty selection, all quals uncovered
```

### Re-rank Rate Limiting

```
429 error from OpenAI
  -> Parse "try again in Ns" from error message
  -> Sleep for N+2 seconds
  -> Retry up to 3 times
All retries fail
  -> Fall back to embedding-only scores (sim * 200)
```

---

## 16. API Route Orchestration

**File:** `src/fit/server.ts`

### GET /fit/:jobId

Token-gated page render. Loads job metadata, qualifications, and application status from Supabase. Server-renders HTML with inline data and injects `client.js`.

### POST /fit/:jobId/score

Main orchestration endpoint. Flow:

1. **Cache check** -> return cached result if available
2. **Parallel fan-out:**
   - Python `/score` (45s timeout, AbortController)
   - Supabase job metadata query
   - Master resume load
3. **Wait for all parallel operations**
4. **Bail if no scoring data** (503)
5. **Parallel post-processing:**
   - `generateSummaryCandidates()` (GPT-4o)
   - `optimizeSkills()` (deterministic)
6. **Build enriched response** (score data + summary + skills)
7. **Cache in Supabase** (async, non-blocking)
8. **Return to client**

### POST /fit/:jobId/select

Proxy to Python `/select`. Validates user selections against master resume, checks source bullet caps.

### POST /fit/:jobId/generate

1. Parse + validate `GenerateRequestBodyZ`
2. Call `generateResume()` (full pipeline)
3. Store file paths in memory
4. Return basename + summary warning

### GET /fit/:jobId/download/:format

Stream PDF or DOCX from in-memory file path map.

### POST /fit/:jobId/cover-letter

1. Load job data + master resume
2. Build JD text from all qualification sources
3. Call `generateCoverLetter()` (GPT-4o)
4. Build DOCX from letter text
5. Store DOCX path for download

### POST /fit/:jobId/apply

Upsert into Supabase `applications` table with status="applied".

---

## Appendix: End-to-End Timing

| Step | Duration (cache miss) | API Calls |
|------|----------------------|-----------|
| Python classifier + resolver | <10ms | 0 |
| Map lookup (hits) | <5ms | 0 |
| Batch embed (misses) | ~2-5s | 1 OpenAI |
| Batch re-rank (misses) | ~5-15s | 1-3 GPT-4.1 |
| ILP solve | <100ms | 0 |
| Summary generation | ~3-5s | 1 GPT-4o |
| Skills optimization | <50ms | 0 |
| **Total (cache miss)** | **~15-25s** | **2-5** |
| **Total (cache hit)** | **~100ms** | **0** |

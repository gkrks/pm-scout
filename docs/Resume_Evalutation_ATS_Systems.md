# How the Top 10 Enterprise ATS Evaluate Resume–Job Fit, and Whether You Should Build One Scorer or Ten

## TL;DR

- **Build ONE consolidated scorer, not ten.** The ten ATS reduce to roughly four behavioral archetypes (literal keyword, semantic/skills-graph, human scorecard, hybrid Boolean+AI), and the *union* of what they reward is well-approximated by a single rubric: literal keyword/phrase coverage, semantic similarity, evidence/quantification strength, recency/duration of skill use, and seniority/scope fit. Per-ATS tuning produces marginal gains for an offline bullet-picker because the user never actually applies *through* the ATS scoring engine — they apply with a resume that gets parsed and re-ranked downstream.
- **Architecture: hybrid deterministic + LLM-judge.** Run cheap deterministic gates first (literal keyword/phrase match, acronym normalization, embedding-based candidate retrieval per qualification), then have an LLM-judge at temperature 0 score each surviving bullet on a fixed analytical rubric and emit a JSON object with per-dimension scores plus a final `match_score` (0–100) and `confidence` (0–1). Use a fixed system prompt, fixed seed where supported, and pairwise/swap augmentation for the top-3 ordering to neutralize position bias. Keep the top 3 per qualification by a weighted sum of literal coverage + semantic similarity + LLM rubric score.
- **Optimize for the Workday/Taleo/iCIMS axis first, then Greenhouse-style human scorecards.** Workday (≈22–39% of Fortune 500), Oracle Taleo, iCIMS, and SAP SuccessFactors dominate enterprise; their parsers reward literal terms + canonical skill names + clean single-column DOCX. Greenhouse/Lever/Ashby/BambooHR/Jobvite are mostly recruiter-facing tools where humans grade on structured criteria, so the same evidence-rich, quantified bullets that win literal-match systems also win human scorecards.

---

## Key Findings

1. **Two technology generations coexist.** Oracle Taleo represents the pure keyword/Boolean generation; Workday Illuminate, SAP SuccessFactors with Joule + Talent Intelligence Hub, iCIMS Coalesce AI, and Bullhorn Amplify represent a newer generation that adds NLP, skills ontologies, and outcome-trained ranking models on top of literal text.
2. **Most "AI scoring" today is recommendation, not auto-reject.** Greenhouse, Ashby, Lever, iCIMS, and Workday explicitly position AI as ranking/highlighting, with humans still required to advance or reject. The notable hard-filters are *answers to knockout questions* and *required-credential checks* on Workday, Taleo, and SAP SuccessFactors — not the scoring of resume prose.
3. **The single biggest controllable variable is parse fidelity.** Across every vendor's documentation and practitioner research, the same five formatting rules dominate (single column, no tables for layout, no text in headers/footers, standard section names, text-extractable DOCX/PDF). If the parser misses a skill or section, every downstream scorer—keyword, semantic, or LLM—works on degraded input.
4. **The user's bullet-selection problem is well-served by one rubric.** The union of dimensions every ATS rewards (literal coverage, semantic equivalence, recency, evidence strength, quantification, seniority/scope) collapses into a stable 5–6 dimension analytical rubric that an LLM-judge can score reproducibly at temperature 0.
5. **Determinism with LLM judges is "best-effort."** Even at temperature 0, hosted endpoints are not bit-identical across calls due to floating-point non-determinism in batched GPU inference. Open-weights models on controlled hardware are the only way to get strict reproducibility; for hosted APIs, lock the model version (`system_fingerprint` on OpenAI), pass a seed, use rigid JSON schemas, and validate via swap augmentation.

---

## Details

### 1. Per-ATS Breakdown of Matching Methodology

#### 1.1 Workday (Workday Recruiting + HiredScore + Illuminate)

- **Market position:** ~22.6–39% of Fortune 500 (depending on report year); the dominant enterprise ATS.
- **Parsing:** Two-stage. Stage one extracts plain text and strips layout; stage two performs named-entity extraction into a fixed candidate-profile schema (contact, work history, education, skills). Headers/footers are typically stripped. Tables, multi-column layouts, text boxes, and Canva/InDesign-exported PDFs reliably scramble field mapping. DOCX parses more cleanly than design-tool PDFs.
- **Matching:** Workday uses NLP (not pure keyword counting) and now layers Illuminate (announced September 2024) on top, which performs semantic matching between extracted bullets and the canonical skill graph (Skills Cloud, ~200,000 skills with inferred relationships). HiredScore — acquired February 2024, closed early FY2025 — provides "AI-driven candidate grading" tiers exposed as the recruiter's prioritized review queue.
- **Knockouts:** Workday's hard filters are *application questionnaire* knockout questions (e.g., authorization to work, years of experience). Resume content does not directly auto-reject; it ranks.
- **Recruiter view:** Tiered/graded candidate list (HiredScore "fetch" surfacing prior applicants); recruiters click into parsed profile + original resume.
- **Quirks to plan for:** Skills Cloud anchors better on canonical names *and* their abbreviations spelled out together (e.g., "Structured Query Language (SQL)"); Illuminate is described by Workday/HiredScore as transparent and skills-only (no social media inference).

#### 1.2 Greenhouse (Greenhouse Recruiting)

- **Market position:** ~10–20% of mid-market and tech (Airbnb, Stripe, Slack, Pinterest); #4 on Apps Run The World's 2024 ATS share list.
- **Parsing:** Patented parsing technology, generally tolerant; produces a parsed profile, but recruiters view the *original resume file* alongside the parsed data.
- **Matching:** Explicitly **human-scorecard driven**. Greenhouse's structured hiring methodology has interviewers fill in scorecards built from the requisition's "Focus Attributes." Greenhouse states publicly that it "does not auto-reject" and "does not rate candidates" with AI. AI features (in `Configure > AI Tools`) cover scorecard-attribute generation, resume anonymization, candidate summaries, scheduling, offer-acceptance forecasting, and report drafting — *not* numeric resume scoring. Bias-audited monthly by Warden AI; ISO 42001:2023 certified.
- **Knockouts:** Application/screening questions, but most decisions are recruiter-driven.
- **Recruiter view:** Searchable candidate database + interview kit + scorecard.
- **Implication for the user:** Optimize for scorecard reviewers — STAR-formatted bullets with quantified evidence are easiest to copy into "Pros/Cons" of a screen.

#### 1.3 Lever (LeverTRM, owned by Employ Inc.)

- **Market position:** Tech-startup heavy (≈7,400+ customers including Netflix, Shopify, Atlassian, Figma).
- **Parsing:** Standard structured extraction into a candidate profile.
- **Matching:** Historically a Boolean/CRM-style search engine — Jobscan and others document that Lever does not score resumes against the JD. Since the 2023 Employ acquisition, Lever absorbed Gem's AI sourcing/ranking technology, and modern LeverTRM combines full-text relevance, recruiter-applied tags, and a Gem-style semantic ranking layer that influences review order. There is no per-candidate 0–100 match number in the standard recruiter view; ranking is implicit.
- **Knockouts:** Application questions; minimal automated disqualification.
- **Recruiter view:** Boolean search + recruiter-assigned star ratings + AI-suggested top matches.

#### 1.4 Oracle Taleo (Oracle Recruiting / Taleo Enterprise)

- **Market position:** Long-time F500 leader; usage declining versus Workday but still 22–24% share when combined with Oracle's other recruiting products.
- **Parsing:** The oldest parser of the group. Tables, text boxes, columns, and graphics frequently produce truncated or scrambled records. Independent testing shows roughly 41% of complex-formatted resumes have at least one parsing error in Taleo vs. 27% in Workday and 15% in Greenhouse.
- **Matching:** **Pure keyword matching with no synonym recognition or NLP.** Documented Oracle ACE Prescreening model: each prescreening question or competency is set to **Required**, **Asset**, or blank, with optional numerical **Weight**. The system divides candidates into ACE candidates (all Required + some Assets), Minimally Qualified (all Required, no Assets), and Other (missing Required).
- **Knockouts:** Disqualification questions auto-exit candidates who miss the Required answer. Asset criteria are scored, not gating.
- **Recruiter view:** Sortable list with ACE Candidate icon; rank score driven by Required/Asset/Weight.

#### 1.5 iCIMS (iCIMS Talent Cloud → Coalesce AI)

- **Market position:** Apps Run The World ranked iCIMS **#1 by ATS market share at 10.7%** in its 2024-2029 forecast; ~25% of Fortune 500.
- **Parsing:** Maintains a visual copy of the original file. Historically preferred DOCX because PDF extraction was less reliable; PDF parsing has improved by 2024 but DOCX remains safer for non-trivial layouts. Headers/footers are frequently skipped.
- **Matching:** Talent Cloud AI (TCAI) provides Job Matching, Talent Match, and **Candidate Ranking / Role Fit** — an ontology-based skills-overlap algorithm trained on real-world recruiting data (never on gender, sexual orientation, address, or social signals, per iCIMS). iCIMS Copilot (early 2024) is a generative-AI assistant powered by GPT-4 via Azure OpenAI; it generates a candidate summary and Role Fit score from the *parsed profile*, not the raw file. In March 2026 the AI capabilities were rebranded as **iCIMS Coalesce AI**, which spans intelligent search/match, digital assistants, and the iCIMS Agents network (Sourcing Agent in early access October 2025; full agentic platform announced June 2025).
- **Knockouts:** Configurable screening questions; iCIMS positions AI as recommendation only, supported by published bias audits (NYC Local Law 144 AEDT compliance) and TrustArc TRUSTe Responsible AI certification.
- **Recruiter view:** Tiered candidate list with Role Fit score; Talent Match returns "more like this" suggestions; Skills Overlap visualizes shared skills with a target profile.
- **Quirk:** Role Fit uses largely literal keyword overlap on the parsed profile — abbreviations like "JS" do not score the same as "JavaScript" if the JD uses the longer form.

#### 1.6 SAP SuccessFactors Recruiting (+ Joule + SmartRecruiters)

- **Market position:** ~13% of Fortune 500; ~$13B suite; SAP acquired SmartRecruiters in September 2025, with the combined "SmartRecruiters for SAP SuccessFactors" rolling out through 2026.
- **Parsing:** Standard structured extraction (RChilli, DaXtra, and Textkernel are common embedded parsers).
- **Matching:** **Skills-first** via the **Talent Intelligence Hub**, anchored to the SAP Knowledge Graph (a neural skills/ontology layer). With the AI Units license, **Joule** powers skills extraction, candidate–job matching, **stack ranking**, and interview-question generation. The SAP community documents that stack ranking auto-sorts applicants from best fit to least fit based on job requirements + skills framework. Pre-screening (knockout) questions are configured per requisition with score and auto-disqualification settings.
- **Knockouts:** Pre-screening / knockout questions on the application; Business Rules Engine can auto-validate or disqualify.
- **Recruiter view:** Stack-ranked list, Candidate Display Options for sorting by question scores; SmartRecruiters' "Winston" AI companion will further integrate with Joule from 2026.

#### 1.7 Ashby (Ashby ATS)

- **Market position:** High-growth tech startups; 2018 founding, rapidly expanding.
- **Parsing:** Modern, tolerant parser; PII is redacted from any data sent to AI models.
- **Matching:** **AI-Assisted Application Review** (launched 2023). Recruiters define criteria; the integrated AI returns a **binary "Meets" / "Does not Meet"** verdict per criterion, with citations. Ashby's published policy: AI never numerically ranks candidates — humans always make decisions. FairNow conducts third-party bias audits.
- **Knockouts:** Recruiter-defined screening questions; no auto-reject from resume content.
- **Recruiter view:** Batched grouping by criteria (Ashby's VP of Talent reportedly reviewed 1,500 applications in 6 hours using this).

#### 1.8 Bullhorn (Bullhorn ATS + Amplify)

- **Market position:** Dominant ATS+CRM in the staffing-agency segment; top-10 by market share.
- **Parsing:** Bullhorn announced in early 2026 a phased upgrade to a **Textkernel-based parser** rolling out across Q1–Q2 2026, replacing/augmenting the prior in-house parser; supports many languages and outputs a confidence percentage per parse.
- **Matching:** **Bullhorn AI Search & Match / Amplify** uses an outcomes-trained model on Bullhorn's "S.E.A." dataset (453M submissions, 60M placements, per Bullhorn marketing) to produce a **0–100 Relevancy Score** for candidate–job pairs. Amplify Screener interviews layer on a 0–100 screening score and a separate Engagement Score (>75 = actively engaged).
- **Knockouts:** Configurable; staffing workflows often rely on parser-confidence and recruiter judgment, not auto-reject.
- **Recruiter view:** Top-10 recommended candidates with relevancy scores; Boolean and saved searches.

#### 1.9 Jobvite (Evolve Talent Acquisition Suite, Employ Inc.)

- **Market position:** Mid-market and enterprise; sister product to Lever under Employ Inc.
- **Parsing:** Standard structured parser; text-PDFs supported.
- **Matching:** **Talent Fit / Candidate Match** (renamed from Candidate Match in late 2025). Talent Fit compares skills, certifications, licenses, and experience from the resume against the JD and assigns a **binary "Talent Fit" label** (no numerical ranking, intentionally — to reduce bias and avoid recommending weak candidates). Recognizes abbreviations in JD context (e.g., "TA" = "Talent Acquisition" if the JD discusses Talent Acquisition).
- **Knockouts:** Standard screening questions on the application.
- **Recruiter view:** Candidates flagged with "Talent Fit" tag; filterable; AI Companion handles structured interviews.

#### 1.10 BambooHR (BambooHR Hiring / ATS)

- **Market position:** SMB-dominant HRIS-first platform; ATS is part of the broader HRIS, not a sourcing engine.
- **Parsing:** Lightweight; resumes attached to candidate records, simple field extraction.
- **Matching:** Historically **no algorithmic resume scoring** — recruiters and collaborators manually rate candidates with star ratings and notes against the job requirements. A newer **BambooHR AI Agent** (third-party-built integrations and BambooHR's own agentic features) does NLP-driven resume screening and candidate matching, but the system of record remains human ratings.
- **Knockouts:** Application questions, no automated rejection by content.
- **Recruiter view:** Mobile-first candidate cards with collaborator ratings and comments.

### 2. Comparison Matrix

| ATS | Primary archetype | Parser sophistication | Synonym/semantic | Score output | Hard knockouts | AI features (2024–2026) | Market segment |
|---|---|---|---|---|---|---|---|
| Workday | NLP + skills graph + AI grade | High | Yes (Illuminate + Skills Cloud) | Tiered grades (HiredScore) | Yes (questionnaire) | HiredScore (acquired Feb 2024); Illuminate Sept 2024 | F500 enterprise |
| Greenhouse | Human scorecard | High | Partial (parsing only) | Aggregated scorecard (human-rated) | Application questions only | Scorecard generation, anonymization, summaries (no candidate scoring) | Tech mid-market |
| Lever | Boolean search + AI rank | Medium-High | Yes (post-Gem absorption) | Implicit ranking + recruiter stars | Minimal | Gem AI ranking (post-2023) | Tech startups |
| Oracle Taleo | Pure keyword + ACE | Old/Low | **No** | Numeric rank + ACE tier | Yes (disqualification questions) | Limited; Oracle Recruiting Cloud adds modest NLP | F500 (declining) |
| iCIMS | Skills ontology + GenAI Copilot | Medium-High | Yes | Role Fit tiers (0–100 internal) | Configurable | Copilot (GPT-4/Azure, 2024); Coalesce AI (2026); Agents (Q3 2025+) | F500 enterprise (#1 share) |
| SAP SuccessFactors | Skills-first + Joule | High (with Talent Intelligence Hub) | Yes (Knowledge Graph) | **Stack ranking** | Yes (pre-screening) | Joule (AI Units license); SmartRecruiters integration 2026 | Global enterprise |
| Ashby | Human-with-AI-assist | High | Yes | **Binary "Meets / Does not Meet"** | Recruiter-defined | AI-Assisted Application Review (2023) | High-growth startups |
| Bullhorn | Outcomes-trained match | Medium → High (Textkernel 2026) | Yes | **0–100 Relevancy** | Configurable | Amplify (search/match/screener) | Staffing agencies |
| Jobvite | Skills + license/cert match | Medium | Yes | **Binary Talent Fit label** | Standard | Talent Fit / Candidate Match; AI Companion | Mid-market |
| BambooHR | Human ratings | Low-Medium | No | Star ratings (human) | Application questions | AI Agent (third-party + native) | SMB |

### 3. Decision: Build ONE Consolidated Scorer

**Recommendation: build a single consolidated scorer.** Justification, grounded in what the matrix shows:

1. **Variance clusters into ~4 archetypes, not 10.** Once you discount UX and workflow differences, every ATS in the set rewards some combination of (a) literal keyword/phrase coverage, (b) semantic/skills-graph similarity, (c) evidence strength (quantification, scope, outcomes), and (d) recency/duration of the relevant skill or experience. Greenhouse, Ashby, and BambooHR add a *human* layer — but the inputs that human reviewers grade against are essentially the same dimensions a Workday/iCIMS/SAP scoring model uses.
2. **The user's bullet-selection task is upstream of the ATS.** The user is not optimizing what the ATS reports back; they are picking the best evidence for a qualification *before* submission. A unified rubric that maximizes the union of signals (literal + semantic + evidence + recency) produces bullets that survive every archetype. Per-ATS tuning would only matter if the user had ten parallel pipelines, each emitting differently-formatted resumes — almost certainly diminishing returns on engineering time.
3. **The "lowest common denominator" works.** Producing bullets that contain (i) the JD's exact terminology at least once, (ii) canonical skill names with their acronyms expanded, (iii) a quantified outcome, and (iv) verifiable scope satisfies Taleo's keyword model, Workday/SAP/iCIMS semantic models, Bullhorn's outcomes-trained ranker, *and* Greenhouse/Ashby human scorecards.
4. **Per-ATS tuning yields marginal gains.** The only ATS-specific divergences worth special handling are: literal-keyword strictness (Taleo, iCIMS) and answers to knockout questions (Workday, SAP). Both are addressed by selection criteria that prefer bullets containing exact JD vocabulary — handled in the unified scorer.
5. **Maintainability.** One LLM prompt + one embedding model + one rubric is testable, versionable, and easier to audit (important if any output is ever shown to candidates). Ten variants would multiply prompt drift, regression risk, and evaluation cost.

### 4. Proposed Architecture for the Consolidated Scorer

**Pipeline (per qualification × master-resume-bullet):**

**Stage A — Deterministic preprocessing (no LLM):**
1. Normalize the master resume into structured bullets with metadata: `{bullet_text, role, employer, start_date, end_date, project, technologies[]}`. Compute `recency_months` from `end_date` (or "present").
2. Normalize the qualification with an acronym/synonym dictionary you maintain (e.g., `JS↔JavaScript`, `PM↔Project Management`, `FP&A↔Financial Planning and Analysis`). Persist canonical and abbreviated forms.
3. **Literal coverage gate:** Tokenize and lowercase; compute the fraction of qualification noun-phrases (extracted via a deterministic chunker like spaCy `noun_chunks` plus the JD-provided structured noun phrases) that occur literally in the bullet. Output `literal_coverage ∈ [0,1]`.
4. **Semantic retrieval gate:** Embed every bullet once (offline); embed each qualification at run time. Use **`voyage-3-large`** or **`text-embedding-3-large`** (Voyage leads MTEB retrieval; OpenAI is more widely supported and matryoshka-compatible). For each qualification, retrieve the top-K (e.g., K=15) bullets by cosine similarity. Persist `semantic_sim ∈ [0,1]`.

**Stage B — LLM judge (temperature 0, fixed system prompt, JSON-schema output):**

For the top-K retrieved bullets per qualification, score each on an analytical rubric:

| Dimension | What it measures | Scale |
|---|---|---|
| `keyword_overlap` | Literal match of qualification terms (deterministic, passed as input) | 0–10 |
| `semantic_relevance` | Whether the bullet's content actually demonstrates the qualification (LLM judgment) | 0–10 |
| `evidence_strength` | Specificity of action verbs, technologies, and methods named | 0–10 |
| `quantification` | Presence and credibility of numeric outcomes (% , $, scale, time) | 0–10 |
| `seniority_scope` | Whether the bullet matches the qualification's implied scope (team size, budget, autonomy) | 0–10 |
| `recency` | Computed deterministically from metadata (full credit ≤24 months, decay after) | 0–10 |

Final `match_score` (0–100) = weighted sum, recommended starting weights:
- keyword_overlap 0.20, semantic_relevance 0.30, evidence_strength 0.15, quantification 0.15, seniority_scope 0.10, recency 0.10. Weight `keyword_overlap` and `seniority_scope` higher when the qualification is *basic/required*; weight `semantic_relevance` and `evidence_strength` higher when *preferred*. Keep two weight vectors (basic vs. preferred), not 10 ATS-specific vectors.

`confidence` (0–1) = a separate LLM-emitted self-rating combined with: agreement between literal and semantic gates (high agreement → higher confidence) and a penalty when the bullet contradicts itself (e.g., "led" but "supported"). Use `confidence = 0.5 * llm_self_confidence + 0.3 * agreement(literal, semantic) + 0.2 * (1 - hedging_score)`.

**Stage C — Top-3 selection per qualification:**
1. Sort by `match_score`.
2. Run **swap augmentation**: present the top 5 bullets to the LLM in two random orderings and accept only positions where ranking is consistent across orderings. This neutralizes the documented LLM position bias.
3. Apply diversity filter: prefer bullets from different roles/projects to avoid three near-duplicates.
4. Emit the top 3 with their per-dimension scores, the final `match_score`, and `confidence`.

### 5. Implementation Guidance

**Determinism (LLM judge):**
- Set `temperature=0`, `top_p=1`. Provider docs and independent benchmarks confirm this is "best-effort," not strict, on hosted endpoints.
- Pin the model version explicitly (e.g., `gpt-4o-2024-08-06`); store and assert `system_fingerprint` in every response.
- Pass `seed` where supported (OpenAI, some Gemini endpoints). Anthropic does not currently expose a stable seed; budget for slight drift.
- Prefer **JSON-schema-constrained output** (OpenAI structured outputs / function calling, Anthropic tool-use). Parsed-answer reproducibility is dramatically higher than string-level reproducibility (the relevant arXiv work on temperature-0 non-determinism reports near-100% parsed agreement even when raw strings drift).
- For maximum strict reproducibility, run an open-weights model (Qwen3-Embedding/Llama-3.x for judges) in a single-batch deterministic kernel on controlled hardware.
- Hash the prompt + input + model version + seed; cache by hash so the same input always returns the same output.

**Prompt-engineering rules for the judge:**
- Use a fixed *system* prompt that defines the rubric, scale, anchor examples for 0/5/10, and the output schema.
- Pass the qualification and the bullet as separately delimited fields. Provide the deterministic `literal_coverage` and `semantic_sim` as inputs the LLM cannot recompute, so it focuses on the soft dimensions.
- Forbid free-text outside the JSON.
- Include 2–3 calibration anchor examples in the system prompt (one strong match, one weak, one near-miss) — analytic rubrics with anchors materially improve cross-judge agreement (Autorubric, LLM-Rubric research).
- Score one bullet per call (or, if batching for cost, randomize order and run swap augmentation). Do not let the LLM compare bullets against each other in a single call — that introduces position bias and halo effects.

**Recommended embedding models (April 2026 state of the art):**
- **Production quality:** Voyage AI `voyage-3-large` (top retrieval MTEB), or OpenAI `text-embedding-3-large` (3,072 dims, matryoshka-truncatable).
- **Cost-efficient:** Voyage `voyage-3-lite`, Cohere `embed-v4`, or Jina v5-small.
- **Self-hosted/privacy:** BGE-M3 (MIT) or Qwen3-Embedding-8B (Apache 2.0).
- Embed bullets once, cache by content hash; re-embed only when bullets change.

**Suggested rubric anchors (for the judge prompt):**
- *evidence_strength = 10:* "Migrated 2.4PB Snowflake warehouse to Iceberg on S3, reducing query cost 38% across 14 BI dashboards used by Finance and Ops."
- *evidence_strength = 5:* "Built data pipelines in Python and Snowflake to support reporting."
- *evidence_strength = 0:* "Worked on data."

**ATS-specific tweaks worth keeping (small list):**
- Always include the JD's exact phrasing at least once per matched qualification (Taleo, iCIMS Role Fit literal-match behavior).
- Spell out acronyms once: `Financial Planning and Analysis (FP&A)` (Workday Skills Cloud canonicalization).
- Default to single-column DOCX output; avoid tables/text-boxes (Workday, Taleo, iCIMS parser fragility).
- Keep dates in `MMM YYYY – MMM YYYY` (Workday/Taleo date-extraction strictness).

**Validation harness you should build:**
- 30–50 hand-labeled `(qualification, bullet, expected_top_3)` triples covering basic and preferred qualifications across roles.
- Track per-dimension Cohen's κ between the judge and a human grader; aim for κ ≥ 0.6 weighted on each dimension.
- Track stability: same input across 10 runs should produce ≥95% parsed-answer agreement on top-3 set membership and ≥90% on top-3 ordering after swap augmentation.

---

## Recommendations

**Stage 1 (build the MVP, ~1–2 weeks):**
1. Build the deterministic preprocessor (acronym normalization, literal coverage, embedding retrieval). Use OpenAI `text-embedding-3-large` for first cut; cache embeddings.
2. Implement the LLM-judge with a single system prompt, JSON-schema output, GPT-4o or Claude Sonnet at temperature 0, model version pinned, prompt+seed hashed for caching.
3. Compute `match_score` and `confidence` with the formulas above. Emit top-3 per qualification with full per-dimension scores.
4. Hand-label 30 triples and tune the weight vector. **Threshold to advance:** weighted-κ ≥ 0.6 on `semantic_relevance` and `evidence_strength`, ≥95% top-3 membership stability across 10 runs.

**Stage 2 (harden, ~1 week):**
5. Add swap augmentation for top-3 ordering and a diversity filter.
6. Add a "claim verification" sub-check: when the LLM scores `seniority_scope ≥ 8`, require it to extract the supporting span from the bullet — a deterministic guard against hallucinated credit.
7. Run end-to-end on three job descriptions of differing seniority and re-tune.

**Stage 3 (scale, optional):**
8. If you ever need bit-strict reproducibility (audit trail), move judging to an open-weights model in a controlled inference environment.
9. Only consider per-ATS variants if downstream A/B testing shows ≥15% callback uplift attributable to ATS-specific phrasing — strong empirical evidence is required to justify the maintenance cost.

**Triggers to revisit the "one scorer" decision:**
- The user begins applying through automated channels where the ATS's own AI score is exposed to recruiters as the *primary* signal (currently rare; iCIMS Role Fit and Workday HiredScore tiers are the main exceptions). Per-ATS variants might then shave a few rank positions.
- A future ATS publishes its scoring algorithm or weights (none have, as of May 2026).
- You expand from "best 3 bullets" to dynamic resume *generation* per role; a per-archetype variant of the scorer (4 variants — one per archetype, not 10) would be reasonable.

---

## Caveats

- **AI-feature claims from vendors are partly marketing.** Bullhorn's "trained on 453M submissions / 60M placements" and HiredScore's "70% rediscovery rate" are vendor-published outcomes, not independently audited. Treat them as directional, not benchmarks.
- **The ATS landscape is moving fast.** Within the research period (2024–early 2026), Workday acquired HiredScore (Feb 2024) and launched Illuminate (Sept 2024); SAP acquired SmartRecruiters (Sept 2025) with the integrated product rolling out in 2026; iCIMS launched Coalesce AI (March 2026) and the Agents network (June 2025+); Bullhorn upgraded its parser to Textkernel (Q1–Q2 2026). Specifics in this report may shift again within months.
- **Resume parsing is *probabilistic*.** Even the cleanest DOCX can lose a section if the parser version or tenant configuration changes. Validate parses by viewing the auto-filled profile when possible (Workday, iCIMS, SAP) and correcting in the application.
- **LLM bias and fairness.** Independent research (Megagon Labs and others) shows LLMs in resume–JD matching exhibit reduced explicit gender/race bias in recent models but **persistent implicit bias around educational background**. If you ever expose this scorer to other people's resumes (not just your own master resume), you must add bias evaluation, redaction, and audit logs analogous to what Greenhouse, Ashby, and iCIMS do.
- **Determinism is not guaranteed on hosted LLMs** even at temperature 0 due to floating-point non-determinism in batched GPU inference; build for parsed-answer stability rather than byte-identical output.
- **Keyword density myths.** Practitioner blogs widely recommend "1–3% keyword density"; this is folklore, not a published ATS scoring formula. None of the ATS vendors document a density-based threshold. Coverage and placement matter; density is a useful sanity check, not a target.
- **Greenhouse, Ashby, BambooHR don't auto-score resumes** by default. Optimizing exclusively for "ATS algorithms" misses that ~30–50% of the candidate pool you'll face is graded by a human looking at a scorecard — which the same evidence-rich, quantified bullets win anyway.
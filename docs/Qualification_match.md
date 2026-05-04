# How ATS Platforms and Major Tech Companies Evaluate Basic vs. Preferred Qualifications

## TL;DR

- **Almost every major ATS structurally separates "basic/required" qualifications from "preferred/asset/nice-to-have" qualifications, but only a minority — Oracle Taleo, SAP SuccessFactors, Workday, and most knockout-question implementations — treat basic qualifications as a true automated hard knockout. Most modern systems (Greenhouse, Ashby, Lever, Jobvite, BambooHR) treat both tiers as inputs to a recruiter-facing score, label, or sort order, with a human making the actual disqualification decision.**
- **The dominant scoring pattern is binary on basics + graded on preferreds: meeting 100% of stated basic qualifications is a near-prerequisite for human review, while preferred qualifications determine your *rank* within the qualified pool. The Taleo "ACE" model (a candidate must meet all Required and some Asset criteria to surface), Workday's "Strong/Good/Fair/Low" Candidate Skills Match, iCIMS' Role Fit tiers, and Bullhorn's 0–100 Relevancy Score are all variations on this same theme.**
- **For FAANG, the explicit "Basic Qualifications / Preferred Qualifications" headers used by Amazon, Google ("Minimum / Preferred"), Microsoft ("Required / Additional or Preferred"), and Meta ("Minimum / Preferred") are not just style — recruiters internally use the basic list as a literal checklist for resume screen pass/fail, and use preferred quals to sort the qualified pile and to justify level (e.g., L4 vs L5). The practical resume strategy is: cover every basic qualification with literal, recognizable language and quantified evidence, then layer in preferred qualifications wherever they're truthful.**

---

## How to Read This Report

Two structural facts shape every section below:

1. **There is a difference between *application-form* knockouts and *resume* parsing.** Almost every ATS supports knockout questions ("Are you authorized to work in the US?" / "Do you have a valid CDL?") that auto-disqualify regardless of resume content. Where these are tied to a basic qualification, that qualification *is* a hard gate. Resume-text scoring, by contrast, almost always feeds a recruiter-visible score or rank — not an automatic reject.
2. **The Mobley v. Workday class-action (N.D. Cal., 2023–present) has reshaped vendor language.** Following the court's ruling that an AI scoring tool can act as an "agent" of the employer, most vendors have publicly clarified that their AI does *not* auto-reject. In practice, however, low-ranked candidates may simply never be reviewed because recruiters work top-down through a queue.

---

# PART 1 — ENTERPRISE ATS SYSTEMS

## 1. Workday Recruiting (with HiredScore + Illuminate)

**Job posting setup.** Workday job requisitions have a "Qualifications" section recruiters typically split into two free-text blocks (Required/Minimum vs. Preferred/Additional). Workday also separately supports application-form *Questionnaires* and screening questions that can be flagged "required" — these are the true automated knockout layer. Customers using Position Management can also tag job-profile *Skills* as Required or Optional on the requisition.

**How basic vs. preferred is weighted.**
- **Knockout questions** (e.g., work authorization, license, minimum years) function as hard auto-disqualifiers when the recruiter configures them as such; an immediate "Inactive / Not Selected" status after submit is almost always a knockout-question mismatch, per common practitioner reports.
- **Candidate Skills Match (CSM)**, Workday's native AI scoring tool, extracts skills from the job posting and the application and returns a label of *Strong*, *Good*, *Fair*, *Low*, *Pending*, or *Unable to Score* (per court documents in *Mobley v. Workday*). This is essentially a soft ranking that influences which candidates a recruiter reviews first; it is not officially a knockout.
- **HiredScore AI for Recruiting** (acquired by Workday in 2024 and now part of the Illuminate suite launched in May 2025) adds *grade-based* candidate ranking (A–D) and the "Spotlight" and "Fetch" features to surface top-fit applicants, including past applicants. The court has held HiredScore is part of the same "unified policy" as CSM for purposes of the class action.

**Recruiter interaction.** Recruiters filter and sort by CSM result and HiredScore grade, then act manually. Knockout-disqualified candidates land in disposition states like "Doesn't have required qualifications."

**Evidence.** Workday's own court filings describe CSM's labels; the *Mobley* docket details how Workday markets these tools as "recommendations." Workday's official position is that hiring decisions are made by customers — but plaintiffs note rejection emails arriving within minutes, suggesting the system de facto removes candidates from consideration before any human review.

**Example posting language.** "Bachelor's degree in Computer Science AND 5+ years of software engineering experience" (Required) vs. "Master's degree preferred; experience with Kubernetes a plus" (Preferred) — Workday clients typically render these as two bullet lists in the job-posting body, not as discrete tagged fields.

**Bottom line.** In Workday, a resume text mismatch will lower your CSM/HiredScore tier and push you down the queue — functionally a soft knockout at scale. A wrong knockout-question answer is a true hard disqualifier.

---

## 2. Greenhouse Recruiting

**Job posting setup.** Greenhouse uses two separable mechanisms: **Application Questions** (with optional knockout flags) and **Scorecards** (skills, traits, qualifications, "other attributes" you want in a candidate). Greenhouse's recommended scorecard template explicitly groups attributes into "Eligible to be considered" (e.g., work authorization, salary fit), "Necessary qualifications," "Work product/skills," and "Culture add."

**How basic vs. preferred is weighted.** Greenhouse is the most explicitly *anti-algorithmic* of the major platforms. Their public policy: "We don't use ML or other algorithmic techniques to automatically make disposition recommendations, assign quality scores, or rank candidates." Greenhouse's AI **Talent Matching** tool (rolled out 2024–2025) compares a candidate's parsed resume to recruiter-defined "calibration criteria" weighted by importance, but it never auto-rejects and explicitly does not produce a numeric ranking. The only true automated disqualifier in Greenhouse is a knockout question with a wrong answer.

**Scoring formulas.** Greenhouse uses a colored-emoji scale (red/yellow/green) for human scorecard ratings rather than numeric scores, and recommends 6–12 attributes per scorecard category. Final recommendations are categorical: "Strong Yes, Yes, No, Strong No."

**Recruiter interaction.** Recruiters mark "focus attributes" — the must-haves they want each interviewer to verify. Talent Matching surfaces likely-fit candidates at the top of the application review pane with citations for why; recruiters still advance/reject manually.

**UI features.** Anti-bias "nudges," resume anonymization, third-party (Warden AI) bias audits across 10 protected classes monthly.

**Bottom line.** Basic qualifications act as a *human* knockout via the recruiter's checklist; preferred qualifications affect rank only via human scorecards or AI-suggested matching. Resumes that list basic-qualification keywords clearly are read by the recruiter exactly as uploaded.

---

## 3. Lever (LeverTRM, Employ Inc., post-Gem AI)

**Job posting setup.** Lever job posts use free-text Requirements / Bonus sections; structured "Tags" can be applied to candidates and roles for filter and search.

**How basic vs. preferred is weighted.**
- After Lever's 2022 acquisition by Employ Inc. (Jobvite's parent) and the integration of Gem's AI through 2023–2024, LeverTRM gained an **AI-assisted shortlist** that uses tag matching plus full-text relevance to surface top candidates.
- **Talent Fit** (the Employ-shared engine also used in Jobvite and JazzHR) renders a *binary* "fit" / no-label decision against the job description, with a written explanation citing strengths, key considerations, and "areas to clarify." It does *not* auto-advance or auto-reject.
- The newer **AI Interview Companion** (formerly Pillar) handles structured interviews with bias flagging.

**Scoring formulas.** Talent Fit's binary label is calibrated to a >0.9 EEOC impact-ratio standard (more conservative than the EEOC's 0.8 four-fifths rule), per Employ documentation.

**Recruiter interaction.** Recruiters see Talent Fit-labeled candidates surfaced first, then act manually. There is no published numeric score for candidates from Lever itself.

**Bottom line.** Basic qualifications act as both a Talent Fit input (binary) and a tag/keyword filter; preferred qualifications shift you into the "fit" bucket and provide the explanatory narrative recruiters skim first.

---

## 4. Oracle Taleo Enterprise (ACE Prescreening with Required / Asset / Weight)

**Job posting setup.** Taleo is the **only ATS in this list with explicit, first-class fields for Required vs. Asset vs. Weight**, configured per question and per competency on the requisition. This is the ACE (Abilities, Certifications, Experience) prescreening model.

**How basic vs. preferred is weighted (documented).**
- **Required**: The candidate's answer or competency level *must* be selected, or they fail the requirement. Per Oracle docs: "A required criterion means that the competency or answer to a question absolutely has to be selected for the candidate to be considered for the job. Think 'Minimum Requirements'."
- **Asset**: "Does not have to be selected... but would distinguish this candidate compared to others. Think 'Strongly Preferred' and 'Nice-to-Have'."
- **Weight**: An optional numeric multiplier applied to either Required or Asset criteria, used only when assets vary in importance.
- **Disqualification questions** (separate field type) auto-fail candidates immediately.

**ACE Candidate Alert / scoring formula.** Taleo segments candidates into three groups:
1. **ACE candidates** — meet *all* Required and *some* Assets (computed against the Asset threshold the recruiter defines by answering "as the ideal candidate would" and totaling weights).
2. **Minimally qualified** — meet all Required but no Assets.
3. **Other candidates** — fail one or more Required.

Recruiters sort by an "ACE" star icon, "Requirements" met, "Assets Met X/Y," and "Result %" columns.

**Bottom line.** Taleo is the textbook system: basic = absolute gate, preferred = differentiator scored as a fraction of assets met (with optional weights). If you've ever applied to a state government, healthcare system, or large bank job and seen multi-page checkbox prescreens, this is what was happening behind the scenes.

---

## 5. iCIMS (Talent Cloud, Coalesce AI, Role Fit)

**Job posting setup.** Job postings in iCIMS support free-text qualifications plus configurable application questions; the recruiter sees a parsed candidate profile rather than the raw resume in most views.

**How basic vs. preferred is weighted.**
- **Role Fit** is iCIMS's AI ranking algorithm (originally built on the 2020 Opening.io acquisition, now under the **Coalesce AI** brand launched March 2026). Role Fit assigns each candidate to **tiers** based on their relative scores on a per-job basis. iCIMS docs: "Candidates for the job are grouped into tiers with similarly scored candidates to help users quickly identify those with the highest ranking… A high Role Fit ranking indicates that a candidate has experiences and skills that match the requirements of the job." The number of tiers is dynamic, not fixed.
- iCIMS proactively classified Role Fit/Candidate Ranking as an "Automated Employment Decision Tool" (AEDT) under NYC Local Law 144 and commissioned independent bias audits in 2022 and 2023.
- Knockout questions can still hard-disqualify on the application form layer.

**Recruiter interaction.** Recruiters work top-down through tiers. Critically, the **recruiter's primary view is the parsed candidate profile, not the original PDF**, so a parsing failure on a basic qualification ("3+ years Python") effectively erases that match signal.

**Bottom line.** Basic qualifications need to parse cleanly into iCIMS's structured fields and use the *exact* terminology of the job posting, because Role Fit is more keyword-literal than Workday's CSM. Preferred qualifications increase your tier rank.

---

## 6. SAP SuccessFactors Recruiting (with Joule + Talent Intelligence Hub)

**Job posting setup.** SuccessFactors Recruiting Management uses a dedicated **Pre-Screening Question** framework on each requisition with five per-question parameters: **Required**, **Disqualifier**, **Score**, **Weight**, and **Required Score**.

**How basic vs. preferred is weighted (documented formula).**
- **Required**: Must be answered (form-level enforcement only; doesn't auto-disqualify on content).
- **Disqualifier**: Wrong answer = automatic disqualification ("Auto Disqualified" pink-row status). Free-text questions can't be disqualifiers.
- **Score** + **Weight**: Each scoreable answer's points contribute to a Rating. The documented formula per SAP support note 2204476: *Rating per question = (points awarded / total possible scored points)*. Total weight does not need to sum to 100.
- **Required Score**: A minimum Rating threshold the candidate must clear.
- Score and Weight are *ignored* on disqualifier questions.

**AI layer (2024–2026).** **AI-assisted applicant screening** powered by **Joule** with **AI Units** licensing performs skills extraction, candidate-job matching, and **stack ranking** against the **Talent Intelligence Hub** skills taxonomy. SAP also acquired SmartRecruiters in late 2025; the Winston AI agent is being merged into the SuccessFactors recruiting workflow.

**Recruiter interaction.** Recruiters see a Rating column, sort, and use auto-disqualification dispositions to clear the unqualified pile.

**Bottom line.** Of all the systems here, SuccessFactors comes closest to Taleo in offering a true configurable scoring formula. Basic qualifications encoded as Disqualifier questions are absolute knockouts; preferred qualifications encoded as scored questions with weights produce a numeric Rating.

---

## 7. Ashby ATS (AI-Assisted Application Review)

**Job posting setup.** Ashby's **AI Job Criteria** UI lets the recruiter define specific criteria directly inside the job's settings ("3+ years B2B SaaS experience," "Has shipped a mobile app," etc.). These can also be tied to specific application-form long-text questions.

**How basic vs. preferred is weighted.** Ashby has explicitly chosen *not* to numerically rank or score candidates. The AI returns one of three labels per criterion: **"Meets," "Does Not Meet," or "Unknown/Skipped"** with citations linking back to the resume evidence. As Ashby's VP of Talent Jim Miller has publicly written: "No decisions are made for me. No scoring or ranking is involved."

**Recruiter interaction.** The bulk Application Review tool lets recruiters group candidates by criterion-match patterns (e.g., "all who Meet criteria 1, 2, 3 but Does Not Meet criterion 4") to enable batch review. Up to 50 criteria can be evaluated per candidate; AI credits are metered per evaluation.

**UI features.** PII redaction before resumes hit the LLM, in-app warnings on potentially biased criteria, third-party FairNow bias audits, applicant AI opt-out.

**Bottom line.** Ashby effectively forces every criterion (basic or preferred) into a binary checklist. The practical implication: each basic qualification should be addressable by AI as a clear "Meets" with at least one quote-able resume bullet of evidence; preferred qualifications get filterable "Meets" labels that recruiters use to sub-segment.

---

## 8. Bullhorn ATS (Amplify, 0–100 Relevancy Score)

**Job posting setup.** Bullhorn is staffing-agency focused. Job records have free-text qualifications and integrate with the **Bullhorn Matching Engine** (powered by Textkernel skills ontology + Bullhorn's "S.E.A." dataset of historical placements).

**How basic vs. preferred is weighted.**
- **Relevancy Score (0–100)**: A traffic-light bar appears next to candidates: **80–100 Excellent (green)**, **50–79 Good (yellow)**, **0–49 Poor (red)**. The thresholds are hard-coded and not configurable per client. The score is generated by AI vector-based sorting against historic placement patterns, not literal keyword matching.
- **Amplify Screener** runs an AI chat/voice interview and produces a separate **0–100 screening score** combining job-specific knowledge, problem-solving, and (where applicable) leadership. The overall candidate score is split 50% screener / 50% resume relevancy.
- Recruiters can add **custom scoring instructions** to "place more weight on must-have skills or reduce scores for unanswered questions" — this is the only place where basic vs. preferred can be explicitly weighted differently.

**Recruiter interaction.** Recruiters see the Relevancy bar, the screening score, and a Strengths/Potential Gaps summary on each candidate.

**Bottom line.** Bullhorn is the most "0–100 number" platform in this list; both basic and preferred qualifications fold into the same number unless the recruiter manually instructs Amplify to weight basics higher.

---

## 9. Jobvite (Talent Fit / Candidate Match)

**Job posting setup.** Jobvite uses free-text qualifications plus optional pre-screen questions on the application.

**How basic vs. preferred is weighted.** Jobvite (now under Employ Inc.) shares the **Talent Fit** engine described in Lever above. It is intentionally **binary** — a candidate is either labeled "Talent Fit" (with strengths/considerations/clarifications text) or has no label. Per Jobvite docs: "A binary match or nothing simplifies the user's interpretation of the match results. Eliminates the challenges of recommending weak or very weak candidates."

The engine uses an anonymized resume + job description fed to a closed-source LLM with explicit instructions to disregard race/age/gender/disability cues, audited via IBM watsonx.governance to a >0.9 impact ratio.

**Recruiter interaction.** Recruiters can filter to "Talent Fit" candidates only. There's no numeric score and no auto-rejection.

**Bottom line.** Basic qualifications are the dominant input to the binary Talent Fit decision; preferred qualifications mostly affect the explanatory text the recruiter sees. The Talent Fit label is best treated as a "yes, surface this person" gate.

---

## 10. BambooHR Hiring

**Job posting setup.** BambooHR is SMB-focused HRIS+ATS. Job postings have free-text qualifications, and the Hiring app supports basic application questions.

**How basic vs. preferred is weighted.** BambooHR's ATS is intentionally lightweight: **manual recruiter ratings (1–5 stars or thumbs up/down) on a customizable scorecard** are the primary mechanism. There is no native AI candidate-ranking score akin to Workday CSM, iCIMS Role Fit, or Bullhorn Relevancy. Multiple G2/Gartner reviewers explicitly call out the absence of advanced AI screening as a gap. BambooHR has been adding AI Agent capabilities for routine HR tasks (onboarding, time-off summaries) but not for resume scoring.

**Recruiter interaction.** Recruiters search by keyword, manually filter by application question answers, and rate candidates. Knockout-question auto-disqualification is supported on application forms.

**Bottom line.** BambooHR essentially treats both basic and preferred qualifications as inputs to a human checklist. If your resume is in the BambooHR pile, you'll be read by a human; what matters is that basic qualifications are obvious within the recruiter's 6–8-second scan.

---

# PART 2 — FAANG + MAJOR TECH COMPANIES

## 1. Meta (Facebook)

**Current ATS.** Meta runs a **proprietary in-house recruiting platform** ("Career Profile") with custom workflows, integrated with Workday for HRIS but not for recruiting. CoderPad is used for coding interviews; an AI-assisted-coding pilot was added in 2025.

**Job posting structure.** metacareers.com listings use **"Minimum Qualifications"** and **"Preferred Qualifications"** as explicit headers. Meta's own hiring-process page tells candidates: "Review the minimum qualifications to ensure you're qualified for the position and your resume clearly reflects this… Before you apply, check to make sure you meet all minimum qualifications listed in the job description."

**Screening practice.** A 20–30 minute recruiter screen confirms basic qualifications + cultural fit. Meta employees on Blind/IGotAnOffer report that most postings require ≥5 years of role experience, and that referrals materially affect resume-screen success. Meta's "Move Fast" and cross-functional culture are interview-loop themes rather than resume-screen filters.

**E-level mapping.** Years of experience in the Minimum Qualifications block roughly map to E-levels (E3 new grad, E4 ~2 years, E5 ~5 years, E6 ~8+).

**Bottom line.** Meta enforces minimum qualifications strictly at the recruiter screen; preferred qualifications drive level placement and team match.

---

## 2. Apple

**Current ATS.** Apple uses a **proprietary in-house ATS** (sometimes informally called "AppleSeed" internally — though that term is ambiguous and also names Apple's beta program). Multiple resume-tooling vendors and ex-Apple recruiters confirm the system is custom and decentralized by team.

**Job posting structure.** jobs.apple.com listings typically use **"Minimum Qualifications"** + **"Key Qualifications"** + **"Preferred Qualifications"** headers, but the structure varies by team. Apple's hiring is famously decentralized — each team sets its own bar.

**Screening practice.** Apple receives ~53.7 resumes per opening per day according to industry estimates. Initial ATS keyword screen → manual recruiter review → recruiter screen call. Apple weights craft and detail heavily; ex-Apple engineers confirm that clean, text-based PDFs without graphics or tables parse best.

**Bottom line.** Apple's basic-vs-preferred distinction is enforced primarily by individual recruiters, not by a centralized scoring algorithm. Your resume needs to literally restate Minimum/Key Qualifications language to survive the keyword scan.

---

## 3. Amazon

**Current ATS.** Amazon uses a heavily customized internal ATS (built on a mix of in-house and Workday components). Public filings and recruiter posts confirm Workday Recruiting is part of the stack for some functions.

**Job posting structure (very explicit).** Every amazon.jobs posting uses **"BASIC QUALIFICATIONS"** and **"PREFERRED QUALIFICATIONS"** as fixed headers — this is the canonical example of the distinction. From an actual SDE I posting: *"BASIC QUALIFICATIONS: Bachelor's degree or equivalent. PREFERRED QUALIFICATIONS: Previous technical internship(s); Experience with distributed, multi-tiered systems, algorithms, and relational databases…"* From an SDE Intern posting: basic quals include "Demonstrated experience with at least one general-purpose programming language such as Java, Python, C++, C#, Go, Rust, or TypeScript" while preferreds include "AI tools for development productivity; Cloud platforms (preferably AWS)."

**Screening practice.** Amazon's own resume-writing guide (aboutamazon.com) explicitly tells candidates: "Look at the key words and phrases within the 'Basic and Preferred Qualifications' sections, and use this as a guide to help you determine what you should focus on in your resume." Recruiters use the basics as a literal pass/fail and use preferreds plus Leadership Principles alignment to rank the qualified pile. The famous **Bar Raiser** participates in interview loops, not resume screen.

**STAR-format requirement.** Amazon explicitly expects STAR-formatted behavioral interview answers tied to its **16 Leadership Principles** — these don't gate the resume screen but dominate the interview loop.

**Bottom line.** Of all FAANG, Amazon is the most literal: every Basic Qualification needs an unambiguous resume bullet matching the language ("X years of experience with Y"). Preferreds are how you justify SDE II vs. SDE I.

---

## 4. Netflix

**Current ATS.** Multiple sources (LoopCV, Lever's own customer list, Resume Optimizer Pro) confirm **Netflix uses Lever (LeverTRM)**.

**Job posting structure.** Netflix postings tend to be **less binary about minimum vs. preferred** — they use prose-style "What you'll do / what we're looking for" sections and emphasize cultural alignment over checkbox quals. Netflix typically hires senior (≥3 years experience) and the bar is calibrated to top-of-market individual contributors.

**Screening practice.** Netflix's culture memo describes the **"Keeper Test"** ("If X wanted to leave, would I fight to keep them?") as a continuous performance test, *not* a resume screen filter. The hiring manager — not the recruiter — owns the entire process and makes the final decision; recruiters partner as "consultants." Talent VP Nellie Peshkov has said Netflix recruiters specifically probe whether candidates *crave* structure, because structure-lovers are screened out.

**Bottom line.** Netflix relies less on rigid basic/preferred language and more on hiring-manager judgment + Lever Talent Fit binary surfacing. Tailor resumes to hiring-manager-readable narratives, not keyword density.

---

## 5. Google (Alphabet)

**Current ATS.** Google previously ran "gHire" internally and briefly sold "Google Hire" externally (sunset 2020). Public sources (Quora ex-Googlers, recruiting forums) indicate Google now uses a mix of in-house tooling, with **Avature** for some sourcing/CRM workflows.

**Job posting structure (very explicit).** Every Google posting on careers.google.com uses **"Minimum Qualifications"** and **"Preferred Qualifications"** as standard headers. Example software engineer L4 (Bengaluru): *Min: Bachelor's degree or equivalent practical experience; 2 years of experience with software development. Preferred: Master's degree or PhD; experience with distributed systems.*

**Screening practice.** Google's "How We Hire" page is unusually transparent. The recruiter screen is described by an internal recruiter in published interviews as "a preliminary check to assess basic qualifications, motivation for the role and Google, communication skills." Then a candidate packet — including resume, screen notes, and onsite feedback — goes to an independent **Hiring Committee** that scores on four attributes: **GCA (General Cognitive Ability), RRK (Role-Related Knowledge), Leadership, Googleyness**, on a 1–4 scale, with a 3.5+ average typically required to advance. Notably, Google has dropped GPA as a hiring factor and explicitly accepts "equivalent practical experience" in lieu of degrees.

**Bottom line.** Google's "Minimum" headers are taken seriously by the resume screener; "Preferred" qualifications affect leveling and whether the recruiter advocates for you to a senior team. The Hiring Committee evaluates beyond the resume.

---

## 6. Microsoft

**Current ATS.** Microsoft moved off Taleo years ago and now runs on a custom platform (jobs.careers.microsoft.com). Microsoft is also a major **SmartRecruiters** partner via SAP integrations for some divisions.

**Job posting structure (very explicit).** Every Microsoft posting uses **"Required/Minimum Qualifications"** and **"Additional or Preferred Qualifications"** as headers. Example Software Engineer IC2: *Required: Bachelor's Degree in CS or related technical field AND 2+ years coding experience in C/C++/C#/Java/JavaScript/Python OR equivalent experience. Preferred: Master's Degree AND 1+ years coding; proven software dev experience.* Microsoft also explicitly lists **"Other Requirements"** (e.g., "Microsoft Cloud Background Check") as a separate fixed-gate category.

**Screening practice.** Microsoft uses ATS keyword screen → recruiter review → phone screen. Internal posts emphasize a "growth mindset" framing around behavioral interviews.

**Bottom line.** Microsoft's three-tier structure (Required / Other Requirements / Preferred) is among the most explicit in industry. The Cloud Background Check "Other Requirement" is a hard government-style gate; basic qualifications gate the recruiter screen; preferred qualifications gate level (IC2 → IC3 → IC4).

---

## 7. Other Major Tech (selected)

- **OpenAI / Anthropic / Stripe / Airbnb / Databricks**: All known **Greenhouse** customers (Greenhouse is the dominant ATS for VC-backed tech). Their postings tend to use prose "What we're looking for / Bonus" structure rather than rigid headers. **Airbnb is also a notable Lever customer historically**.
- **Nvidia**: Uses Workday Recruiting; postings use Minimum/Preferred Qualifications headers.
- **Across this group**: Resume screening remains primarily human; AI screening tools (where present) are surfacing aids, not gates.

---

# PART 3 — SYNTHESIS

## Hard Knockouts vs. Heavily Weighted Scoring

| System | Basic Qualifications Treatment | Preferred Qualifications Treatment |
|---|---|---|
| **Oracle Taleo** | True hard knockout (Required + Disqualification questions) | Asset criteria with optional Weight; Asset count gates ACE star |
| **SAP SuccessFactors** | True hard knockout (Disqualifier questions) | Score+Weight contribute to Rating; Required Score threshold |
| **Workday + HiredScore** | Soft via CSM "Strong/Good/Fair/Low" + hard via knockout questions | Rank/grade input; affects review-queue position |
| **iCIMS** | Soft via Role Fit tier + hard via knockout questions | Determines tier rank |
| **Bullhorn Amplify** | Folded into 0–100 Relevancy Score (soft) | Folded into same score; weightable via custom instructions |
| **Lever / Jobvite (Talent Fit)** | Binary fit-label input | Binary fit-label input + narrative |
| **Greenhouse** | Human checklist + knockout questions only | Human scorecard ratings; AI "Talent Matching" surfacing |
| **Ashby** | Binary "Meets / Does Not Meet" labels | Same binary labels, used for filtering |
| **BambooHR** | Knockout questions + manual recruiter review | Manual recruiter rating |
| **FAANG (Amazon, Google, Microsoft, Meta)** | Recruiter-enforced hard gate at resume screen | Drives leveling and rank within qualified pool |

## Weight Ratio Observed Across Systems

A consistent industry pattern emerges: **basic qualifications act as a binary 0/1 multiplier (you either pass or you don't), and preferred qualifications produce a proportional fractional score**. In Taleo terms, "Required gates entry; Assets fractionally rank." In practice, this means a candidate meeting 100% of basics + 0% of preferreds is *almost always* reviewed before a candidate meeting 80% of basics + 100% of preferreds — the basic check is a logical AND, not a weighted average. Anecdotal recruiter rules-of-thumb on Reddit r/recruiting and LinkedIn posts cite "must hit 100% of basics, then we're flexible on 50–70% of preferreds." Bullhorn's published thresholds (80+ excellent, 50–79 good, 0–49 poor) reinforce this: roughly half of preferred-quality match yields a "Good" classification.

## Recommended Resume Tailoring Strategy

**Treat basic qualifications as a literal checklist.** For each basic qualification:
1. Use the *exact* phrasing or a close synonym recruiters and parsers will recognize (e.g., if the posting says "JavaScript," do not write only "JS"; if it says "3+ years," ensure your titles + dates demonstrably show ≥3 years).
2. Include at least one bullet that quantifiably proves it ("Built [X] in [Language] over [N years]…").
3. Place the most important basics in the top third of page 1 — recruiter scan time is 6–8 seconds.

**Treat preferred qualifications as opportunistic differentiators.** Cover them where genuinely true; never fabricate; reorder bullets so true-preferred matches appear before less-relevant content.

**Don't keyword-stuff.** Modern AI matchers (Workday CSM, iCIMS Role Fit, Bullhorn Relevancy, Greenhouse Talent Matching) use semantic embeddings, and recruiters spot stuffed lists. The CVHive/Resume Optimizer Pro internal data shows tailored resumes typically move from ~38–45% ATS match to ~72–81% — not 100% — and that's enough to clear the queue.

## FAANG-Specific Patterns

- **Amazon**: Strict adherence to "demonstrated experience in X" language for basic quals — Amazon's own resume guide tells you to mirror the basics literally. Preferreds frequently mention specific frameworks (AWS services, distributed systems) that map to team/Org match.
- **Google**: "Equivalent practical experience" language means non-traditional candidates can satisfy basics with portfolio evidence. Hiring Committee scores at 1–4 with 3.5+ pass; preferreds drive the up-leveling argument.
- **Meta**: 5-year minimum for most non-new-grad roles is non-negotiable. E-level placement is heavily influenced by depth in preferred-quals areas (ML systems, scale, etc.).
- **Microsoft**: The "Other Requirements" tier (security clearances, Cloud Background Check) is a third hard category candidates often miss — these are absolute gates beyond the basic/preferred split.
- **Apple**: Decentralized — every team's recruiter applies their own bar. Craft and clean PDFs matter disproportionately.
- **Netflix**: Less keyword-driven, more narrative-and-seniority driven; the Keeper Test is a culture filter applied throughout, not a resume scan.

## Keyword Density, Placement, and Bullet Selection Strategy

- **Keyword density**: Aim for each basic qualification to appear at least 2× in your resume (once in Skills/Summary, once in Experience bullets). Each preferred qualification needs only 1× appearance, and only if true.
- **Placement**: Basic-qual evidence belongs in the top third of page 1. Skills section should mirror the job posting's vocabulary verbatim. Preferred-qual evidence can live deeper.
- **Bullet selection**: For each role, lead with the bullet that hits the most basics; trail with the bullet that hits preferreds. Reorder per application; don't rewrite.
- **Format**: Single-column DOCX or text-based PDF. Avoid tables, headers/footers, graphics, and Canva-saved files. iCIMS in particular drops two-column PDFs to ~67% parse accuracy versus 89% for single-column DOCX (per Resume Optimizer Pro testing).

---

# Recommendations

**Stage 1 — Before applying to any role, identify the ATS** (the job application URL and login flow usually reveal this: workday.com, greenhouse.io, lever.co, myworkdayjobs.com, icims.com subdomains, smartrecruiters.com). This determines whether your resume will be parsed (iCIMS, Workday) or read mostly as-uploaded (Greenhouse, Ashby, Lever).

**Stage 2 — Build a target-aware master resume**:
- Audit it against each basic qualification in the posting; if any basic is not literally addressed in your resume, either (a) add a truthful bullet that addresses it or (b) walk away from the application.
- Add preferred-quals coverage opportunistically; never fabricate.

**Stage 3 — Use knockout-question discipline**: Read every application question carefully before answering. A wrong answer on a knockout question is a hard auto-reject in every ATS in this report. If the posting says "must be authorized to work in the US without sponsorship" and you require sponsorship, that role isn't viable — don't answer falsely.

**Stage 4 — For FAANG specifically**:
- **Amazon**: Mirror "Basic Qualifications" wording literally; layer Leadership Principles language ("customer obsession," "ownership," "bias for action") into bullets.
- **Google/Meta/Microsoft**: Cover every Minimum Qualification with a quantified bullet. Use Preferred Qualifications to argue level.
- **Apple/Netflix**: Tailor narrative; clean formatting matters more than keyword density.

**Stage 5 — Benchmarks that should change your strategy**:
- If you're getting auto-disqualified within minutes of submitting, recheck knockout-question answers — that's the most common cause.
- If you're hearing nothing for 2+ weeks on Workday/iCIMS roles, your CSM/Role Fit tier is likely too low; rework basic-qual coverage or pursue a referral instead.
- If you're getting Greenhouse/Ashby interviews easily but Workday/iCIMS rejections, the issue is parsing — switch to single-column DOCX with no tables.
- If your resume hits 70%+ of basics on a Jobscan/Teal-style match score and you're still not getting traction, the bottleneck is referral or recruiter relationship, not the ATS.

---

# Caveats

- **AI features evolve quickly.** Workday's Illuminate, iCIMS Coalesce AI, Greenhouse Talent Matching, and Lever's AI Companion all launched or were rebranded in 2024–2026; behavior described here may shift quarterly.
- **Vendor language is not neutral.** Every major ATS publicly emphasizes "human-in-the-loop" hiring partly in response to *Mobley v. Workday* (which granted class certification in 2025 and remains pending). Workday explicitly disputes that its tools make hiring decisions; plaintiffs allege the de facto effect is automated rejection. Treat all "we don't auto-reject" claims as legally-positioned statements rather than full operational descriptions.
- **The basic/preferred labels in postings are not always rigorous.** Many companies use "preferred" qualifications recruiters internally treat as required (especially years-of-experience minimums), and vice versa. The recruiter screen call is where this becomes visible.
- **FAANG ATS attribution is partially inferred.** Apple and Meta confirmed in-house systems; Google's exact current ATS stack is mixed (in-house + Avature components) and not officially published. ATS attribution at OpenAI, Anthropic, Stripe, etc., is from their public Greenhouse-hosted application URLs and may shift.
- **Numerical thresholds cited (e.g., Bullhorn's 80/50 traffic-light cutoffs, Google's 3.5/4 hiring committee average, Talent Fit's 0.9 impact ratio)** are vendor- and practitioner-published but not independently audited; they should guide intuition, not precise expectations.
- **The Mobley case is not yet resolved.** A judge granted class certification in May 2025 and ordered Workday to disclose customer lists in August 2025. Any final ruling on liability could materially change how all vendors disclose and operate AI ranking features going forward.
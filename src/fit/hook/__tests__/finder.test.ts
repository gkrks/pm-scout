/**
 * Hook finder tests with mocked Claude and Voyage calls.
 */

import { findHook } from "../finder";
import * as retriever from "../retriever";
import * as synthesizer from "../synthesizer";

// Mock the modules
jest.mock("../retriever");
jest.mock("../synthesizer");

const mockRetrieve = retriever.retrieveCandidatePairs as jest.MockedFunction<typeof retriever.retrieveCandidatePairs>;
const mockSynthesize = synthesizer.synthesizeHooks as jest.MockedFunction<typeof synthesizer.synthesizeHooks>;

const MOCK_INSIGHTS: retriever.Insight[] = [
  {
    id: "ins_1",
    project_id: "searchengine_rust",
    insight_type: "hard_decision",
    text: "Chose proximity scoring (boost=1+k/ω) over strict phrase matching to handle real queries where terms appear near each other but not consecutively.",
    similarity: 0.85,
  },
  {
    id: "ins_2",
    project_id: "filmsearch",
    insight_type: "lesson",
    text: "Multi-zone BM25 scoring with per-zone TF-IDF tables produces better retrieval results than flat embedding similarity alone.",
    similarity: 0.78,
  },
];

const MOCK_INTEL: retriever.IntelChunk[] = [
  {
    id: "intel_1",
    source_url: "https://blog.example.com/progressive-deploy",
    source_type: "eng_blog_rss",
    intel_type: "technical_decision",
    chunk_text: "We rebuilt our deployment pipeline with progressive rollouts and automatic rollback after our Code Orange incident revealed cascading failures.",
    published_at: "2026-04-15T00:00:00Z",
    similarity: 0.82,
  },
  {
    id: "intel_2",
    source_url: "https://blog.example.com/search-revamp",
    source_type: "eng_blog_rss",
    intel_type: "launch",
    chunk_text: "Launched our new hybrid search combining BM25 with vector embeddings to handle complex product queries.",
    published_at: "2026-03-20T00:00:00Z",
    similarity: 0.79,
  },
];

describe("findHook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a strong hook when specificity >= 7", async () => {
    mockRetrieve.mockResolvedValue({
      insights: MOCK_INSIGHTS,
      intel: MOCK_INTEL,
      jdSummary: "Senior PM, Search Platform",
      companyId: "company-123",
      companyName: "ExampleCo",
    });

    mockSynthesize.mockResolvedValue({
      hooks: [
        {
          bridge_text: "I built proximity scoring to solve the same false-match problem your team addressed with progressive deployment gates.",
          insight_id: "ins_1",
          intel_id: "intel_1",
          specificity_score: 8,
          score_rationale: "Both sides reference specific technical decisions — proximity scoring and Code Orange — that aren't resume-inferable.",
        },
        {
          bridge_text: "My multi-zone BM25 implementation mirrors the hybrid search architecture you just shipped.",
          insight_id: "ins_2",
          intel_id: "intel_2",
          specificity_score: 7,
          score_rationale: "Specific technique match but BM25 is somewhat visible from resume.",
        },
      ],
      inputTokens: 5000,
      outputTokens: 500,
    });

    const result = await findHook("job-123");

    expect(result.skip).toBe(false);
    if (!result.skip) {
      expect(result.primary.specificity_score).toBe(8);
      expect(result.primary.bridge_text).toContain("proximity scoring");
      expect(result.alternates).toHaveLength(1);
    }
  });

  it("returns skip=true when best hook scores below threshold", async () => {
    mockRetrieve.mockResolvedValue({
      insights: MOCK_INSIGHTS,
      intel: MOCK_INTEL,
      jdSummary: "Generic PM role",
      companyId: "company-456",
      companyName: "GenericCorp",
    });

    mockSynthesize.mockResolvedValue({
      hooks: [
        {
          bridge_text: "I have experience building search systems that could benefit your team.",
          insight_id: "ins_1",
          intel_id: "intel_1",
          specificity_score: 4,
          score_rationale: "Generic connection — could apply to any search company.",
        },
      ],
      inputTokens: 4000,
      outputTokens: 300,
    });

    const result = await findHook("job-456");

    expect(result.skip).toBe(true);
    if (result.skip) {
      expect(result.reason).toContain("4/10");
      expect(result.runnerUp).not.toBeNull();
      expect(result.runnerUp?.specificity_score).toBe(4);
    }
  });

  it("returns skip=true when no intel exists for the company", async () => {
    mockRetrieve.mockResolvedValue({
      insights: MOCK_INSIGHTS,
      intel: [],
      jdSummary: "PM at NewStartup",
      companyId: "company-789",
      companyName: "NewStartup",
    });

    const result = await findHook("job-789");

    expect(result.skip).toBe(true);
    if (result.skip) {
      expect(result.reason).toContain("No company intel");
      expect(result.reason).toContain("NewStartup");
    }
    // Synthesizer should NOT have been called
    expect(mockSynthesize).not.toHaveBeenCalled();
  });
});

import { slug, resumeBasename } from "../slug";

describe("slug", () => {
  it("lowercases and replaces non-alphanum", () => {
    expect(slug("Hello World")).toBe("hello_world");
  });

  it("handles AT&T", () => {
    expect(slug("AT&T")).toBe("at_t");
  });

  it("handles L'Oreal with accent", () => {
    expect(slug("L'Or\u00e9al")).toBe("l_oreal");
  });

  it("trims leading/trailing underscores from spaces", () => {
    expect(slug("  Spaces  ")).toBe("spaces");
  });

  it("handles parentheses", () => {
    expect(slug("Google (Alphabet)")).toBe("google_alphabet");
  });

  it("handles em dash", () => {
    expect(slug("Sr. PM \u2014 Platform")).toBe("sr_pm_platform");
  });

  it("strips emojis", () => {
    expect(slug("\uD83D\uDE80 RocketCo")).toBe("rocketco");
  });

  it("returns empty for empty string", () => {
    expect(slug("")).toBe("");
  });

  it("returns empty for only special chars", () => {
    expect(slug("---")).toBe("");
  });

  it("handles multiple consecutive special chars", () => {
    expect(slug("a!!!b")).toBe("a_b");
  });

  it("handles unicode NFKD decomposition", () => {
    // fi ligature (U+FB01) decomposes to "fi" under NFKD
    expect(slug("\uFB01nance")).toBe("finance");
  });
});

describe("resumeBasename", () => {
  it("builds correct format", () => {
    expect(
      resumeBasename("Acme Corp", "Product Manager", "abc-123-uuid")
    ).toBe("Krithik_Gopinath_acme_corp_product_manager_abc-123-uuid");
  });

  it("does not slugify jobId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const result = resumeBasename("Google", "PM", uuid);
    expect(result).toContain(uuid);
  });

  it("handles adversarial company names", () => {
    expect(
      resumeBasename("AT&T", "Sr. PM \u2014 Platform", "id1")
    ).toBe("Krithik_Gopinath_at_t_sr_pm_platform_id1");
  });

  it("falls back to unknown for empty slug", () => {
    expect(
      resumeBasename("---", "PM", "id1")
    ).toBe("Krithik_Gopinath_unknown_pm_id1");
  });
});

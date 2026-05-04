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
  it("builds correct format without jobId", () => {
    expect(
      resumeBasename("Acme Corp", "Product Manager")
    ).toBe("Krithik_Gopinath_acme_corp_product_manager");
  });

  it("handles adversarial company names", () => {
    expect(
      resumeBasename("AT&T", "Sr. PM \u2014 Platform")
    ).toBe("Krithik_Gopinath_at_t_sr_pm_platform");
  });

  it("falls back to unknown for empty slug", () => {
    expect(
      resumeBasename("---", "PM")
    ).toBe("Krithik_Gopinath_unknown_pm");
  });

  it("produces clean name for real company", () => {
    expect(
      resumeBasename("Fireworks AI", "Associate Product Manager")
    ).toBe("Krithik_Gopinath_fireworks_ai_associate_product_manager");
  });
});

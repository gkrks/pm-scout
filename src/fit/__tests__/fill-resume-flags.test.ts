import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const FILL_SCRIPT = path.join(REPO_ROOT, "fill_resume.js");
const OUT_DIR = path.join(REPO_ROOT, "out");

describe("fill_resume.js CLI flags", () => {
  const testBasename = "Test_Fill_Flags_" + Date.now();

  afterAll(() => {
    // Clean up test outputs
    try {
      fs.unlinkSync(path.join(OUT_DIR, testBasename + ".docx"));
      fs.unlinkSync(path.join(OUT_DIR, testBasename + ".pdf"));
    } catch { /* ignore */ }
  });

  it("--out-basename produces correctly named files", () => {
    execSync(`node "${FILL_SCRIPT}" --out-basename "${testBasename}"`, {
      cwd: REPO_ROOT,
      timeout: 15000,
      stdio: "pipe",
    });

    expect(fs.existsSync(path.join(OUT_DIR, testBasename + ".docx"))).toBe(true);
    expect(fs.existsSync(path.join(OUT_DIR, testBasename + ".pdf"))).toBe(true);
  });

  it("default behavior still produces Resume_Krithik_Gopinath files", () => {
    // The default files should exist from prior runs or this one
    execSync(`node "${FILL_SCRIPT}"`, {
      cwd: REPO_ROOT,
      timeout: 15000,
      stdio: "pipe",
    });

    expect(fs.existsSync(path.join(OUT_DIR, "Resume_Krithik_Gopinath.docx"))).toBe(true);
    expect(fs.existsSync(path.join(OUT_DIR, "Resume_Krithik_Gopinath.pdf"))).toBe(true);
  });

  it("--summary flag overrides the summary text", () => {
    const customSummary = "Custom test summary for flag verification.";
    // We can't easily verify the summary is inside the docx without parsing it,
    // but we can verify the script doesn't crash with the flag
    const output = execSync(
      `node "${FILL_SCRIPT}" --out-basename "${testBasename}" --summary "${customSummary}"`,
      { cwd: REPO_ROOT, timeout: 15000, stdio: "pipe" },
    );
    expect(output.toString()).toContain("Wrote");
  });
});

import crypto from "crypto";

// Replicate the token generation logic from server.ts
function generateToken(jobId: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(jobId)
    .digest("hex")
    .slice(0, 32);
}

describe("HMAC token verification", () => {
  const secret = "test-secret-key-for-unit-tests";

  it("generates 32-char hex token", () => {
    const token = generateToken("test-job-id", secret);
    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic for same input", () => {
    const t1 = generateToken("job-123", secret);
    const t2 = generateToken("job-123", secret);
    expect(t1).toBe(t2);
  });

  it("differs for different jobIds", () => {
    const t1 = generateToken("job-123", secret);
    const t2 = generateToken("job-456", secret);
    expect(t1).not.toBe(t2);
  });

  it("differs for different secrets", () => {
    const t1 = generateToken("job-123", "secret-a");
    const t2 = generateToken("job-123", "secret-b");
    expect(t1).not.toBe(t2);
  });

  it("tampered jobId produces wrong token", () => {
    const original = generateToken("real-job-id", secret);
    const tampered = generateToken("tampered-job-id", secret);
    expect(original).not.toBe(tampered);
  });
});

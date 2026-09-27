import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnv = {
  CHERWELL_BASE_URL: "https://csm.example.com",
  CHERWELL_CLIENT_ID: "api-key",
  CHERWELL_USERNAME: "user",
  CHERWELL_PASSWORD: "secret",
};

describe("loadConfig", () => {
  it("parses a fully specified environment", () => {
    const config = loadConfig({
      ...validEnv,
      CHERWELL_AUTH_MODE: "ldap",
      CHERWELL_TIMEOUT_MS: "5000",
    });

    expect(config).toEqual({
      baseUrl: "https://csm.example.com",
      clientId: "api-key",
      username: "user",
      password: "secret",
      authMode: "ldap",
      timeoutMs: 5000,
    });
  });

  it("strips trailing slashes from the base URL", () => {
    const config = loadConfig({ ...validEnv, CHERWELL_BASE_URL: "https://csm.example.com///" });
    expect(config.baseUrl).toBe("https://csm.example.com");
  });

  it("applies defaults for auth mode and timeout", () => {
    const config = loadConfig(validEnv);
    expect(config.authMode).toBe("internal");
    expect(config.timeoutMs).toBe(30_000);
  });

  it("lists every missing required variable", () => {
    expect(() => loadConfig({})).toThrow(
      /CHERWELL_BASE_URL, CHERWELL_CLIENT_ID, CHERWELL_USERNAME, CHERWELL_PASSWORD/
    );
  });

  it("lists only the variables that are actually missing", () => {
    const error = getError(() => loadConfig({ CHERWELL_BASE_URL: "https://x" }));
    expect(error.message).toContain("CHERWELL_CLIENT_ID");
    expect(error.message).toContain("CHERWELL_USERNAME");
    expect(error.message).toContain("CHERWELL_PASSWORD");
    expect(error.message).not.toMatch(/variable\(s\): [^.]*CHERWELL_BASE_URL/);
  });

  it("treats whitespace-only values as missing", () => {
    expect(() => loadConfig({ ...validEnv, CHERWELL_USERNAME: "   " })).toThrow(/CHERWELL_USERNAME/);
  });

  it("accepts auth mode case-insensitively", () => {
    const config = loadConfig({ ...validEnv, CHERWELL_AUTH_MODE: "LDAP" });
    expect(config.authMode).toBe("ldap");
  });

  it("rejects an unknown auth mode", () => {
    expect(() => loadConfig({ ...validEnv, CHERWELL_AUTH_MODE: "kerberos" })).toThrow(
      /Invalid CHERWELL_AUTH_MODE/
    );
  });

  it("rejects a non-numeric or non-positive timeout", () => {
    expect(() => loadConfig({ ...validEnv, CHERWELL_TIMEOUT_MS: "abc" })).toThrow(/CHERWELL_TIMEOUT_MS/);
    expect(() => loadConfig({ ...validEnv, CHERWELL_TIMEOUT_MS: "-5" })).toThrow(/CHERWELL_TIMEOUT_MS/);
    expect(() => loadConfig({ ...validEnv, CHERWELL_TIMEOUT_MS: "0" })).toThrow(/CHERWELL_TIMEOUT_MS/);
  });
});

function getError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the function to throw");
}

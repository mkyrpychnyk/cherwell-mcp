import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenManager } from "../src/auth.js";
import { CherwellAuthError } from "../src/errors.js";
import { FetchMock, testConfig, tokenResponse } from "./helpers/mock-fetch.js";

describe("TokenManager", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = new FetchMock().install();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a password-grant login request with auth mode and api key in the URL", async () => {
    fetchMock.queueToken("tok-a");
    const manager = new TokenManager(testConfig());

    const token = await manager.getAccessToken();

    expect(token).toBe("tok-a");
    const request = fetchMock.last();
    expect(request.url).toBe("https://csm.example.com/CherwellAPI/token?auth_mode=internal&api_key=api-key");
    expect(request.method).toBe("POST");
    expect(request.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(request.body).toBe("grant_type=password&client_id=api-key&username=user&password=secret");
  });

  it("caches the token across calls", async () => {
    fetchMock.queueToken();
    const manager = new TokenManager(testConfig());

    await manager.getAccessToken();
    await manager.getAccessToken();

    expect(fetchMock.requests).toHaveLength(1);
  });

  it("re-logs in when the token expires within the 10-minute buffer", async () => {
    // 5 minutes of validity is inside the 10-minute buffer, so it is expired on arrival.
    fetchMock.queueToken("short-lived", 300);
    fetchMock.queueToken("fresh", 1200);
    const manager = new TokenManager(testConfig());

    await manager.getAccessToken();
    const second = await manager.getAccessToken();

    expect(second).toBe("fresh");
    expect(fetchMock.requests).toHaveLength(2);
  });

  it("parses the .expires timestamp when present", async () => {
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMock.queueJson(tokenResponse({ access_token: "tok-e", ".expires": inOneHour, expires_in: undefined }));
    const manager = new TokenManager(testConfig());

    await manager.getAccessToken();
    await manager.getAccessToken();

    expect(fetchMock.requests).toHaveLength(1);
  });

  it("collapses concurrent logins into a single request", async () => {
    fetchMock.queueToken();
    const manager = new TokenManager(testConfig());

    const [a, b] = await Promise.all([manager.getAccessToken(), manager.getAccessToken()]);

    expect(a).toBe(b);
    expect(fetchMock.requests).toHaveLength(1);
  });

  it("logs in again after invalidate()", async () => {
    fetchMock.queueToken("tok-1");
    fetchMock.queueToken("tok-2");
    const manager = new TokenManager(testConfig());

    await manager.getAccessToken();
    manager.invalidate();
    const token = await manager.getAccessToken();

    expect(token).toBe("tok-2");
    expect(fetchMock.requests).toHaveLength(2);
  });

  it("surfaces the server's error_description on a failed login", async () => {
    fetchMock.queueJson({ error: "invalid_grant", error_description: "BADREQUEST: wrong password" }, 400);
    const manager = new TokenManager(testConfig());

    const error = await manager.getAccessToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CherwellAuthError);
    expect((error as Error).message).toContain("wrong password");
    expect((error as Error).message).toContain("CHERWELL_CLIENT_ID");
  });

  it("rejects a login response without an access_token", async () => {
    fetchMock.queueJson({});
    const manager = new TokenManager(testConfig());

    await expect(manager.getAccessToken()).rejects.toThrow(/did not contain an access_token/);
  });

  it("wraps network failures with a hint about the base URL", async () => {
    fetchMock.queueError(new TypeError("fetch failed"));
    const manager = new TokenManager(testConfig());

    await expect(manager.getAccessToken()).rejects.toThrow(/Could not reach the Cherwell token endpoint/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenManager } from "../src/auth.js";
import { CherwellClient } from "../src/client.js";
import { CherwellApiError } from "../src/errors.js";
import { FetchMock, testConfig } from "./helpers/mock-fetch.js";

describe("CherwellClient", () => {
  let fetchMock: FetchMock;
  let client: CherwellClient;

  beforeEach(() => {
    fetchMock = new FetchMock().install();
    const config = testConfig();
    client = new CherwellClient(config, new TokenManager(config));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and builds CherwellAPI-relative URLs", async () => {
    fetchMock.queueToken("tok-a");
    fetchMock.queueJson({ ok: true });

    const result = await client.request<{ ok: boolean }>("api/V1/getteams");

    expect(result).toEqual({ ok: true });
    const request = fetchMock.last();
    expect(request.url).toBe("https://csm.example.com/CherwellAPI/api/V1/getteams");
    expect(request.headers.Authorization).toBe("Bearer tok-a");
  });

  it("serializes POST bodies as JSON", async () => {
    fetchMock.queueToken();
    fetchMock.queueJson({});

    await client.request("api/V1/savebusinessobject", { method: "POST", body: { busObId: "x" } });

    const request = fetchMock.last();
    expect(request.method).toBe("POST");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(request.body).toBe('{"busObId":"x"}');
  });

  it("invalidates the token and retries exactly once on a 401", async () => {
    fetchMock.queueToken("stale");
    fetchMock.queueText("unauthorized", 401);
    fetchMock.queueToken("fresh");
    fetchMock.queueJson({ recovered: true });

    const result = await client.request<{ recovered: boolean }>("api/V1/getteams");

    expect(result).toEqual({ recovered: true });
    expect(fetchMock.requests).toHaveLength(4);
    expect(fetchMock.last().headers.Authorization).toBe("Bearer fresh");
  });

  it("does not loop on a second consecutive 401", async () => {
    fetchMock.queueToken("t1");
    fetchMock.queueText("nope", 401);
    fetchMock.queueToken("t2");
    fetchMock.queueText("still nope", 401);

    const error = await client.request("api/V1/getteams").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CherwellApiError);
    expect((error as CherwellApiError).status).toBe(401);
    expect(fetchMock.requests).toHaveLength(4);
  });

  it("throws CherwellApiError with status and body on a non-2xx response", async () => {
    fetchMock.queueToken();
    fetchMock.queueText("kaboom", 500);

    const error = await client.request("api/V1/getteams").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CherwellApiError);
    expect((error as CherwellApiError).status).toBe(500);
    expect((error as Error).message).toContain("kaboom");
  });

  it("surfaces Cherwell in-band errors from 200 responses", async () => {
    fetchMock.queueToken();
    fetchMock.queueJson({ hasError: true, errorMessage: "Record not found", errorCode: "RECORDNOTFOUND" });

    const error = await client.request("api/V1/getteams").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CherwellApiError);
    expect((error as Error).message).toContain("Record not found");
    expect((error as CherwellApiError).errorCode).toBe("RECORDNOTFOUND");
  });

  it("does not flag responses where hasError is false", async () => {
    fetchMock.queueToken();
    fetchMock.queueJson({ hasError: false, errorMessage: null, totalRows: 0 });

    await expect(client.request("api/V1/getsearchresults")).resolves.toMatchObject({ totalRows: 0 });
  });

  it("returns an empty object for an empty response body", async () => {
    fetchMock.queueToken();
    fetchMock.queueText("");

    await expect(client.request("api/V1/x")).resolves.toEqual({});
  });
});

import { vi } from "vitest";
import type { CherwellConfig } from "../../src/config.js";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

type QueuedResponse =
  | { kind: "response"; status: number; text: string }
  | { kind: "error"; error: Error };

/** Replaces global fetch: returns queued responses in order and records every request. */
export class FetchMock {
  readonly requests: RecordedRequest[] = [];
  private readonly queue: QueuedResponse[] = [];

  install(): this {
    vi.stubGlobal("fetch", this.handler);
    return this;
  }

  queueJson(json: unknown, status = 200): this {
    this.queue.push({ kind: "response", status, text: JSON.stringify(json) });
    return this;
  }

  queueText(text: string, status = 200): this {
    this.queue.push({ kind: "response", status, text });
    return this;
  }

  queueError(error: Error): this {
    this.queue.push({ kind: "error", error });
    return this;
  }

  /** Queue a successful token response so the next request can authenticate. */
  queueToken(accessToken = "tok-1", expiresInSeconds = 1200): this {
    return this.queueJson(tokenResponse({ access_token: accessToken, expires_in: expiresInSeconds }));
  }

  last(): RecordedRequest {
    if (this.requests.length === 0) {
      throw new Error("FetchMock: no requests recorded");
    }
    return this.requests[this.requests.length - 1];
  }

  private handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    let body: string | null = null;
    if (init?.body !== undefined && init.body !== null) {
      body = init.body instanceof URLSearchParams ? init.body.toString() : String(init.body);
    }
    this.requests.push({
      url,
      method: init?.method ?? "GET",
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      body,
    });

    const next = this.queue.shift();
    if (!next) {
      throw new Error(`FetchMock: no queued response for ${init?.method ?? "GET"} ${url}`);
    }
    if (next.kind === "error") {
      throw next.error;
    }
    return new Response(next.text, { status: next.status });
  };
}

export function tokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: "tok-1",
    refresh_token: "refresh-1",
    expires_in: 1200,
    ...overrides,
  };
}

export function testConfig(overrides: Partial<CherwellConfig> = {}): CherwellConfig {
  return {
    baseUrl: "https://csm.example.com",
    clientId: "api-key",
    username: "user",
    password: "secret",
    authMode: "internal",
    timeoutMs: 5000,
    ...overrides,
  };
}

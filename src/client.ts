import type { CherwellConfig } from "./config.js";
import type { TokenManager } from "./auth.js";
import { CherwellApiError } from "./errors.js";

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
}

/**
 * HTTP layer for the Cherwell REST API: injects the bearer token and, on a 401,
 * invalidates the cached token and retries exactly once (mirrors the .NET
 * CherwellApiRequestExecutor behavior).
 */
export class CherwellClient {
  constructor(
    private readonly config: CherwellConfig,
    private readonly tokens: TokenManager
  ) {}

  /** Execute a request against a CherwellAPI-relative path, e.g. "api/V1/savebusinessobject". */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    let response = await this.send(path, options);

    if (response.status === 401) {
      this.tokens.invalidate();
      response = await this.send(path, options);
    }

    const url = this.buildUrl(path);
    const text = await response.text();

    if (!response.ok) {
      throw new CherwellApiError(
        `Cherwell API request failed (HTTP ${response.status} ${response.statusText}) for ${url}: ${truncate(text, 500)}`,
        response.status,
        undefined,
        url
      );
    }

    const result = (text ? JSON.parse(text) : {}) as T;
    assertNoInBandError(result, url);
    return result;
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const token = await this.tokens.getAccessToken();
    const url = this.buildUrl(path);

    try {
      return await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new CherwellApiError(
        `Request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        undefined,
        url
      );
    }
  }

  private buildUrl(path: string): string {
    return `${this.config.baseUrl}/CherwellAPI/${path}`;
  }
}

/** Cherwell reports many failures in-band: HTTP 200 with hasError/errorMessage set. */
function assertNoInBandError(result: unknown, url: string): void {
  if (result && typeof result === "object" && "hasError" in result) {
    const { hasError, errorMessage, errorCode } = result as {
      hasError?: boolean;
      errorMessage?: string | null;
      errorCode?: string | null;
    };
    if (hasError) {
      throw new CherwellApiError(
        `Cherwell API returned an error for ${url}: ${errorMessage || "unknown error"}${errorCode ? ` (code ${errorCode})` : ""}`,
        undefined,
        errorCode ?? undefined,
        url
      );
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

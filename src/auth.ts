import type { CherwellConfig } from "./config.js";
import { CherwellAuthError } from "./errors.js";

interface TokenState {
  accessToken: string;
  /** Epoch ms after which the token is treated as expired. */
  expiresAt: number;
}

/** Treat tokens as expired this long before they actually are (same buffer as the .NET client). */
const EXPIRY_BUFFER_MS = 10 * 60 * 1000;

/**
 * Owns the Cherwell OAuth password-grant token: caches it, refreshes ahead of expiry,
 * and collapses concurrent logins into a single request.
 */
export class TokenManager {
  private state: TokenState | null = null;
  private pendingLogin: Promise<TokenState> | null = null;

  constructor(private readonly config: CherwellConfig) {}

  async getAccessToken(): Promise<string> {
    if (this.state && this.state.expiresAt > Date.now()) {
      return this.state.accessToken;
    }
    if (!this.pendingLogin) {
      this.pendingLogin = this.login().finally(() => {
        this.pendingLogin = null;
      });
    }
    this.state = await this.pendingLogin;
    return this.state.accessToken;
  }

  /** Drop the cached token so the next request logs in again (used on 401 responses). */
  invalidate(): void {
    this.state = null;
  }

  private async login(): Promise<TokenState> {
    const { baseUrl, clientId, username, password, authMode, timeoutMs } = this.config;

    const url = `${baseUrl}/CherwellAPI/token?auth_mode=${encodeURIComponent(authMode)}&api_key=${encodeURIComponent(clientId)}`;

    const body = new URLSearchParams({
      grant_type: "password",
      client_id: clientId,
      username,
      password,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new CherwellAuthError(
        `Could not reach the Cherwell token endpoint at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const text = await response.text();

    if (!response.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error_description?: string; error?: string };
        detail = parsed.error_description ?? parsed.error ?? text;
      } catch {
        // non-JSON error body — use raw text
      }
      throw new CherwellAuthError(
        `Cherwell login failed (HTTP ${response.status}): ${detail || response.statusText}. ` +
          `Check CHERWELL_CLIENT_ID, CHERWELL_USERNAME, CHERWELL_PASSWORD and CHERWELL_AUTH_MODE.`,
        response.status
      );
    }

    const data = JSON.parse(text) as {
      access_token?: string;
      expires_in?: number;
      ".expires"?: string;
    };

    if (!data.access_token) {
      throw new CherwellAuthError("Cherwell login response did not contain an access_token.");
    }

    const expiresAtRaw = data[".expires"]
      ? Date.parse(data[".expires"])
      : Date.now() + (data.expires_in ?? 1200) * 1000;

    return {
      accessToken: data.access_token,
      expiresAt: expiresAtRaw - EXPIRY_BUFFER_MS,
    };
  }
}

export type AuthMode = "internal" | "windows" | "ldap" | "saml";

export interface CherwellConfig {
  /** CSM host root, e.g. https://csm.example.com — CherwellAPI/... paths are appended. */
  baseUrl: string;
  /** REST API client key generated in CSM Administrator. */
  clientId: string;
  username: string;
  password: string;
  authMode: AuthMode;
  timeoutMs: number;
}

const REQUIRED_VARS = [
  "CHERWELL_BASE_URL",
  "CHERWELL_CLIENT_ID",
  "CHERWELL_USERNAME",
  "CHERWELL_PASSWORD",
] as const;

const AUTH_MODES: readonly AuthMode[] = ["internal", "windows", "ldap", "saml"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CherwellConfig {
  const missing = REQUIRED_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}.\n` +
        `cherwell-mcp is configured entirely via environment variables:\n` +
        `  CHERWELL_BASE_URL   CSM host root, e.g. https://csm.example.com\n` +
        `  CHERWELL_CLIENT_ID  REST API client key from CSM Administrator\n` +
        `  CHERWELL_USERNAME   Cherwell user login\n` +
        `  CHERWELL_PASSWORD   Cherwell user password\n` +
        `  CHERWELL_AUTH_MODE  optional: internal (default), windows, ldap, saml\n` +
        `  CHERWELL_TIMEOUT_MS optional: per-request timeout, default 30000`
    );
  }

  const authMode = (env.CHERWELL_AUTH_MODE?.trim().toLowerCase() || "internal") as AuthMode;
  if (!AUTH_MODES.includes(authMode)) {
    throw new Error(
      `Invalid CHERWELL_AUTH_MODE "${env.CHERWELL_AUTH_MODE}". Expected one of: ${AUTH_MODES.join(", ")}.`
    );
  }

  const timeoutMs = env.CHERWELL_TIMEOUT_MS ? Number(env.CHERWELL_TIMEOUT_MS) : 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid CHERWELL_TIMEOUT_MS "${env.CHERWELL_TIMEOUT_MS}". Expected a positive number.`);
  }

  return {
    baseUrl: env.CHERWELL_BASE_URL!.trim().replace(/\/+$/, ""),
    clientId: env.CHERWELL_CLIENT_ID!.trim(),
    username: env.CHERWELL_USERNAME!.trim(),
    password: env.CHERWELL_PASSWORD!,
    authMode,
    timeoutMs,
  };
}

export type RuntimeEnvironment = Record<string, string | undefined>;

export type CanonicalEnvironmentName =
  | "APP_ENV"
  | "NODE_ENV"
  | "NEXT_PUBLIC_SITE_URL"
  | "SUPABASE_URL"
  | "SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "EMBEDDING_API_URL"
  | "EMBEDDING_API_KEY"
  | "EMBEDDING_MODEL"
  | "EMBEDDING_TIMEOUT_SECONDS"
  | "REMOTE_AI_BASE_URL"
  | "REMOTE_AI_API_KEY"
  | "REMOTE_AI_DEFAULT_MODEL"
  | "REMOTE_AI_REASONING_MODEL"
  | "REMOTE_AI_FALLBACK_MODEL"
  | "RECOMMENDATION_API_URL"
  | "RECOMMENDATION_API_KEY"
  | "WORKER_API_URL"
  | "WORKER_API_KEY"
  | "TMDB_API_KEY";

export const PUBLIC_ENVIRONMENT_NAMES = [
  "NEXT_PUBLIC_SITE_URL",
] as const satisfies readonly CanonicalEnvironmentName[];

export const SERVER_ONLY_ENVIRONMENT_NAMES = [
  "APP_ENV",
  "NODE_ENV",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EMBEDDING_API_URL",
  "EMBEDDING_API_KEY",
  "EMBEDDING_MODEL",
  "EMBEDDING_TIMEOUT_SECONDS",
  "REMOTE_AI_BASE_URL",
  "REMOTE_AI_API_KEY",
  "REMOTE_AI_DEFAULT_MODEL",
  "REMOTE_AI_REASONING_MODEL",
  "REMOTE_AI_FALLBACK_MODEL",
  "RECOMMENDATION_API_URL",
  "RECOMMENDATION_API_KEY",
  "WORKER_API_URL",
  "WORKER_API_KEY",
  "TMDB_API_KEY",
] as const satisfies readonly CanonicalEnvironmentName[];

// Optional server integrations and SUPABASE_SERVICE_ROLE_KEY are intentionally
// excluded from the Vercel web application's required startup contract.
export const APPLICATION_ENVIRONMENT_NAMES: readonly CanonicalEnvironmentName[] = [
  ...PUBLIC_ENVIRONMENT_NAMES,
  "APP_ENV",
  "NODE_ENV",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "EMBEDDING_API_URL",
  "EMBEDDING_API_KEY",
  "EMBEDDING_MODEL",
  "REMOTE_AI_BASE_URL",
  "REMOTE_AI_API_KEY",
  "REMOTE_AI_DEFAULT_MODEL",
  "REMOTE_AI_REASONING_MODEL",
  "REMOTE_AI_FALLBACK_MODEL",
  "RECOMMENDATION_API_URL",
  "RECOMMENDATION_API_KEY",
];

export class EnvironmentValidationError extends Error {
  constructor(public readonly variableName: string) {
    super(`Missing required environment variable: ${variableName}`);
    this.name = "EnvironmentValidationError";
  }
}

export function readRuntimeEnv(): RuntimeEnvironment {
  if (typeof process === "undefined" || !process.env) return {};
  return process.env as RuntimeEnvironment;
}

export function getEnvironmentValue(
  name: string,
  environment: RuntimeEnvironment = readRuntimeEnv(),
): string {
  return (environment[name] ?? "").trim();
}

export function requireEnvironmentValue(
  name: string,
  environment: RuntimeEnvironment = readRuntimeEnv(),
): string {
  const value = getEnvironmentValue(name, environment);
  if (!value) throw new EnvironmentValidationError(name);
  return value;
}

export function validateEnvironment(
  names: readonly string[],
  environment: RuntimeEnvironment = readRuntimeEnv(),
): { valid: boolean; missing: string[]; errors: string[] } {
  const missing = names.filter((name) => !getEnvironmentValue(name, environment));
  return {
    valid: missing.length === 0,
    missing,
    errors: missing.map((name) => `Missing required environment variable: ${name}`),
  };
}

export type AppEnvironment = "local" | "test" | "production";

export function getAppEnvironment(
  environment: RuntimeEnvironment = readRuntimeEnv(),
): AppEnvironment {
  const configured = getEnvironmentValue("APP_ENV", environment).toLowerCase();
  if (configured === "local" || configured === "test" || configured === "production") {
    return configured;
  }
  const nodeEnvironment = getEnvironmentValue("NODE_ENV", environment).toLowerCase();
  if (nodeEnvironment === "test") return "test";
  if (nodeEnvironment === "production") return "production";
  return "local";
}

export function isLocalServiceUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (["localhost", "0.0.0.0", "::1"].includes(hostname)) return true;
    if (hostname === "127.0.0.1" || hostname.startsWith("127.")) return true;
    if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return true;
    const match = hostname.match(/^172\.(\d{1,3})\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch {
    return false;
  }
}

export function validateProductionServiceUrls(
  names: readonly string[],
  environment: RuntimeEnvironment = readRuntimeEnv(),
): string[] {
  if (getAppEnvironment(environment) !== "production") return [];
  return names.flatMap((name) => {
    const value = getEnvironmentValue(name, environment);
    if (!value) return [];
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return [`${name} must use HTTPS in production`];
      if (isLocalServiceUrl(value)) return [`${name} must not use a local address in production`];
      return [];
    } catch {
      return [`${name} must be a valid URL`];
    }
  });
}

export function safeEnvironmentSummary(
  names: readonly string[],
  environment: RuntimeEnvironment = readRuntimeEnv(),
): Record<string, "configured" | "missing"> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      getEnvironmentValue(name, environment) ? "configured" : "missing",
    ]),
  );
}

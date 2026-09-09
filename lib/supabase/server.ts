import type { SupabaseConfig } from "./config";
import { getEnvironmentValue } from "@/lib/env";

const ACCESS_COOKIE = "nexaplay_access_token";
const REFRESH_COOKIE = "nexaplay_refresh_token";

export type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

export type SupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: SupabaseUser;
};

type CookieWriter = Pick<Response, "headers">;

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const segment of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...parts] = segment.trim().split("=");
    if (name) cookies.set(name, decodeURIComponent(parts.join("=")));
  }
  return cookies;
}

export function accessToken(request: Request): string | null {
  return parseCookies(request).get(ACCESS_COOKIE) ?? null;
}

export async function authFetch(
  config: SupabaseConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (!config.isConfigured) {
    return Response.json(
      { error: "Supabase Auth is not configured" },
      { status: 503 },
    );
  }
  return fetch(`${config.url}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

export function appendSessionCookies(response: CookieWriter, session: SupabaseSession): void {
  const secure = getEnvironmentValue("NODE_ENV") === "production" ? "; Secure" : "";
  const maxAge = Math.max(session.expires_in ?? 3600, 60);
  response.headers.append(
    "set-cookie",
    `${ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
  response.headers.append(
    "set-cookie",
    `${REFRESH_COOKIE}=${encodeURIComponent(session.refresh_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
  );
}

export function sessionResponse(
  session: SupabaseSession,
  body: unknown = { user: session.user ?? null },
): Response {
  const response = Response.json(body);
  appendSessionCookies(response, session);
  return response;
}

export function clearSessionResponse(request?: Request): Response {
  const response = Response.json({ success: true });
  response.headers.append(
    "set-cookie",
    `${ACCESS_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  response.headers.append(
    "set-cookie",
    `${REFRESH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  if (request) {
    for (const name of parseCookies(request).keys()) {
      if (name.startsWith("sb-") && (name.includes("auth-token") || name.includes("code-verifier"))) {
        response.headers.append("set-cookie", `${name}=; Path=/; SameSite=Lax; Max-Age=0`);
      }
    }
  }
  return response;
}

export async function getSupabaseUser(
  request: Request,
  config: SupabaseConfig,
): Promise<SupabaseUser | null> {
  const token = accessToken(request);
  if (!token || !config.isConfigured) return null;
  const response = await authFetch(config, "user", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return (await response.json()) as SupabaseUser;
}

export async function requireSupabaseUser(
  request: Request,
  config: SupabaseConfig,
): Promise<{ user: SupabaseUser; token: string } | null> {
  const user = await getSupabaseUser(request, config);
  const token = accessToken(request);
  return user && token ? { user, token } : null;
}

export async function restFetch(
  config: SupabaseConfig,
  token: string,
  resource: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${config.url}/rest/v1/${resource}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

export async function ensureIdentityProfile(
  config: SupabaseConfig,
  session: SupabaseSession,
): Promise<void> {
  if (!session.user?.id || !session.access_token) return;
  const metadata = session.user.user_metadata ?? {};
  const fullName = metadata.full_name ?? metadata.name ?? metadata.username;
  const avatarUrl = metadata.avatar_url ?? metadata.picture;
  await restFetch(config, session.access_token, "profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: session.user.id,
      email: session.user.email ?? null,
      full_name: typeof fullName === "string" ? fullName : null,
      avatar_url: typeof avatarUrl === "string" ? avatarUrl : null,
    }),
  });
}

export async function onboardingDestination(
  config: SupabaseConfig,
  session: SupabaseSession,
  completedDestination = "/dashboard",
): Promise<string> {
  if (!session.user?.id || !session.access_token) return "/onboarding";
  const query = new URLSearchParams({
    select: "onboarding_completed",
    user_id: `eq.${session.user.id}`,
    limit: "1",
  });
  const response = await restFetch(
    config,
    session.access_token,
    `user_preferences?${query}`,
  );
  if (!response.ok) return "/onboarding";
  const rows = (await response.json()) as Array<{ onboarding_completed?: boolean }>;
  if (rows[0]?.onboarding_completed) return completedDestination;
  if (rows.length === 0) {
    const legacyQuery = new URLSearchParams({
      select: "onboarding_completed",
      id: `eq.${session.user.id}`,
      limit: "1",
    });
    const legacyResponse = await restFetch(
      config,
      session.access_token,
      `user_profiles?${legacyQuery}`,
    );
    if (legacyResponse.ok) {
      const legacyRows = (await legacyResponse.json()) as Array<{ onboarding_completed?: boolean }>;
      if (legacyRows[0]?.onboarding_completed) return completedDestination;
    }
  }
  return "/onboarding";
}

export async function resolveContentId(
  config: SupabaseConfig,
  token: string,
  input: { contentId?: number; externalId?: string; provider?: string },
): Promise<number | null> {
  if (Number.isInteger(input.contentId) && Number(input.contentId) > 0) {
    return Number(input.contentId);
  }
  if (!input.externalId) return null;
  const provider = input.provider?.toLowerCase();
  const sourceFilter = provider === "mal"
    ? "eq.MAL"
    : provider === "jikan"
      ? "in.(MAL,JIKAN)"
      : "eq.TMDB";
  const query = new URLSearchParams({
    select: "id",
    external_id: `eq.${input.externalId}`,
    source: sourceFilter,
    limit: "1",
  });
  const response = await restFetch(config, token, `contents?${query}`);
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ id: number }>;
  return rows[0]?.id ?? null;
}

import { createSupabaseConfig } from "@/lib/supabase/config";
import {
  authFetch,
  ensureIdentityProfile,
  getSupabaseUser,
  onboardingDestination,
  sessionResponse,
  type SupabaseSession,
} from "@/lib/supabase/server";

export async function GET(request: Request) {
  const config = createSupabaseConfig();
  const user = await getSupabaseUser(request, config);
  return Response.json({ user, configured: config.isConfigured });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SupabaseSession | null;
  if (!body?.access_token || !body.refresh_token) {
    return Response.json({ error: "Session tokens are required" }, { status: 400 });
  }
  const config = createSupabaseConfig();
  const validation = await authFetch(config, "user", {
    method: "GET",
    headers: { authorization: `Bearer ${body.access_token}` },
  });
  if (!validation.ok) {
    return Response.json({ error: "Invalid authentication session" }, { status: 401 });
  }
  body.user = (await validation.json()) as SupabaseSession["user"];
  await ensureIdentityProfile(config, body).catch(() => null);
  const next = await onboardingDestination(config, body);
  return sessionResponse(body, { user: body.user, next });
}

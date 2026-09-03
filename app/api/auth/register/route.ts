import { env } from "cloudflare:workers";

import { createSupabaseConfig, type SupabaseEnvironment } from "@/lib/supabase/config";
import { authFetch, sessionResponse, type SupabaseSession } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { email?: string; password?: string; username?: string }
    | null;
  if (!body?.email?.trim() || !body.password || body.password.length < 8) {
    return Response.json(
      { error: "A valid email and password of at least 8 characters are required" },
      { status: 400 },
    );
  }
  const config = createSupabaseConfig(env as unknown as SupabaseEnvironment);
  const response = await authFetch(config, "signup", {
    method: "POST",
    body: JSON.stringify({
      email: body.email.trim(),
      password: body.password,
      data: { username: body.username?.trim() || undefined },
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as SupabaseSession & {
    error_description?: string;
    message?: string;
  };
  if (!response.ok) {
    return Response.json(
      { error: payload.error_description ?? payload.message ?? "Unable to register" },
      { status: response.status || 400 },
    );
  }
  if (payload.access_token && payload.refresh_token) return sessionResponse(payload);
  return Response.json({
    user: payload.user ?? null,
    confirmationRequired: true,
  });
}

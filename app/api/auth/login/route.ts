import { env } from "cloudflare:workers";

import { createSupabaseConfig, type SupabaseEnvironment } from "@/lib/supabase/config";
import { authFetch, sessionResponse, type SupabaseSession } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { email?: string; password?: string }
    | null;
  if (!body?.email?.trim() || !body.password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }
  const config = createSupabaseConfig(env as unknown as SupabaseEnvironment);
  const response = await authFetch(config, "token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email: body.email.trim(), password: body.password }),
  });
  const payload = (await response.json().catch(() => ({}))) as SupabaseSession & {
    error_description?: string;
    message?: string;
  };
  if (!response.ok || !payload.access_token) {
    return Response.json(
      { error: payload.error_description ?? payload.message ?? "Unable to sign in" },
      { status: response.status || 401 },
    );
  }
  return sessionResponse(payload);
}

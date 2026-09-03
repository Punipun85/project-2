import { env } from "cloudflare:workers";

import { createSupabaseConfig, type SupabaseEnvironment } from "@/lib/supabase/config";
import { authFetch } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  if (!body?.email?.trim()) {
    return Response.json({ error: "Email is required" }, { status: 400 });
  }
  const config = createSupabaseConfig(env as unknown as SupabaseEnvironment);
  const response = await authFetch(config, "otp", {
    method: "POST",
    body: JSON.stringify({
      email: body.email.trim(),
      create_user: true,
      options: { email_redirect_to: `${new URL(request.url).origin}/auth/callback` },
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    return Response.json(
      { error: payload.message ?? "Unable to send magic link" },
      { status: response.status },
    );
  }
  return Response.json({ success: true });
}

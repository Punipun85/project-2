import { env } from "cloudflare:workers";

import { createSupabaseConfig, type SupabaseEnvironment } from "@/lib/supabase/config";
import {
  getSupabaseUser,
  sessionResponse,
  type SupabaseSession,
} from "@/lib/supabase/server";

export async function GET(request: Request) {
  const config = createSupabaseConfig(env as unknown as SupabaseEnvironment);
  const user = await getSupabaseUser(request, config);
  return Response.json({ user, configured: config.isConfigured });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SupabaseSession | null;
  if (!body?.access_token || !body.refresh_token) {
    return Response.json({ error: "Session tokens are required" }, { status: 400 });
  }
  return sessionResponse(body);
}

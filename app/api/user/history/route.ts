import { env } from "cloudflare:workers";

import { createSupabaseConfig, type SupabaseEnvironment } from "@/lib/supabase/config";
import {
  requireSupabaseUser,
  resolveContentId,
  restFetch,
} from "@/lib/supabase/server";

function config() {
  return createSupabaseConfig(env as unknown as SupabaseEnvironment);
}

export async function GET(request: Request) {
  const supabase = config();
  const session = await requireSupabaseUser(request, supabase);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const query = new URLSearchParams({
    select: "content_id,progress,status,watched_at,updated_at,contents(id,external_id,source,title,poster_url,backdrop_url,content_type,rating_average)",
    order: "updated_at.desc",
  });
  const response = await restFetch(supabase, session.token, `watch_history?${query}`);
  const payload = await response.json().catch(() => []);
  return Response.json(response.ok ? { data: payload } : { error: payload }, { status: response.status });
}

export async function POST(request: Request) {
  const supabase = config();
  const session = await requireSupabaseUser(request, supabase);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | { contentId?: number; externalId?: string; provider?: string; progress?: number; status?: string }
    | null;
  const contentId = body
    ? await resolveContentId(supabase, session.token, body)
    : null;
  if (!contentId) return Response.json({ error: "Content was not found" }, { status: 404 });
  const progress = Math.min(Math.max(Number(body?.progress ?? 0), 0), 100);
  const status = progress >= 100 || body?.status === "completed" ? "completed" : "watching";
  const row = {
    user_id: session.user.id,
    content_id: contentId,
    progress,
    status,
    watched_at: new Date().toISOString(),
  };
  const response = await restFetch(supabase, session.token, "watch_history?on_conflict=user_id,content_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  const payload = await response.json().catch(() => []);
  return Response.json(response.ok ? { data: payload?.[0] ?? row } : { error: payload }, { status: response.status });
}

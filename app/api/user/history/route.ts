import { createSupabaseConfig } from "@/lib/supabase/config";
import { refreshUserPersonalization } from "@/lib/personalization";
import {
  requireSupabaseUser,
  resolveContentId,
  restFetch,
} from "@/lib/supabase/server";

function config() {
  return createSupabaseConfig();
}

export async function GET(request: Request) {
  const supabase = config();
  const session = await requireSupabaseUser(request, supabase);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const query = new URLSearchParams({
    select: "content_id,progress,status,completed,started_at,watched_at,last_watched,updated_at,contents(id,external_id,source,title,poster_url,backdrop_url,content_type,rating_average)",
    order: "last_watched.desc",
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
    | { contentId?: number; externalId?: string; provider?: string; progress?: number; status?: string; completed?: boolean }
    | null;
  const contentId = body
    ? await resolveContentId(supabase, session.token, body)
    : null;
  if (!contentId) return Response.json({ error: "Content was not found" }, { status: 404 });
  const progress = Math.min(Math.max(Number(body?.progress ?? 0), 0), 100);
  const completed = progress >= 100 || body?.status === "completed" || body?.completed === true;
  const status = completed ? "completed" : "watching";
  const row = {
    user_id: session.user.id,
    content_id: contentId,
    progress,
    status,
    completed,
    watched_at: new Date().toISOString(),
    last_watched: new Date().toISOString(),
  };
  const response = await restFetch(supabase, session.token, "watch_history?on_conflict=user_id,content_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  const payload = await response.json().catch(() => []);
  if (response.ok) {
    await restFetch(supabase, session.token, "user_interactions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: session.user.id,
        content_id: contentId,
        interaction_type: completed ? "complete" : "view",
        rating: null,
        metadata: { progress },
      }),
    });
    if (completed) {
      await refreshUserPersonalization(supabase, session.token, session.user.id);
    }
  }
  return Response.json(response.ok ? { data: payload?.[0] ?? row } : { error: payload }, { status: response.status });
}

import { refreshUserPersonalization } from "@/lib/personalization";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { requireSupabaseUser, resolveContentId, restFetch } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const query = new URLSearchParams({
    select: "id,content_id,rating,created_at,updated_at,contents(id,external_id,source,title,poster_url,content_type,rating_average)",
    order: "updated_at.desc",
  });
  const response = await restFetch(config, session.token, `ratings?${query}`);
  const payload = await response.json().catch(() => []);
  return Response.json(response.ok ? { data: payload } : { error: payload }, { status: response.status });
}

export async function PUT(request: Request) {
  const config = createSupabaseConfig();
  const session = await requireSupabaseUser(request, config);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | { contentId?: number; externalId?: string; provider?: string; rating?: number }
    | null;
  const contentId = body ? await resolveContentId(config, session.token, body) : null;
  const rating = Number(body?.rating);
  if (!contentId) return Response.json({ error: "Content was not found" }, { status: 404 });
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return Response.json({ error: "Rating must be from 1 to 5" }, { status: 400 });
  }
  const response = await restFetch(config, session.token, "ratings?on_conflict=user_id,content_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: session.user.id, content_id: contentId, rating }),
  });
  if (!response.ok) return Response.json({ error: await response.json().catch(() => null) }, { status: response.status });
  await restFetch(config, session.token, "user_interactions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: session.user.id,
      content_id: contentId,
      interaction_type: "rating",
      rating,
      metadata: { source: "rating_ui" },
    }),
  });
  const personalization = await refreshUserPersonalization(config, session.token, session.user.id);
  const payload = await response.json();
  return Response.json({ data: payload[0], personalization });
}
